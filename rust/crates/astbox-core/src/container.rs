// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
//! ASTBOX v1.0 container parsing, unlocking and reading
//! (port of Astbox.Core/Container.cs). Implements the binary layout of doc 01,
//! the crypto flows of doc 02 and the metadata/data/footer rules of doc 03.

use std::collections::HashMap;

use zeroize::Zeroizing;

use crate::bin::*;
use crate::cbor_det::CborValue;
use crate::constants::Constants;
use crate::crypto::Subkeys;
use crate::errors::{AstboxError, E};
use crate::Result;

/// UTF-16-ordinal string comparison (C# StringComparer.Ordinal semantics,
/// which orders by UTF-16 code units).
pub fn cmp_ordinal(a: &str, b: &str) -> std::cmp::Ordering {
    let mut ai = a.encode_utf16();
    let mut bi = b.encode_utf16();
    loop {
        match (ai.next(), bi.next()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, Some(_)) => return std::cmp::Ordering::Less,
            (Some(_), None) => return std::cmp::Ordering::Greater,
            (Some(x), Some(y)) => {
                if x != y {
                    return x.cmp(&y);
                }
            }
        }
    }
}

#[derive(Debug, Clone)]
pub struct Header {
    pub magic: Vec<u8>,
    pub version: u16,
    pub flags: u32,
    pub vault_id: Vec<u8>,
    pub generation: u64,
    pub key_slot_offset: u64,
    pub key_slot_length: u64,
    pub metadata_offset: u64,
    pub metadata_length: u64,
    pub data_offset: u64,
    pub data_length: u64,
    pub footer_offset: u64,
    pub footer_length: u64,
    pub key_slot_count: u32,
    pub header_length: u32,
    pub header_mac: Vec<u8>,
    pub reserved: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct KeySlot {
    pub index: usize,
    pub slot_id: Vec<u8>,
    pub credential_type: u16,
    pub credential_parameters: u8,
    pub kdf_profile: u16,
    pub reserved2_field: u16,
    pub argon2_memory_kib: u32,
    pub argon2_time: u32,
    pub argon2_parallelism: u32,
    pub salt: Vec<u8>,
    pub wrap_nonce: Vec<u8>,
    pub wrapped_vault_key: Vec<u8>,
    pub slot_mac: Vec<u8>,
}

impl KeySlot {
    pub fn is_totp(&self) -> bool {
        self.credential_type == Constants::CRED_TYPE_TOTP
    }
    pub fn totp_digits(&self) -> Option<u8> {
        if self.is_totp() {
            Some(self.credential_parameters)
        } else {
            None
        }
    }
    pub fn kdf_label(&self) -> &'static str {
        match self.kdf_profile {
            Constants::KDF_PROFILE_HIGH => "ARGON2ID_HIGH",
            Constants::KDF_PROFILE_MEMORY_CONSTRAINED => "ARGON2ID_MEMORY_CONSTRAINED",
            _ => "unknown",
        }
    }
    pub fn kdf_params(&self) -> (u32, u32, u32) {
        (self.argon2_memory_kib, self.argon2_time, self.argon2_parallelism)
    }
}

#[derive(Debug, Clone)]
pub struct Footer {
    pub magic: Vec<u8>,
    pub version: u16,
    pub flags: u32,
    pub generation: u64,
    pub container_length: u64,
    pub metadata_digest: Vec<u8>,
    pub data_digest: Vec<u8>,
    pub footer_mac: Vec<u8>,
    pub reserved: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct ParsedContainer {
    pub path: String,
    pub raw: Vec<u8>,
    pub header: Header,
    pub slots: Vec<KeySlot>,
    pub footer: Footer,
}

#[derive(Debug, Clone)]
pub struct Entry {
    pub file_id: Vec<u8>,
    pub parent_id: Vec<u8>,
    pub entry_type: u8,
    pub name: String,
    pub size: u64,
    pub data_start: u64,
    pub data_length: u64,
    pub modified: u64,
    pub file_mode: u64,
}

impl Entry {
    pub fn is_dir(&self) -> bool {
        self.entry_type == Constants::TYPE_DIRECTORY
    }
    pub fn is_file(&self) -> bool {
        self.entry_type == Constants::TYPE_FILE
    }
}

#[derive(Debug, Clone)]
pub struct DataChunk {
    pub file_id: Vec<u8>,
    pub chunk_index: u64,
    pub plaintext_length: u32,
    pub nonce: Vec<u8>,
    pub ciphertext: Vec<u8>,
    pub tag: Vec<u8>,
    /// Absolute file offset of this record.
    pub record_offset: u64,
}

pub struct UnlockedContainer {
    pub parsed: ParsedContainer,
    pub vault_key: Zeroizing<Vec<u8>>,
    pub keys: Subkeys,
    pub metadata: CborValue,
    pub created: u64,
    pub modified: u64,
    pub entries: HashMap<Vec<u8>, Entry>,
    pub children: HashMap<Vec<u8>, Vec<Entry>>,
    pub chunks: HashMap<Vec<u8>, Vec<DataChunk>>,
}

fn u64_checked_add(a: u64, b: u64, what: &str) -> Result<u64> {
    a.checked_add(b)
        .ok_or_else(|| crate::err!(E::IntegerOverflow, "{} overflows UINT64", what))
}

fn u64_checked_mul(a: u64, b: u64, what: &str) -> Result<u64> {
    a.checked_mul(b)
        .ok_or_else(|| crate::err!(E::IntegerOverflow, "{} overflows UINT64", what))
}

fn check_reserved(cond: bool, what: &str) -> Result<()> {
    if cond {
        return Err(crate::err!(E::ReservedField, "{} must be zero", what));
    }
    Ok(())
}

pub struct Container;

impl Container {
    // -------------------------------------------------- structural parsing

