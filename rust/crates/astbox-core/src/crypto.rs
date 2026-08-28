// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
//! ASTBOX v1.0 cryptographic primitives (port of Astbox.Core/Crypto.cs,
//! ASTBOX-v1.0-02-Key-Crypto.txt).
//!
//! Single native path: RustCrypto `argon2` (RFC 9106) + `chacha20poly1305`
//! (XChaCha20-Poly1305). The C# port's dual Argon2 path (NSec fast path /
//! Konscious managed) and its keystream+Poly1305 AEAD decrypt workaround were
//! environment-specific (Smart App Control) — the Rust primitives are single,
//! standard-compliant implementations, cross-validated by the same test
//! vectors (draft-irtf-cfrg-xchacha A.3.1 / §2.2.1, RFC 5869 #1, RFC 6238 B,
//! Konscious Argon2id regression value).

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20::hchacha;
use chacha20::cipher::consts::U10;
use chacha20::cipher::generic_array::GenericArray;
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use hmac::{Hmac, Mac};
use sha1::Sha1;
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::bin::hex_upper;
use crate::errors::{AstboxError, E};
use crate::Result;

/// The five ASTBOX subkeys derived from VaultKey (zeroized on drop).
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct Subkeys {
    pub header: Vec<u8>,
    pub metadata: Vec<u8>,
    pub data: Vec<u8>,
    pub slot_mac: Vec<u8>,
    pub footer: Vec<u8>,
}

pub struct Crypto;

const AEAD_TAG_SIZE: usize = 16;

impl Crypto {
    // ------------------------------------------------------------------
    // Argon2id (raw output) — RFC 9106, single compliant path.
    // Accepts any salt length (ASTBOX slots: 32B; passbox/selftest: 16B)
    // and any parallelism (profiles p=1; selftest p=4).
    // ------------------------------------------------------------------

    pub fn argon2id_raw(
        secret: &[u8],
        salt: &[u8],
        memory_kib: u32,
        time_cost: u32,
        parallelism: u32,
        hash_len: usize,
    ) -> Result<Vec<u8>> {
        Self::argon2id_raw_impl(secret, salt, memory_kib, time_cost, parallelism, hash_len)
            .map_err(|e| Self::map_argon_error(&e, memory_kib))
    }

    fn argon2id_raw_impl(
        secret: &[u8],
        salt: &[u8],
        memory_kib: u32,
        time_cost: u32,
        parallelism: u32,
        hash_len: usize,
    ) -> std::result::Result<Vec<u8>, String> {
        let params = Params::new(memory_kib, time_cost, parallelism, Some(hash_len))
            .map_err(|e| e.to_string())?;
        let a2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
        let mut out = vec![0u8; hash_len];
        a2.hash_password_into(secret, salt, &mut out)
            .map_err(|e| e.to_string())?;
        Ok(out)
    }

    fn map_argon_error(msg: &str, memory_kib: u32) -> AstboxError {
        if msg.to_lowercase().contains("memory") {
            AstboxError::new(
                E::KdfResourceLimit,
                format!(
                    "Argon2id requires {} KiB of memory which could not be allocated.",
                    memory_kib
                ),
            )
        } else {
            AstboxError::new(E::KdfFailure, format!("Argon2id failed: {}", msg))
        }
    }

    // ------------------------------------------------------------------
    // XChaCha20-Poly1305 (draft-irtf-cfrg-xchacha, IETF construction)
    // Returns ciphertext||tag (ptLen + 16).
    // ------------------------------------------------------------------

    pub fn aead_encrypt(
        key: &[u8],
        nonce: &[u8],
        plaintext: &[u8],
        aad: &[u8],
    ) -> Result<Vec<u8>> {
        if key.len() != 32 {
            return Err(AstboxError::new(E::AeadFailure, "XChaCha key must be 32 bytes"));
        }
        if nonce.len() != 24 {
            return Err(AstboxError::new(E::AeadFailure, "XChaCha nonce must be 24 bytes"));
        }
        let cipher = XChaCha20Poly1305::new_from_slice(key)
            .map_err(|_| AstboxError::new(E::AeadFailure, "XChaCha key must be 32 bytes"))?;
        let nonce = XNonce::from_slice(nonce);
        cipher
            .encrypt(nonce, Payload { msg: plaintext, aad })
            .map_err(|_| AstboxError::new(E::AeadFailure, "XChaCha20-Poly1305 encrypt failed"))
    }