    pub fn parse_header(raw: &[u8]) -> Result<Header> {
        if raw.len() < Constants::HEADER_SIZE as usize {
            return Err(AstboxError::new(
                E::InvalidHeader,
                "file shorter than 128-byte header",
            ));
        }

        let magic = raw[..6].to_vec();
        let version = u16_be_at(raw, 6);
        let flags = u32_be_at(raw, 8);
        let vault_id = raw[12..28].to_vec();
        let generation = u64_be_at(raw, 28);
        let key_slot_offset = u64_be_at(raw, 36);
        let key_slot_length = u64_be_at(raw, 44);
        let metadata_offset = u64_be_at(raw, 52);
        let metadata_length = u64_be_at(raw, 60);
        let data_offset = u64_be_at(raw, 68);
        let data_length = u64_be_at(raw, 76);
        let footer_offset = u64_be_at(raw, 84);
        let footer_length = u64_be_at(raw, 92);
        let key_slot_count = u32_be_at(raw, 100);
        let header_length = u32_be_at(raw, 104);
        let header_mac = raw[108..124].to_vec();
        let reserved = raw[124..128].to_vec();

        if magic != Constants::HEADER_MAGIC.as_slice() {
            return Err(crate::err!(
                E::InvalidMagic,
                "bad header magic {}",
                hex_upper(&magic)
            ));
        }
        if version != Constants::VERSION {
            return Err(crate::err!(
                E::UnsupportedVersion,
                "unsupported format version {}",
                version
            ));
        }
        if flags != 0 {
            return Err(AstboxError::new(E::InvalidHeader, "non-zero header Flags"));
        }
        if header_length != Constants::HEADER_SIZE as u32 {
            return Err(crate::err!(
                E::InvalidHeader,
                "HeaderLength {} != 128",
                header_length
            ));
        }
        if key_slot_offset != Constants::HEADER_SIZE {
            return Err(crate::err!(
                E::InvalidOffset,
                "KeySlotOffset {} != 128",
                key_slot_offset
            ));
        }
        if key_slot_count < Constants::MIN_KEY_SLOT_COUNT
            || key_slot_count > Constants::MAX_KEY_SLOT_COUNT
        {
            return Err(crate::err!(
                E::InvalidHeader,
                "KeySlotCount {} outside 1..16",
                key_slot_count
            ));
        }
        if footer_length != Constants::FOOTER_SIZE {
            return Err(crate::err!(
                E::InvalidLength,
                "FooterLength {} != 112",
                footer_length
            ));
        }
        check_reserved(reserved != [0u8; 4], "Header Reserved")?;

        let expect_ksl = u64_checked_mul(
            key_slot_count as u64,
            Constants::KEY_SLOT_SIZE,
            "KeySlotLength",
        )?;
        if key_slot_length != expect_ksl {
            return Err(crate::err!(
                E::InvalidLength,
                "KeySlotLength {} != count*192",
                key_slot_length
            ));
        }
        let expect_mo = u64_checked_add(key_slot_offset, key_slot_length, "MetadataOffset")?;
        if metadata_offset != expect_mo {
            return Err(crate::err!(
                E::InvalidOffset,
                "MetadataOffset {} != {}",
                metadata_offset,
                expect_mo
            ));
        }
        if metadata_length
            < (Constants::METADATA_NONCE_SIZE + Constants::METADATA_TAG_SIZE) as u64
        {
            return Err(AstboxError::new(E::InvalidLength, "MetadataLength too small"));
        }
        let expect_do = u64_checked_add(metadata_offset, metadata_length, "DataOffset")?;
        if data_offset != expect_do {
            return Err(crate::err!(
                E::InvalidOffset,
                "DataOffset {} != {}",
                data_offset,
                expect_do
            ));
        }
        let expect_fo = u64_checked_add(data_offset, data_length, "FooterOffset")?;
        if footer_offset != expect_fo {
            return Err(crate::err!(
                E::InvalidOffset,
                "FooterOffset {} != {}",
                footer_offset,
                expect_fo
            ));
        }
        let expect_size = u64_checked_add(footer_offset, footer_length, "FileSize")?;
        if expect_size != raw.len() as u64 {
            return Err(crate::err!(
                E::ContainerLengthMismatch,
                "file size {} != FooterOffset+112 ({})",
                raw.len(),
                expect_size
            ));
        }
        if footer_offset.checked_add(footer_length).map(|v| v > raw.len() as u64) == Some(true) {
            return Err(AstboxError::new(E::InvalidOffset, "Footer beyond end of file"));
        }

        Ok(Header {
            magic,
            version,
            flags,
            vault_id,
            generation,
            key_slot_offset,
            key_slot_length,
            metadata_offset,
            metadata_length,
            data_offset,
            data_length,
            footer_offset,
            footer_length,
            key_slot_count,
            header_length,
            header_mac,
            reserved,
        })
    }

    pub fn parse_key_slots(raw: &[u8], header: &Header) -> Result<Vec<KeySlot>> {
        let mut slots = Vec::new();
        let count = header.key_slot_count as usize;
        for i in 0..count {
            let off = header.key_slot_offset as usize + i * Constants::KEY_SLOT_SIZE as usize;
            if off + Constants::KEY_SLOT_SIZE as usize > raw.len() {
                return Err(AstboxError::new(E::InvalidHeader, "Key Slot region truncated"));
            }
            let s = &raw[off..off + Constants::KEY_SLOT_SIZE as usize];
            let slot_id = s[..16].to_vec();
            let cred_type = u16_be_at(s, 16);
            let cred_params = s[18];
            let r1 = s[19];
            let kdf_profile = u16_be_at(s, 20);
            let r2 = u16_be_at(s, 22);
            let mem_kib = u32_be_at(s, 24);
            let time_cost = u32_be_at(s, 28);
            let parallelism = u32_be_at(s, 32);
            let salt = s[36..68].to_vec();
            let wrap_nonce = s[68..92].to_vec();
            let wrapped = s[92..140].to_vec();
            let slot_mac = s[140..156].to_vec();
            let r3 = &s[156..192];

            check_reserved(r1 != 0, "Key Slot Reserved1")?;
            check_reserved(r2 != 0, "Key Slot Reserved2")?;
            check_reserved(r3 != [0u8; 36], "Key Slot Reserved3")?;
            if cred_type == Constants::CRED_TYPE_PASSWORD {
                return Err(AstboxError::new(
                    E::UnsupportedCredential,
                    "password Key Slots are not part of the ASTBOX v1 design; \
                     container rejected",
                ));
            }
            if cred_type != Constants::CRED_TYPE_TOTP {
                return Err(crate::err!(
                    E::UnsupportedCredential,
                    "unknown CredentialType 0x{:04X}",
                    cred_type
                ));
            }
            if cred_params != 6 && cred_params != 8 {
                return Err(crate::err!(
                    E::InvalidTotpDigits,
                    "TOTP digits {} not in (6, 8)",
                    cred_params
                ));
            }
            if kdf_profile != Constants::KDF_PROFILE_HIGH
                && kdf_profile != Constants::KDF_PROFILE_MEMORY_CONSTRAINED
            {
                return Err(crate::err!(
                    E::UnsupportedCredential,
                    "unknown KDFProfile 0x{:04X}",
                    kdf_profile
                ));
            }
            let (p_mem, p_time, p_par) = Constants::argon2_profile(kdf_profile)?;
            if (mem_kib, time_cost, parallelism) != (p_mem, p_time, p_par) {
                return Err(crate::err!(
                    E::InvalidHeader,
                    "Argon2 parameters do not match KDFProfile 0x{:04X}",
                    kdf_profile
                ));
            }

            slots.push(KeySlot {
                index: i,
                slot_id,
                credential_type: cred_type,
                credential_parameters: cred_params,
                kdf_profile,
                reserved2_field: r2,
                argon2_memory_kib: mem_kib,
                argon2_time: time_cost,
                argon2_parallelism: parallelism,
                salt,
                wrap_nonce,
                wrapped_vault_key: wrapped,
                slot_mac,
            });
        }

        let ids: Vec<&Vec<u8>> = slots.iter().map(|x| &x.slot_id).collect();
        let mut seen = std::collections::HashSet::new();
        for id in &ids {
            if !seen.insert(id.as_slice()) {
                return Err(AstboxError::new(E::InvalidHeader, "duplicate SlotID in container"));
            }
        }
        Ok(slots)
    }

    pub fn parse_footer(raw: &[u8], header: &Header) -> Result<Footer> {
        let off = header.footer_offset as usize;
        if off + Constants::FOOTER_SIZE as usize > raw.len() {
            return Err(AstboxError::new(E::InvalidFooter, "footer truncated"));
        }
        let f = &raw[off..off + Constants::FOOTER_SIZE as usize];
        let magic = f[..8].to_vec();
        let version = u16_be_at(f, 8);
        let flags = u16_be_at(f, 10) as u32;
        let generation = u64_be_at(f, 12);
        let container_length = u64_be_at(f, 20);
        let meta_digest = f[28..44].to_vec();
        let data_digest = f[44..60].to_vec();
        let footer_mac = f[60..76].to_vec();
        let reserved = f[76..112].to_vec();

        if magic != Constants::FOOTER_MAGIC.as_slice() {
            return Err(crate::err!(
                E::InvalidFooter,
                "bad footer magic {}",
                hex_upper(&magic)
            ));
        }
        if version != Constants::VERSION {
            return Err(crate::err!(
                E::UnsupportedVersion,
                "unsupported footer version {}",
                version
            ));
        }
        if flags != 0 {
            return Err(AstboxError::new(E::InvalidFooter, "non-zero FooterFlags"));
        }
        if generation != header.generation {
            return Err(crate::err!(
                E::GenerationMismatch,
                "FooterGeneration {} != Header.Generation {}",
                generation,
                header.generation
            ));
        }
        if container_length != raw.len() as u64 {
            return Err(crate::err!(
                E::ContainerLengthMismatch,
                "ContainerLength {} != file size {}",
                container_length,
                raw.len()
            ));
        }
        check_reserved(reserved != [0u8; 36], "Footer Reserved")?;

        Ok(Footer {
            magic,
            version,
            flags,
            generation,
            container_length,
            metadata_digest: meta_digest,
            data_digest,
            footer_mac,
            reserved,
        })
    }

    /// Structurally parse a container (no credentials needed).
    pub fn parse_container(path: &str, raw: Option<Vec<u8>>) -> Result<ParsedContainer> {
        let raw = match raw {
            Some(r) => r,
            None => std::fs::read(path).map_err(|e| {
                crate::err!(E::Io, "cannot read {}: {}", path, io_message(&e))
            })?,
        };
        let header = Self::parse_header(&raw)?;
        let slots = Self::parse_key_slots(&raw, &header)?;
        let footer = Self::parse_footer(&raw, &header)?;
        Ok(ParsedContainer {
            path: path.to_string(),
            raw,
            header,
            slots,
            footer,
        })
    }

    // ------------------------------------------------------------ unlocking

    fn wrap_associated_data(h: &Header, slot: &KeySlot) -> Vec<u8> {
        let mut ad = Vec::with_capacity(
            Constants::LABEL_WRAP.len() + 16 * 2 + 2 + 1 + 2 + 4 * 3 + 32 + 24,
        );
        ad.extend_from_slice(Constants::LABEL_WRAP);
        ad.extend_from_slice(&h.vault_id);
        ad.extend_from_slice(&slot.slot_id);
        ad.extend_from_slice(&slot.credential_type.to_be_bytes());
        ad.push(slot.credential_parameters);
        ad.extend_from_slice(&slot.kdf_profile.to_be_bytes());
        ad.extend_from_slice(&slot.argon2_memory_kib.to_be_bytes());
        ad.extend_from_slice(&slot.argon2_time.to_be_bytes());
        ad.extend_from_slice(&slot.argon2_parallelism.to_be_bytes());
        ad.extend_from_slice(&slot.salt);
        ad.extend_from_slice(&slot.wrap_nonce);
        ad
    }

    pub fn derive_unlock_key(slot: &KeySlot, credential_bytes: &[u8]) -> Result<Vec<u8>> {
        let arg_input = crate::crypto::Crypto::build_argon2_input(
            slot.credential_type,
            slot.credential_parameters,
            credential_bytes,
        );
        let (mem_kib, t, p) = slot.kdf_params();
        crate::crypto::Crypto::argon2id_raw(&arg_input, &slot.salt, mem_kib, t, p, 32)
    }