    /// XChaCha20-Poly1305 decrypt; raises AstboxError(AeadFailure) on auth failure.
    pub fn aead_decrypt(key: &[u8], nonce: &[u8], ct_with_tag: &[u8], aad: &[u8]) -> Result<Vec<u8>> {
        if ct_with_tag.len() < AEAD_TAG_SIZE {
            return Err(AstboxError::new(E::AeadFailure, "ciphertext shorter than tag"));
        }
        if nonce.len() != 24 {
            return Err(AstboxError::new(E::AeadFailure, "XChaCha nonce must be 24 bytes"));
        }
        let cipher = XChaCha20Poly1305::new_from_slice(key)
            .map_err(|_| AstboxError::new(E::AeadFailure, "XChaCha key must be 32 bytes"))?;
        let nonce = XNonce::from_slice(nonce);
        cipher
            .decrypt(nonce, Payload { msg: ct_with_tag, aad })
            .map_err(|_| AstboxError::new(E::AeadFailure, "authentication failed"))
    }

    /// HChaCha20: key=32B, nonce16=16B → 32B subkey (draft §2.2.1).
    /// Exposed for the selftest vector; same primitive XChaCha uses internally.
    pub fn hchacha20(key: &[u8], nonce16: &[u8]) -> Result<Vec<u8>> {
        if key.len() != 32 || nonce16.len() != 16 {
            return Err(AstboxError::new(E::CryptoFailure, "HChaCha20 input sizes"));
        }
        let mut k = [0u8; 32];
        k.copy_from_slice(key);
        let n = GenericArray::from_slice(nonce16);
        Ok(hchacha::<U10>(GenericArray::from_slice(&k), n).to_vec())
    }

    // ------------------------------------------------------------------
    // HKDF-SHA-256 (RFC 5869) — manual for exact C# semantics
    // ------------------------------------------------------------------