    fn unwrap_vault_key(
        parsed: &ParsedContainer,
        slot: &KeySlot,
        unlock_key: &[u8],
    ) -> Result<Vec<u8>> {
        crate::crypto::Crypto::aead_decrypt(
            unlock_key,
            &slot.wrap_nonce,
            &slot.wrapped_vault_key,
            &Self::wrap_associated_data(&parsed.header, slot),
        )
    }

    fn verify_header_mac(parsed: &ParsedContainer, header_key: &[u8]) -> Result<()> {
        let h = &parsed.header;
        let raw = &parsed.raw;
        let mut without_mac = vec![0u8; 128];
        without_mac[..108].copy_from_slice(&raw[..108]);
        // bytes 108..124 stay zeroed (the MAC field)
        without_mac[124..128].copy_from_slice(&raw[124..128]);

        let mut mac_input =
            Vec::with_capacity(Constants::LABEL_HEADER_MAC.len() + 128);
        mac_input.extend_from_slice(Constants::LABEL_HEADER_MAC);
        mac_input.extend_from_slice(&without_mac);

        let expect = crate::crypto::Crypto::hmac_sha256_trunc16(header_key, &mac_input)?;
        if !crate::crypto::Crypto::constant_time_equals(&expect, &h.header_mac) {
            return Err(AstboxError::new(
                E::HeaderMacFailure,
                "HeaderMAC verification failed",
            ));
        }
        Ok(())
    }

    fn verify_slot_macs(parsed: &ParsedContainer, slot_mac_key: &[u8]) -> Result<()> {
        for slot in &parsed.slots {
            let off =
                parsed.header.key_slot_offset as usize + slot.index * Constants::KEY_SLOT_SIZE as usize;
            let slot_bytes = &parsed.raw[off..off + Constants::KEY_SLOT_SIZE as usize];
            let mut mac_input = Vec::with_capacity(Constants::LABEL_SLOT_MAC.len() + 176);
            mac_input.extend_from_slice(Constants::LABEL_SLOT_MAC);
            mac_input.extend_from_slice(&slot_bytes[..140]);
            mac_input.extend_from_slice(&slot_bytes[156..]);
            let expect = crate::crypto::Crypto::hmac_sha256_trunc16(slot_mac_key, &mac_input)?;
            if !crate::crypto::Crypto::constant_time_equals(&expect, &slot.slot_mac) {
                return Err(crate::err!(
                    E::HeaderMacFailure,
                    "SlotMAC verification failed for slot {}",
                    slot.index
                ));
            }
        }
        Ok(())
    }

    fn verify_footer(parsed: &ParsedContainer, footer_key: &[u8]) -> Result<()> {
        let f = &parsed.footer;
        let off = parsed.header.footer_offset as usize;
        let footer_bytes = &parsed.raw[off..off + Constants::FOOTER_SIZE as usize];
        let mut without_mac = vec![0u8; 112];
        without_mac[..60].copy_from_slice(&footer_bytes[..60]);
        without_mac[76..112].copy_from_slice(&footer_bytes[76..112]);

        let mut mac_input = Vec::with_capacity(Constants::LABEL_FOOTER_MAC.len() + 112);
        mac_input.extend_from_slice(Constants::LABEL_FOOTER_MAC);
        mac_input.extend_from_slice(&without_mac);

        let expect = crate::crypto::Crypto::hmac_sha256_trunc16(footer_key, &mac_input)?;
        if !crate::crypto::Crypto::constant_time_equals(&expect, &f.footer_mac) {
            return Err(AstboxError::new(
                E::FooterMacFailure,
                "FooterMAC verification failed",
            ));
        }

        // digests
        let h = &parsed.header;
        let meta_record = &parsed.raw
            [h.metadata_offset as usize..(h.metadata_offset + h.metadata_length) as usize];
        if !crate::crypto::Crypto::constant_time_equals(
            &crate::crypto::Crypto::sha256_first16(meta_record),
            &f.metadata_digest,
        ) {
            return Err(AstboxError::new(
                E::MetadataDigestFailure,
                "MetadataDigest mismatch",
            ));
        }

        let data_region =
            &parsed.raw[h.data_offset as usize..(h.data_offset + h.data_length) as usize];
        if !crate::crypto::Crypto::constant_time_equals(
            &crate::crypto::Crypto::sha256_first16(data_region),
            &f.data_digest,
        ) {
            return Err(AstboxError::new(E::DataDigestFailure, "DataDigest mismatch"));
        }
        Ok(())
    }

    fn decrypt_metadata(parsed: &ParsedContainer, metadata_key: &[u8]) -> Result<CborValue> {
        let h = &parsed.header;
        let record = &parsed.raw
            [h.metadata_offset as usize..(h.metadata_offset + h.metadata_length) as usize];
        let nonce = record[..24].to_vec();
        let tag = record[record.len() - 16..].to_vec();
        let ct = record[24..record.len() - 16].to_vec();

        let mut ad = Vec::with_capacity(Constants::LABEL_METADATA.len() + 16 + 8);
        ad.extend_from_slice(Constants::LABEL_METADATA);
        ad.extend_from_slice(&h.vault_id);
        ad.extend_from_slice(&h.generation.to_be_bytes());

        let mut ct_tag = Vec::with_capacity(ct.len() + 16);
        ct_tag.extend_from_slice(&ct);
        ct_tag.extend_from_slice(&tag);
        match crate::crypto::Crypto::aead_decrypt(metadata_key, &nonce, &ct_tag, &ad) {
            Ok(plain) => crate::cbor_det::CborDet::loads(&plain),
            Err(exc) => Err(AstboxError::new(
                E::MetadataAeadFailure,
                format!("metadata authentication failed ({})", exc.message),
            )),
        }
    }

    // ------------------------------------------------------ metadata rules

    fn validate_name(name: &str) -> Result<()> {
        if name.is_empty() {
            return Err(AstboxError::new(E::InvalidFileName, "empty entry name"));
        }
        if name == "." || name == ".." {
            return Err(AstboxError::new(
                E::InvalidFileName,
                "name '.'/'..' forbidden",
            ));
        }
        if name.contains('/') || name.contains('\\') || name.contains('\0') {
            return Err(AstboxError::new(
                E::InvalidFileName,
                "name contains path separator or NUL",
            ));
        }
        Ok(())
    }

    // typed CBOR accessor mirroring the Python isinstance checks
    fn get_key(map: &CborValue, key: u64, err_code: u16, what: &str) -> Result<CborValue> {
        let k = CborValue::UInt(key);
        for (mk, mv) in map.entries() {
            if *mk == k {
                return Ok(mv.clone());
            }
        }
        Err(AstboxError::new(err_code, what))
    }

    fn require_non_negative_int(v: &CborValue, code: u16, what: &str) -> Result<u64> {
        if !v.is_uint() {
            return Err(crate::err!(
                code,
                "{} must be a non-negative integer",
                what
            ));
        }
        Ok(v.as_uint())
    }

    fn validate_metadata(meta: &CborValue) -> Result<(HashMap<Vec<u8>, Entry>, HashMap<Vec<u8>, Vec<Entry>>)> {
        if !meta.is_map() {
            return Err(AstboxError::new(E::InvalidCbor, "metadata root must be a map"));
        }

        let is_expected_top = meta.entries().len() == 5
            && meta.entries().iter().all(|(k, _)| {
                matches!(k, CborValue::UInt(v) if (1..=5).contains(v))
            });
        if !is_expected_top {
            return Err(AstboxError::new(
                E::UnknownField,
                "metadata top-level keys must be exactly 1..5",
            ));
        }

        let version = Self::get_key(meta, 1, E::UnknownField, "")?;
        if !version.is_uint() || version.as_uint() != 1 {
            return Err(AstboxError::new(E::UnsupportedVersion, "MetadataVersion != 1"));
        }
        let root_id = Self::get_key(meta, 2, E::UnknownField, "")?;
        if !root_id.is_bytes() || root_id.as_bytes() != Constants::ROOT_DIRECTORY_ID.as_slice() {
            return Err(AstboxError::new(
                E::InvalidEntry,
                "RootDirectoryID must be 16 zero bytes",
            ));
        }
        let entries_val = Self::get_key(meta, 3, E::UnknownField, "")?;
        if !entries_val.is_array() {
            return Err(AstboxError::new(E::InvalidCbor, "Entries must be an array"));
        }
        let created_v = Self::get_key(meta, 4, E::UnknownField, "")?;
        let modified_v = Self::get_key(meta, 5, E::UnknownField, "")?;
        if !created_v.is_uint() || !modified_v.is_uint() {
            return Err(AstboxError::new(
                E::InvalidCbor,
                "ContainerCreated/Modified must be integers",
            ));
        }

        let mut entries: HashMap<Vec<u8>, Entry> = HashMap::new();
        let mut children: HashMap<Vec<u8>, Vec<Entry>> = HashMap::new();
        children.insert(Constants::ROOT_DIRECTORY_ID.to_vec(), Vec::new());

        for item in entries_val.items() {
            if !item.is_map() {
                return Err(AstboxError::new(E::InvalidEntry, "entry must be a map"));
            }

            let expected_keys = item.entries().len() == 9
                && item.entries().iter().all(|(k, _)| {
                    matches!(k, CborValue::UInt(v) if (1..=9).contains(v))
                });
            if !expected_keys {
                return Err(AstboxError::new(
                    E::UnknownField,
                    "entry keys must be exactly 1..9",
                ));
            }

            let file_id_v = Self::get_key(item, 1, E::UnknownField, "")?;
            let parent_id_v = Self::get_key(item, 2, E::UnknownField, "")?;
            let type_v = Self::get_key(item, 3, E::UnknownField, "")?;
            let name_v = Self::get_key(item, 4, E::UnknownField, "")?;
            let size_v = Self::get_key(item, 5, E::UnknownField, "")?;
            let data_start_v = Self::get_key(item, 6, E::UnknownField, "")?;
            let data_len_v = Self::get_key(item, 7, E::UnknownField, "")?;
            let modified_tv = Self::get_key(item, 8, E::UnknownField, "")?;
            let mode_v = Self::get_key(item, 9, E::UnknownField, "")?;

            if !file_id_v.is_bytes() || file_id_v.as_bytes().len() != 16 {
                return Err(AstboxError::new(E::InvalidEntry, "FileID must be 16 bytes"));
            }
            if !parent_id_v.is_bytes() || parent_id_v.as_bytes().len() != 16 {
                return Err(AstboxError::new(E::InvalidEntry, "ParentID must be 16 bytes"));
            }
            let file_id = file_id_v.as_bytes().to_vec();
            let parent_id = parent_id_v.as_bytes().to_vec();
            if file_id == Constants::ROOT_DIRECTORY_ID.as_slice() {
                return Err(AstboxError::new(
                    E::InvalidEntry,
                    "root FileID must not appear as an entry",
                ));
            }
            if !type_v.is_uint()
                || (type_v.as_uint() != Constants::TYPE_DIRECTORY as u64
                    && type_v.as_uint() != Constants::TYPE_FILE as u64)
            {
                return Err(crate::err!(E::InvalidEntry, "unknown entry type {}", type_v.as_uint()));
            }

            let size = Self::require_non_negative_int(&size_v, E::InvalidEntry, "Size")?;
            let data_start =
                Self::require_non_negative_int(&data_start_v, E::InvalidEntry, "DataStart")?;
            let data_length =
                Self::require_non_negative_int(&data_len_v, E::InvalidEntry, "DataLength")?;
            let modified_t =
                Self::require_non_negative_int(&modified_tv, E::InvalidEntry, "Modified")?;
            let mode = Self::require_non_negative_int(&mode_v, E::InvalidEntry, "FileMode")?;

            if !name_v.is_text() {
                return Err(AstboxError::new(E::InvalidFileName, "empty entry name"));
            }
            let name = name_v.as_text().to_string();
            Self::validate_name(&name)?;

            if entries.contains_key(&file_id) {
                return Err(AstboxError::new(E::InvalidEntry, "duplicate FileID"));
            }

            let entry = Entry {
                file_id: file_id.clone(),
                parent_id: parent_id.clone(),
                entry_type: type_v.as_uint() as u8,
                name,
                size,
                data_start,
                data_length,
                modified: modified_t,
                file_mode: mode,
            };
            let is_dir = entry.is_dir();
            if is_dir {
                if size != 0 || data_start != 0 || data_length != 0 {
                    return Err(AstboxError::new(
                        E::InvalidEntry,
                        "directory must have Size/DataStart/DataLength == 0",
                    ));
                }
            } else if size == 0 {
                if data_length != 0 || data_start != 0 {
                    return Err(AstboxError::new(
                        E::InvalidEntry,
                        "empty file must have DataStart/DataLength == 0",
                    ));
                }
            } else if data_length == 0 {
                return Err(AstboxError::new(
                    E::InvalidEntry,
                    "non-empty file must have DataLength > 0",
                ));
            }
            entries.insert(file_id, entry.clone());
            children.entry(parent_id).or_default().push(entry);
        }

        // tree validation
        for (file_id, entry) in &entries {
            Self::walk_parent(&entries, file_id, 0)?;
            if !entries.contains_key(&entry.parent_id)
                && entry.parent_id != Constants::ROOT_DIRECTORY_ID.as_slice()
            {
                return Err(crate::err!(
                    E::InvalidDirectoryTree,
                    "ParentID of '{}' does not reference a directory",
                    entry.name
                ));
            }
            if let Some(parent) = entries.get(&entry.parent_id) {
                if !parent.is_dir() {
                    return Err(crate::err!(
                        E::InvalidDirectoryTree,
                        "parent of '{}' is not a directory",
                        entry.name
                    ));
                }
            }
            if entry.parent_id == entry.file_id.as_slice() {
                return Err(crate::err!(
                    E::InvalidDirectoryTree,
                    "entry '{}' is its own parent",
                    entry.name
                ));
            }
        }
        for siblings in children.values() {
            let names: Vec<&str> = siblings.iter().map(|s| s.name.as_str()).collect();
            let mut uniq = names.clone();
            uniq.sort();
            uniq.dedup();
            if uniq.len() != names.len() {
                return Err(AstboxError::new(
                    E::InvalidDirectoryTree,
                    "duplicate sibling name under one parent",
                ));
            }
        }
        Ok((entries, children))
    }