    pub fn hkdf_extract(salt: &[u8], ikm: &[u8]) -> Result<Vec<u8>> {
        let real_salt: Vec<u8> = if salt.is_empty() { vec![0u8; 32] } else { salt.to_vec() };
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&real_salt)
            .map_err(|e| crate::err!(E::CryptoFailure, "hmac: {}", e))?;
        mac.update(ikm);
        Ok(mac.finalize().into_bytes().to_vec())
    }

    pub fn hkdf_expand(prk: &[u8], info: &[u8], length: usize) -> Result<Vec<u8>> {
        if length > 255 * 32 {
            return Err(AstboxError::new(
                E::InvalidArgument,
                "HKDF-Expand output too long",
            ));
        }
        let mut okm = Vec::with_capacity(length);
        let mut t: Vec<u8> = Vec::new();
        let mut counter: u8 = 1;
        while okm.len() < length {
            let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(prk)
                .map_err(|e| crate::err!(E::CryptoFailure, "hmac: {}", e))?;
            mac.update(&t);
            mac.update(info);
            mac.update(&[counter]);
            t = mac.finalize().into_bytes().to_vec();
            okm.extend_from_slice(&t);
            counter = counter.wrapping_add(1);
        }
        okm.truncate(length);
        Ok(okm)
    }

    /// Derive the five ASTBOX subkeys from VaultKey (doc 02 §31).
    pub fn hkdf_derive(vault_key: &[u8], vault_id: &[u8]) -> Result<Subkeys> {
        let mut salt =
            Vec::with_capacity(crate::Constants::LABEL_HKDF_SALT.len() + vault_id.len());
        salt.extend_from_slice(crate::Constants::LABEL_HKDF_SALT);
        salt.extend_from_slice(vault_id);

        let prk = Self::hkdf_extract(&salt, vault_key)?;
        Ok(Subkeys {
            header: Self::hkdf_expand(&prk, crate::Constants::LABEL_HDRM, 32)?,
            metadata: Self::hkdf_expand(&prk, crate::Constants::LABEL_META, 32)?,
            data: Self::hkdf_expand(&prk, crate::Constants::LABEL_DATA, 32)?,
            slot_mac: Self::hkdf_expand(&prk, crate::Constants::LABEL_SLOTM, 32)?,
            footer: Self::hkdf_expand(&prk, crate::Constants::LABEL_FOOT, 32)?,
        })
    }

    // ------------------------------------------------------------------
    // HMAC / hash helpers
    // ------------------------------------------------------------------

    pub fn hmac_sha256_trunc16(key: &[u8], message: &[u8]) -> Result<Vec<u8>> {
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key)
            .map_err(|e| crate::err!(E::CryptoFailure, "hmac: {}", e))?;
        mac.update(message);
        let digest = mac.finalize().into_bytes();
        Ok(digest[..16].to_vec())
    }

    pub fn sha256_first16(data: &[u8]) -> Vec<u8> {
        let digest = Sha256::digest(data);
        digest[..16].to_vec()
    }

    pub fn sha256(data: &[u8]) -> Vec<u8> {
        Sha256::digest(data).to_vec()
    }

    /// Constant-time comparison (equal-length guarded).
    pub fn constant_time_equals(a: &[u8], b: &[u8]) -> bool {
        use subtle::ConstantTimeEq;
        a.len() == b.len() && bool::from(a.ct_eq(b))
    }

    // ------------------------------------------------------------------
    // TOTP credential / Argon2 input
    // ------------------------------------------------------------------

    /// Domain-separated Argon2id input (doc 02 §18).
    pub fn build_argon2_input(
        credential_type: u16,
        credential_parameters: u8,
        credential: &[u8],
    ) -> Vec<u8> {
        let mut buf = Vec::with_capacity(2 + 1 + crate::Constants::LABEL_KDF.len() + credential.len());
        buf.extend_from_slice(&credential_type.to_be_bytes());
        buf.push(credential_parameters);
        buf.extend_from_slice(crate::Constants::LABEL_KDF);
        buf.extend_from_slice(credential);
        buf
    }

    /// RFC 6238 TOTP with HMAC-SHA-1, 30 s period, T0=0.
    pub fn totp_at(secret_base32: &str, digits: u32, t: Option<i64>) -> Result<String> {
        if digits != 6 && digits != 8 {
            return Err(AstboxError::new(E::InvalidTotp, "TOTP digits must be 6 or 8"));
        }
        let secret = match Self::base32_decode(secret_base32) {
            Ok(s) => s,
            Err(_) => {
                return Err(AstboxError::new(E::InvalidTotp, "invalid Base32 TOTP secret"))
            }
        };
        if secret.is_empty() {
            return Err(AstboxError::new(E::InvalidTotp, "empty TOTP secret"));
        }

        let now = t.unwrap_or(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0),
        );
        let counter = ((now - crate::Constants::TOTP_T0) / crate::Constants::TOTP_PERIOD) as u64;
        let msg = counter.to_be_bytes();

        let mut mac = <Hmac<Sha1> as Mac>::new_from_slice(&secret)
            .map_err(|e| crate::err!(E::CryptoFailure, "hmac: {}", e))?;
        mac.update(&msg);
        let digest = mac.finalize().into_bytes();
        let offset = (digest[digest.len() - 1] & 0x0F) as usize;
        let mut code = (((digest[offset] & 0x7F) as u32) << 24)
            | ((digest[offset + 1] as u32) << 16)
            | ((digest[offset + 2] as u32) << 8)
            | (digest[offset + 3] as u32);
        code %= 10u32.pow(digits);
        Ok(format!("{:0width$}", code, width = digits as usize))
    }

    /// RFC 4648 Base32 (case-insensitive; spaces/padding tolerated).
    pub fn base32_decode(input: &str) -> Result<Vec<u8>> {
        const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        let mut clean = String::with_capacity(input.len());
        for ch in input.trim().to_uppercase().chars() {
            if ch == ' ' || ch == '-' || ch == '=' {
                continue;
            }
            clean.push(ch);
        }
        let mut bit_buf: u32 = 0;
        let mut bits: u32 = 0;
        let mut output = Vec::with_capacity(clean.len() * 5 / 8 + 1);
        for ch in clean.chars() {
            let val = ALPHABET
                .iter()
                .position(|&c| c as char == ch)
                .ok_or_else(|| crate::err!(E::InvalidArgument, "invalid Base32 character '{}'", ch))?
                as u32;
            bit_buf = (bit_buf << 5) | val;
            bits += 5;
            if bits >= 8 {
                output.push((bit_buf >> (bits - 8)) as u8);
                bits -= 8;
            }
        }
        Ok(output)
    }

    /// RFC 4648 Base32 encode (unpadded).
    pub fn base32_encode(data: &[u8]) -> String {
        const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        let mut sb = String::with_capacity((data.len() * 8 + 4) / 5);
        let mut bit_buf: u32 = 0;
        let mut bits: u32 = 0;
        for &b in data {
            bit_buf = (bit_buf << 8) | b as u32;
            bits += 8;
            while bits >= 5 {
                sb.push(ALPHABET[((bit_buf >> (bits - 5)) & 31) as usize] as char);
                bits -= 5;
            }
        }
        if bits > 0 {
            sb.push(ALPHABET[((bit_buf << (5 - bits)) & 31) as usize] as char);
        }
        sb
    }

    pub fn random_bytes(n: usize) -> Result<Vec<u8>> {
        let mut v = vec![0u8; n];
        getrandom::fill(&mut v)
            .map_err(|e| crate::err!(E::CryptoFailure, "random failure: {}", e))?;
        Ok(v)
    }

    // ------------------------------------------------------------------
    // Self-test vectors (mirrors Crypto.Selftest())
    // ------------------------------------------------------------------

    // draft-irtf-cfrg-xchacha-03 appendix A.3.1 (XChaCha20-Poly1305)
    const VEC_KEY: &str =
        "808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f";
    const VEC_NONCE: &str = "404142434445464748494a4b4c4d4e4f5051525354555657";
    const VEC_AAD: &str = "50515253c0c1c2c3c4c5c6c7";
    const VEC_PLAINTEXT: &[u8] =
        b"Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.";
    const VEC_CIPHERTEXT: &str =
        "bd6d179d3e83d43b9576579493c0e939572a1700252bfaccbed2902c21396cbb\
         731c7f1b0b4aa6440bf3a82f4eda7e39ae64c6708c54c216cb96b72e1213b452\
         2f8c9ba40db5d945b11b69b982c1bb9e3f3fac2bc369488f76b2383565d3fff9\
         21f9664c97637da9768812f615c68b13b52e";
    const VEC_TAG: &str = "c0875924c1c7987947deafd8780acf49";

    // draft-irtf-cfrg-xchacha-03 section 2.2.1 (HChaCha20 block function)
    const HVEC_KEY: &str =
        "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
    const HVEC_NONCE: &str = "000000090000004a0000000031415927";
    const HVEC_OUT: &str =
        "82413b4227b27bfed30e42508a877d73a0f9e4d58a74a853c12ec41326d3ecdc";

    /// Run cryptographic self-tests; raise AstboxError on failure.
    pub fn selftest() -> Result<Vec<String>> {
        let mut results = Vec::new();

        macro_rules! check {
            ($cond:expr, $what:expr) => {
                if !($cond) {
                    return Err(AstboxError::new(E::CryptoFailure, $what));
                }
            };
        }

        // 1) XChaCha20-Poly1305 draft vector
        {
            let key = crate::bin::unhex(Self::VEC_KEY)?;
            let nonce = crate::bin::unhex(Self::VEC_NONCE)?;
            let aad = crate::bin::unhex(Self::VEC_AAD)?;
            let want_ct = crate::bin::unhex(Self::VEC_CIPHERTEXT)?;
            let want_tag = crate::bin::unhex(Self::VEC_TAG)?;

            let output = Self::aead_encrypt(&key, &nonce, Self::VEC_PLAINTEXT, &aad)?;
            let ct = &output[..output.len() - 16];
            let tag = &output[output.len() - 16..];
            check!(
                ct == want_ct.as_slice(),
                format!(
                    "XChaCha20 ciphertext mismatch: got {} want {}",
                    hex_upper(&ct[..ct.len().min(24)]),
                    hex_upper(&want_ct[..want_ct.len().min(24)])
                )
            );
            check!(tag == want_tag.as_slice(), "XChaCha20 tag mismatch");
            results.push("XChaCha20-Poly1305 (native) vector OK".to_string());
        }

        // 2) HChaCha20 block-function vector (draft section 2.2.1)
        {
            let h = Self::hchacha20(
                &crate::bin::unhex(Self::HVEC_KEY)?,
                &crate::bin::unhex(Self::HVEC_NONCE)?,
            )?;
            check!(h == crate::bin::unhex(Self::HVEC_OUT)?, "HChaCha20 vector mismatch");
            results.push("HChaCha20 vector OK".to_string());
        }

        // 3) AEAD roundtrip on random data (mirrors the C# pure-vs-native
        //    cross-check intent: implementation agrees with itself and the
        //    draft vector above).
        {
            for i in 0..3 {
                let key = Self::random_bytes(32)?;
                let nonce = Self::random_bytes(24)?;
                let aad = Self::random_bytes(i * 7)?;
                let msg = Self::random_bytes(1 + i * 40)?;
                let sealed = Self::aead_encrypt(&key, &nonce, &msg, &aad)?;
                let back = Self::aead_decrypt(&key, &nonce, &sealed, &aad)?;
                check!(back == msg, "XChaCha20 roundtrip failed");
            }
            results.push("XChaCha20-Poly1305 roundtrip (3 cases) OK".to_string());
        }

        // 4) HKDF known-answer (RFC 5869 test case 1).
        {
            let ikm = vec![0x0bu8; 22];
            let salt: Vec<u8> = (0u8..13).collect();
            let info: Vec<u8> = (0xF0u8..0xFA).collect();
            let prk = Self::hkdf_extract(&salt, &ikm)?;
            let okm = Self::hkdf_expand(&prk, &info, 42)?;
            check!(
                hex_upper(&prk)
                    == "077709362C2E32DF0DDC3F0DC47BBA6390B6C73BB50F9C3122EC844AD7C2B3E5",
                "HKDF PRK"
            );
            check!(
                hex_upper(&okm)
                    == "3CB25F25FAACD57A90434F64D0362F2A\
                        2D2D0A90CF1A5A4C5DB02D56ECC4C5BF\
                        34007208D5B887185865",
                "HKDF OKM"
            );
            results.push("HKDF-SHA-256 RFC 5869 vector OK".to_string());
        }

        // 5) Argon2id API/determinism smoke test (reference C regression value;
        //    ASTBOX never uses Argon2 secret/ad — doc 02 §18).
        {
            let sec = vec![0x01u8; 32];
            let salt = vec![0x02u8; 16];
            let output = Self::argon2id_raw(&sec, &salt, 32, 3, 4, 32)?;
            check!(output.len() == 32, "Argon2id output length");
            check!(
                hex_upper(&output)
                    == "03AAB965C12001C9D7D0D2DE33192C0494B684BB148196D73C1DF1ACAF6D0C2E",
                "Argon2id regression mismatch"
            );
            results.push("Argon2id smoke/regression OK".to_string());

            // 5b) determinism cross-check (C# validated NSec==Konscious; the
            //     Rust single implementation must be deterministic).
            {
                let sec5b = Self::random_bytes(32)?;
                let salt5b = Self::random_bytes(16);
                let salt5b = salt5b?;
                let a = Self::argon2id_raw(&sec5b, &salt5b, 16384, 2, 1, 32)?;
                let b = Self::argon2id_raw(&sec5b, &salt5b, 16384, 2, 1, 32)?;
                check!(a == b, "Argon2id not deterministic");
            }
            results.push("Argon2id determinism cross-check OK".to_string());
        }

        // 6) TOTP RFC 6238 appendix B vectors.
        {
            const TEST_SECRET: &str = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
            check!(
                Self::totp_at(TEST_SECRET, 8, Some(59))? == "94287082",
                "TOTP 8-digit vector mismatch"
            );
            check!(
                Self::totp_at(TEST_SECRET, 6, Some(59))? == "287082",
                "TOTP 6-digit vector mismatch"
            );
            results.push("TOTP RFC 6238 vectors OK".to_string());
        }

        Ok(results)
    }
}