    fn walk_parent(
        entries: &HashMap<Vec<u8>, Entry>,
        file_id: &[u8],
        depth: usize,
    ) -> Result<()> {
        if depth > Constants::MAX_DIRECTORY_DEPTH {
            return Err(AstboxError::new(
                E::InvalidDirectoryTree,
                "directory tree too deep",
            ));
        }
        let entry = &entries[file_id];
        if entry.parent_id == Constants::ROOT_DIRECTORY_ID.as_slice() {
            return Ok(());
        }
        if entry.parent_id == file_id || !entries.contains_key(&entry.parent_id) {
            return Err(crate::err!(
                E::InvalidDirectoryTree,
                "cycle or missing parent for '{}'",
                entry.name
            ));
        }
        Self::walk_parent(entries, &entry.parent_id, depth + 1)
    }

    // ---------------------------------------------------------- data region

    pub fn index_data(
        parsed: &ParsedContainer,
        entries: &HashMap<Vec<u8>, Entry>,
    ) -> Result<HashMap<Vec<u8>, Vec<DataChunk>>> {
        let h = &parsed.header;
        let region = &parsed.raw[h.data_offset as usize..(h.data_offset + h.data_length) as usize];
        let mut chunks: HashMap<Vec<u8>, Vec<DataChunk>> = HashMap::new();
        let mut pos: usize = 0;
        while pos < region.len() {
            let rec_start_abs = h.data_offset + pos as u64;
            if pos + 52 > region.len() {
                return Err(AstboxError::new(
                    E::InvalidDataRecord,
                    "truncated Data Record header",
                ));
            }
            let file_id = region[pos..pos + 16].to_vec();
            let chunk_index = u64_be_at(region, pos + 16);
            let plaintext_length = u32_be_at(region, pos + 24);
            let nonce = region[pos + 28..pos + 52].to_vec();
            if !(1..=Constants::MAX_CHUNK_PLAINTEXT as u32).contains(&plaintext_length) {
                return Err(crate::err!(
                    E::InvalidDataRecord,
                    "PlaintextLength {} out of range 1..1048576",
                    plaintext_length
                ));
            }
            let rec_len = Constants::DATA_RECORD_OVERHEAD + plaintext_length as u64;
            if pos as u64 + rec_len > region.len() as u64 {
                return Err(AstboxError::new(
                    E::InvalidDataRecord,
                    "Data Record extends past Data region",
                ));
            }
            let ct = region[pos + 52..pos + 52 + plaintext_length as usize].to_vec();
            let tag = region[pos + 52 + plaintext_length as usize
                ..pos + rec_len as usize]
                .to_vec();
            chunks.entry(file_id.clone()).or_default().push(DataChunk {
                file_id,
                chunk_index,
                plaintext_length,
                nonce,
                ciphertext: ct,
                tag,
                record_offset: rec_start_abs,
            });
            pos += rec_len as usize;
        }
        if pos != region.len() {
            return Err(AstboxError::new(
                E::InvalidDataRecord,
                "unaccounted bytes in Data region",
            ));
        }

        for (file_id, clist) in chunks.iter_mut() {
            let entry = match entries.get(file_id) {
                Some(e) if e.is_file() => e,
                _ => {
                    return Err(AstboxError::new(
                        E::InvalidDataRecord,
                        "Data Record references unknown FileID",
                    ))
                }
            };
            clist.sort_by_key(|c| c.chunk_index);
            for (i, c) in clist.iter().enumerate() {
                if c.chunk_index != i as u64 {
                    return Err(crate::err!(
                        E::InvalidDataRecord,
                        "non-contiguous ChunkIndex for {}",
                        hex_upper(file_id)
                    ));
                }
            }
            if entry.size == 0 {
                return Err(AstboxError::new(
                    E::InvalidDataRecord,
                    "Data Records for a zero-size file",
                ));
            }
            let expect_count = (entry.size + Constants::MAX_CHUNK_PLAINTEXT as u64 - 1)
                / Constants::MAX_CHUNK_PLAINTEXT as u64;
            if clist.len() as u64 != expect_count {
                return Err(crate::err!(
                    E::InvalidDataRecord,
                    "chunk count {} != ceil(size/chunk) {}",
                    clist.len(),
                    expect_count
                ));
            }
            for c in &clist[..clist.len() - 1] {
                if c.plaintext_length != Constants::MAX_CHUNK_PLAINTEXT as u32 {
                    return Err(AstboxError::new(
                        E::InvalidDataRecord,
                        "non-final chunk is not 1048576 bytes",
                    ));
                }
            }
            let total: u64 = clist.iter().map(|c| c.plaintext_length as u64).sum();
            if total != entry.size {
                return Err(crate::err!(
                    E::InvalidDataRecord,
                    "sum of chunk plaintext {} != Size {}",
                    total,
                    entry.size
                ));
            }
            let first_abs = clist[0].record_offset;
            let region_len: u64 = clist
                .iter()
                .map(|c| Constants::DATA_RECORD_OVERHEAD + c.plaintext_length as u64)
                .sum();
            if first_abs != entry.data_start || region_len != entry.data_length {
                return Err(AstboxError::new(
                    E::InvalidDataRecord,
                    "metadata DataStart/DataLength do not match records",
                ));
            }
            if first_abs + region_len > h.footer_offset {
                return Err(AstboxError::new(
                    E::InvalidDataRecord,
                    "DataStart+DataLength exceeds FooterOffset",
                ));
            }
        }
        // every non-empty FILE must have records; every record belongs to one FILE
        for (file_id, entry) in entries {
            if entry.is_file() && entry.size > 0 && !chunks.contains_key(file_id) {
                return Err(crate::err!(
                    E::InvalidDataRecord,
                    "missing Data Records for file '{}'",
                    entry.name
                ));
            }
        }
        Ok(chunks)
    }

    // -------------------------------------------------------- unlock entry

    fn credential_bytes(slot: &KeySlot, totp_value: &str) -> Option<Vec<u8>> {
        // TOTP credential bytes: the exact decimal ASCII code (leading zeros
        // significant), matching the slot's configured digit count.
        let digits = slot.credential_parameters as usize;
        let s = totp_value.trim();
        if s.is_empty() || !s.chars().all(|c| c.is_ascii_digit()) || s.len() != digits {
            return None;
        }
        Some(s.as_bytes().to_vec())
    }

    /// Unlock a container with a TOTP code or a Base32 secret.
    pub fn unlock_container(
        path: &str,
        totp: Option<&str>,
        raw: Option<Vec<u8>>,
        secret_b32: Option<&str>,
    ) -> Result<UnlockedContainer> {
        let parsed = Self::parse_container(path, raw)?;
        Self::unlock_parsed(parsed, totp, secret_b32)
    }

    /// Try to unlock an already-parsed structure (reusable across candidate
    /// codes without re-reading large files).
    pub fn unlock_parsed(
        parsed: ParsedContainer,
        totp: Option<&str>,
        secret_b32: Option<&str>,
    ) -> Result<UnlockedContainer> {
        if let Some(secret) = secret_b32 {
            if !secret.is_empty() {
                let cred = match crate::crypto::Crypto::base32_decode(secret) {
                    Ok(c) => c,
                    Err(_) => {
                        return Err(AstboxError::new(
                            E::AuthenticationFailed,
                            "invalid Base32 TOTP secret",
                        ))
                    }
                };
                let mut last_error: Option<AstboxError> = None;
                for slot in &parsed.slots {
                    match Self::try_slot(&parsed, slot, &cred) {
                        Ok(uc) => return Ok(uc),
                        Err(exc) => last_error = Some(exc),
                    }
                }
                let mut err = AstboxError::new(
                    E::AuthenticationFailed,
                    "unlock failed: secret does not match this container",
                );
                if let Some(le) = last_error {
                    err.original_code = Some(le.code);
                }
                return Err(err);
            }
        }

        let totp = match totp {
            Some(t) => t,
            None => {
                return Err(AstboxError::new(
                    E::NoValidCredential,
                    "a TOTP code is required to unlock",
                ))
            }
        };

        let mut last_err: Option<AstboxError> = None;
        for slot in &parsed.slots {
            let cred = Self::credential_bytes(slot, totp);
            let cred = match cred {
                Some(c) => c,
                None => continue,
            };
            match Self::try_slot(&parsed, slot, &cred) {
                Ok(uc) => return Ok(uc),
                Err(exc) => last_err = Some(exc),
            }
        }
        if last_err.is_some() {
            return Err(AstboxError::new(
                E::AuthenticationFailed,
                "unlock failed: no valid TOTP code for this container",
            ));
        }
        Err(AstboxError::new(
            E::AuthenticationFailed,
            "unlock failed: no matching TOTP code provided",
        ))
    }

    fn try_slot(
        parsed: &ParsedContainer,
        slot: &KeySlot,
        cred: &[u8],
    ) -> Result<UnlockedContainer> {
        let unlock_key = Self::derive_unlock_key(slot, cred)?;
        let vault_key = Self::unwrap_vault_key(parsed, slot, &unlock_key)?;
        Self::finalize_unlock(parsed, slot, vault_key)
    }

    fn finalize_unlock(
        parsed: &ParsedContainer,
        _slot: &KeySlot,
        vault_key: Vec<u8>,
    ) -> Result<UnlockedContainer> {
        let header = &parsed.header;
        let vault_key = Zeroizing::new(vault_key);
        let keys = crate::crypto::Crypto::hkdf_derive(&vault_key, &header.vault_id)?;
        Self::verify_header_mac(parsed, &keys.header)?;
        Self::verify_slot_macs(parsed, &keys.slot_mac)?;
        Self::verify_footer(parsed, &keys.footer)?;
        let meta = Self::decrypt_metadata(parsed, &keys.metadata)?;
        let (entries, children) = Self::validate_metadata(&meta)?;
        let chunks = Self::index_data(parsed, &entries)?;
        let created = Self::get_key(&meta, 4, E::InvalidCbor, "")?.as_uint();
        let modified = Self::get_key(&meta, 5, E::InvalidCbor, "")?.as_uint();
        Ok(UnlockedContainer {
            parsed: ParsedContainer {
                path: parsed.path.clone(),
                raw: parsed.raw.clone(),
                header: parsed.header.clone(),
                slots: parsed.slots.clone(),
                footer: parsed.footer.clone(),
            },
            vault_key,
            keys,
            metadata: meta,
            created,
            modified,
            entries,
            children,
            chunks,
        })
    }

    // --------------------------------------------------- reading/extraction

    pub fn data_associated_data(uc: &UnlockedContainer, chunk: &DataChunk) -> Vec<u8> {
        let h = &uc.parsed.header;
        let mut ad = Vec::with_capacity(Constants::LABEL_DATA.len() + 16 + 8 + 16 + 8 + 4);
        ad.extend_from_slice(Constants::LABEL_DATA);
        ad.extend_from_slice(&h.vault_id);
        ad.extend_from_slice(&h.generation.to_be_bytes());
        ad.extend_from_slice(&chunk.file_id);
        ad.extend_from_slice(&chunk.chunk_index.to_be_bytes());
        ad.extend_from_slice(&chunk.plaintext_length.to_be_bytes());
        ad
    }

    /// Plaintext chunks of a file, authenticating each record.
    pub fn iter_file_plaintext(uc: &UnlockedContainer, entry: &Entry) -> Result<Vec<Vec<u8>>> {
        if entry.is_dir() {
            return Err(crate::err!(E::InvalidEntry, "'{}' is a directory", entry.name));
        }
        let list = match uc.chunks.get(&entry.file_id) {
            Some(l) => l,
            None => return Ok(Vec::new()),
        };
        let mut ordered: Vec<&DataChunk> = list.iter().collect();
        ordered.sort_by_key(|c| c.chunk_index);
        let mut out = Vec::with_capacity(ordered.len());
        for chunk in ordered {
            let mut ct_tag = Vec::with_capacity(chunk.ciphertext.len() + chunk.tag.len());
            ct_tag.extend_from_slice(&chunk.ciphertext);
            ct_tag.extend_from_slice(&chunk.tag);
            let pt = crate::crypto::Crypto::aead_decrypt(
                &uc.keys.data,
                &chunk.nonce,
                &ct_tag,
                &Self::data_associated_data(uc, chunk),
            )
            .map_err(|exc| {
                crate::err!(
                    E::DataAeadFailure,
                    "data record authentication failed for '{}': {}",
                    entry.name,
                    exc.message
                )
            })?;
            out.push(pt);
        }
        Ok(out)
    }

    pub fn read_file(uc: &UnlockedContainer, entry: &Entry) -> Result<Vec<u8>> {
        let mut out = Vec::new();
        for block in Self::iter_file_plaintext(uc, entry)? {
            out.extend_from_slice(&block);
        }
        Ok(out)
    }

    pub fn entry_path_parts(uc: &UnlockedContainer, entry: &Entry) -> Vec<String> {
        let mut parts = vec![entry.name.clone()];
        let mut cur = entry;
        while cur.parent_id != Constants::ROOT_DIRECTORY_ID.as_slice() {
            let parent = &uc.entries[&cur.parent_id];
            parts.push(parent.name.clone());
            cur = parent;
        }
        parts.reverse();
        parts
    }

    pub fn root_entries(uc: &UnlockedContainer) -> Vec<Entry> {
        match uc.children.get(Constants::ROOT_DIRECTORY_ID.as_slice()) {
            Some(l) => {
                let mut v = l.clone();
                v.sort_by(|a, b| cmp_ordinal(&a.name, &b.name));
                v
            }
            None => Vec::new(),
        }
    }

    /// (path, Entry) pairs in depth-first order.
    pub fn walk_entries(uc: &UnlockedContainer) -> Vec<(String, Entry)> {
        Self::walk_entries_inner(
            uc,
            Constants::ROOT_DIRECTORY_ID.as_slice(),
            "",
        )
    }

    fn walk_entries_inner(
        uc: &UnlockedContainer,
        parent_id: &[u8],
        prefix: &str,
    ) -> Vec<(String, Entry)> {
        let mut out = Vec::new();
        let kids = match uc.children.get(parent_id) {
            Some(k) => k,
            None => return out,
        };
        let mut sorted = kids.clone();
        sorted.sort_by(|a, b| cmp_ordinal(&a.name, &b.name));
        for entry in sorted {
            let path = if prefix.is_empty() {
                entry.name.clone()
            } else {
                format!("{}/{}", prefix, entry.name)
            };
            let is_dir = entry.is_dir();
            out.push((path.clone(), entry.clone()));
            if is_dir {
                out.extend(Self::walk_entries_inner(uc, &entry.file_id, &path));
            }
        }
        out
    }

    /// Level-5 verification: authenticate every Data Record.
    pub fn verify_full(uc: &UnlockedContainer) -> Result<()> {
        // deterministic order like the C# Dictionary-walk (order only affects
        // which error surfaces first; iterate sorted for reproducibility)
        let mut ids: Vec<&Vec<u8>> = uc.entries.keys().collect();
        ids.sort();
        for id in ids {
            let entry = &uc.entries[id];
            if entry.is_file() && entry.size > 0 {
                Self::iter_file_plaintext(uc, entry)?;
            }
        }
        Ok(())
    }
}

// Short human-readable IO error message (mirrors exc.Message usage).
pub fn io_message(e: &std::io::Error) -> String {
    match e.kind() {
        std::io::ErrorKind::NotFound => "file not found".to_string(),
        std::io::ErrorKind::PermissionDenied => "access denied".to_string(),
        _ => e.to_string(),
    }
}
