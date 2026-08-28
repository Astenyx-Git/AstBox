// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
//! ASTBOX propagation package (.passbox) — self-contained credential wrapper
//! (port of Astbox.Core/PassboxFile.cs).
//!
//! Layout:
//!   MAGIC       16B   b"ASTPASSBX1" + 6x\0
//!   HDRLEN       4B   big-endian, JSON header byte count
//!   HEADER      JSON   {v, digits, created?, name, csha?, wrap:"none"|"pass",
//!                       salt/snonce/kdf (pass only)}
//!   SECRETLEN    4B   big-endian
//!   SECRET_BLK         none: Base32 ASCII; pass: XChaCha20-Poly1305(
//!                          key=Argon2id("ASTBOX-PASSBOX-v1"+passphrase,...),
//!                          aad=MAGIC)
//!   CONTAINER          complete .astbox bytes
//!   TRAILER     32B    SHA-256 of all preceding content
//!
//! The JSON header is written with a hand-rolled serializer that reproduces
//! the C# Utf8JsonWriter output byte-for-byte (compact form, key order as
//! emitted by the C# writer, JavaScriptEncoder.Default escaping).

use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::bin::{hex_lower, unhex};
use crate::constants::Constants;
use crate::crypto::Crypto;
use crate::errors::{AstboxError, E};
use crate::rng::RandomSource;
use crate::Result;

/// Propagation-package error code used by the reference impl.
pub struct PassboxError;

impl PassboxError {
    pub const CODE: u16 = 0x0399;
}

#[derive(Debug, Clone)]
pub struct PassboxInfo {
    pub header: Value,
    pub needs_passphrase: bool,
}

#[derive(Debug, Clone)]
pub struct PassboxUnwrapResult {
    pub secret_base32: String,
    pub header: Value,
    pub container_path: String,
}

pub struct PassboxFile;

fn magic() -> Vec<u8> {
    let mut m = b"ASTPASSBX1".to_vec();
    m.extend_from_slice(&[0u8; 6]);
    m
}

const PB_DOMAIN: &[u8] = b"ASTBOX-PASSBOX-v1";
const SALT_LEN: usize = 16;

fn err(msg: &str) -> AstboxError {
    AstboxError::new(PassboxError::CODE, msg)
}

fn derive_wrap_key(passphrase: &str, salt: &[u8], mem_kib: u32, t: u32, p: u32) -> Result<Vec<u8>> {
    let mut input = Vec::with_capacity(PB_DOMAIN.len() + passphrase.len());
    input.extend_from_slice(PB_DOMAIN);
    input.extend_from_slice(passphrase.as_bytes());
    Crypto::argon2id_raw(&input, salt, mem_kib, t, p, 32)
}

// ---------------------------------------------------------------------------
// JSON writing — byte-compatible with C# Utf8JsonWriter defaults
// ---------------------------------------------------------------------------

/// Escape a string exactly like System.Text.Json's default encoder
/// (JavaScriptEncoder.Default): short escapes for \b\t\n\f\r, uppercase-hex
/// \uXXXX for remaining controls, HTML-sensitive ASCII (< > & ' ` +),
/// U+2028/2029 and every non-ASCII code unit (surrogate pairs for astral).
pub fn json_escape_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{08}' => out.push_str("\\b"),
            '\u{09}' => out.push_str("\\t"),
            '\u{0A}' => out.push_str("\\n"),
            '\u{0C}' => out.push_str("\\f"),
            '\u{0D}' => out.push_str("\\r"),
            '<' => out.push_str("\\u003C"),
            '>' => out.push_str("\\u003E"),
            '&' => out.push_str("\\u0026"),
            '\'' => out.push_str("\\u0027"),
            '`' => out.push_str("\\u0060"),
            '+' => out.push_str("\\u002B"),
            '\u{2028}' => out.push_str("\\u2028"),
            '\u{2029}' => out.push_str("\\u2029"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04X}", c as u32));
            }
            c if (c as u32) < 0x80 => out.push(c),
            c => {
                // non-ASCII: escaped per code unit (surrogate pair if astral)
                let mut buf = [0u16; 2];
                for unit in c.encode_utf16(&mut buf) {
                    out.push_str(&format!("\\u{:04X}", unit));
                }
            }
        }
    }
    out.push('"');
    out
}

pub struct JsonWriter {
    buf: Vec<u8>,
}

impl JsonWriter {
    pub fn new() -> Self {
        JsonWriter { buf: Vec::new() }
    }

    pub fn write_number_u64(&mut self, name: &str, v: u64) {
        self.push_key(name);
        self.buf.extend_from_slice(v.to_string().as_bytes());
    }

    pub fn write_number_i64(&mut self, name: &str, v: i64) {
        self.push_key(name);
        self.buf.extend_from_slice(v.to_string().as_bytes());
    }

    pub fn write_null(&mut self, name: &str) {
        self.push_key(name);
        self.buf.extend_from_slice(b"null");
    }

    pub fn write_string(&mut self, name: &str, v: &str) {
        self.push_key(name);
        self.buf.extend_from_slice(json_escape_string(v).as_bytes());
    }

    pub fn write_start_object(&mut self, name: &str) {
        self.push_key(name);
        self.buf.push(b'{');
    }

    pub fn write_end_object(&mut self) {
        self.buf.push(b'}');
    }

    pub fn start_root(&mut self) {
        self.buf.push(b'{');
    }

    pub fn end_root(mut self) -> Vec<u8> {
        self.buf.push(b'}');
        self.buf
    }

    fn push_key(&mut self, name: &str) {
        if !self.after_open_brace_only() {
            self.buf.push(b',');
        }
        self.buf
            .extend_from_slice(json_escape_string(name).as_bytes());
        self.buf.push(b':');
    }

    fn after_open_brace_only(&self) -> bool {
        // true when the object just opened has no members yet
        match self.buf.last() {
            Some(b'{') => true,
            _ => false,
        }
    }
}

impl PassboxFile {
    /// Pack a container and its Base32 secret into a .passbox file.
    /// passphrase=None produces a no-passphrase quick pack; streaming copy.
    pub fn pack_passbox(
        astbox_path: &str,        secret_b32: &str,
        digits: u8,
        created: Option<i64>,
        out_path: &str,
        passphrase: Option<&str>,
    ) -> Result<String> {
        let mut rng = crate::rng::OsRandom;
        Self::pack_passbox_with(
            &mut rng,
            astbox_path,
            secret_b32,
            digits,
            created,
            out_path,
            passphrase,
        )
    }

    /// Byte-compat harness variant: explicit random source.
    pub fn pack_passbox_with(
        rng: &mut dyn RandomSource,
        astbox_path: &str,
        secret_b32: &str,
        digits: u8,
        created: Option<i64>,
        out_path: &str,
        passphrase: Option<&str>,
    ) -> Result<String> {
        if !std::path::Path::new(astbox_path).exists() {
            return Err(err(&format!("容器文件不存在: {}", astbox_path)));
        }
        let norm: String = secret_b32
            .trim()
            .to_uppercase()
            .replace(' ', "");
        let raw = {
            match Crypto::base32_decode(&norm) {
                Ok(r) => {
                    if r.len() < 10 {
                        return Err(err("无效的 Base32 密钥"));
                    }
                    r
                }
                Err(_) => return Err(err("无效的 Base32 密钥")),
            }
        };
        let _ = raw;

        // prepare secret block first
        let blk: Vec<u8>;
        let mut salt: Option<Vec<u8>> = None;
        let mut snonce: Option<Vec<u8>> = None;
        let mut k_mem = 0u32;
        let mut k_t = 0u32;
        let mut k_p = 0u32;
        let wrap_mode;
        if let Some(passphrase) = passphrase {
            let s = rng.bytes(SALT_LEN)?;
            let n = rng.bytes(24)?;
            let (m, t, p) = Constants::argon2_profile(Constants::KDF_PROFILE_MEMORY_CONSTRAINED)?;
            k_mem = m;
            k_t = t;
            k_p = p;
            let wk = derive_wrap_key(passphrase, &s, k_mem, k_t, k_p)?;
            blk = Crypto::aead_encrypt(&wk, &n, norm.as_bytes(), &magic())?;
            salt = Some(s);
            snonce = Some(n);
            wrap_mode = "pass";
        } else {
            blk = norm.as_bytes().to_vec();
            wrap_mode = "none";
        }

        // JSON header — key order matches the C# writer exactly
        let container_sha = {
            let data = std::fs::read(astbox_path)
                .map_err(|e| crate::err!(E::Io, "cannot read {}: {}", astbox_path, e))?;
            hex_lower(&Crypto::sha256(&data))
        };
        let mut w = JsonWriter::new();
        w.start_root();
        match created {
            Some(c) => w.write_number_i64("created", c),
            None => w.write_null("created"),
        }
        w.write_string("csha", &container_sha);
        w.write_number_u64("digits", digits as u64);
        if wrap_mode == "pass" {
            w.write_string("salt", &hex_lower(salt.as_ref().unwrap()));
            w.write_string("snonce", &hex_lower(snonce.as_ref().unwrap()));
            w.write_start_object("kdf");
            w.write_number_u64("mem_kib", k_mem as u64);
            w.write_number_u64("p", k_p as u64);
            w.write_number_u64("t", k_t as u64);
            w.write_end_object();
        }
        let name = std::path::Path::new(astbox_path)
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        w.write_string("name", &name);
        w.write_string("wrap", wrap_mode);
        let header_bytes = w.end_root();

        // streaming pack: MAGIC || HDRLEN || HEADER || SECRETLEN || BLK || CONTAINER || SHA256
        let tmp = format!("{}.part", out_path);
        let result = (|| -> Result<()> {
            use std::io::{Read, Write};
            let mut fsrc = std::fs::File::open(astbox_path)
                .map_err(|e| crate::err!(E::Io, "cannot read {}: {}", astbox_path, e))?;
            let mut hasher = Sha256::new();
            let mut feed = |b: &[u8], dst: &mut std::fs::File| -> Result<()> {
                hasher.update(b);
                dst.write_all(b)
                    .map_err(|e| crate::err!(E::Write, "cannot write {}: {}", out_path, e))
            };
            {
                let mut fdst = std::fs::File::create(&tmp)
                    .map_err(|e| crate::err!(E::Io, "cannot create {}: {}", tmp, e))?;
                feed(&magic(), &mut fdst)?;
                let mut len_buf = [0u8; 4];
                len_buf.copy_from_slice(&(header_bytes.len() as u32).to_be_bytes());
                feed(&len_buf, &mut fdst)?;
                feed(&header_bytes, &mut fdst)?;
                len_buf.copy_from_slice(&(blk.len() as u32).to_be_bytes());
                feed(&len_buf, &mut fdst)?;
                feed(&blk, &mut fdst)?;

                let mut buffer = vec![0u8; 1024 * 1024];
                loop {
                    let read = fsrc
                        .read(&mut buffer)
                        .map_err(|e| crate::err!(E::Read, "cannot read {}: {}", astbox_path, e))?;
                    if read == 0 {
                        break;
                    }
                    feed(&buffer[..read], &mut fdst)?;
                }
                let digest = hasher.clone().finalize();
                fdst.write_all(&digest)
                    .map_err(|e| crate::err!(E::Write, "cannot write {}: {}", out_path, e))?;
                fdst.sync_all().ok();
            }
            std::fs::rename(&tmp, out_path).map_err(|e| {
                let _ = std::fs::remove_file(&tmp);
                crate::err!(E::Io, "cannot rename {}: {}", out_path, e)
            })?;
            Ok(())
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&tmp);
        }
        result?;
        Ok(out_path.to_string())
    }

    /// Read header info without decrypting the secret block.
    pub fn read_info(path: &str) -> Result<PassboxInfo> {
        let mut f = std::fs::File::open(path)
            .map_err(|e| crate::err!(E::Io, "cannot read {}: {}", path, e))?;
        let mut magic_buf = [0u8; 16];
        read_full(&mut f, &mut magic_buf)?;
        if magic_buf != magic().as_slice() {
            return Err(err("不是有效的 .passbox 文件"));
        }
        let mut len_buf = [0u8; 4];
        read_full(&mut f, &mut len_buf)?;
        let hlen = u32::from_be_bytes(len_buf) as usize;
        let mut hdr_bytes = vec![0u8; hlen];
        read_full(&mut f, &mut hdr_bytes)?;
        let doc: Value = serde_json::from_slice(&hdr_bytes)
            .map_err(|e| err(&format!("header parse error: {}", e)))?;
        let needs_pass = doc.get("wrap").and_then(|w| w.as_str()) == Some("pass");
        Ok(PassboxInfo {
            header: doc,
            needs_passphrase: needs_pass,
        })
    }

    /// Verify overall SHA-256 → unwrap the secret → drop the embedded
    /// container next to the package with an .astbox extension.
    pub fn unwrap_secret(path: &str, passphrase: Option<&str>) -> Result<PassboxUnwrapResult> {
        let base_name = std::path::Path::new(path)
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        let stem = if base_name.to_lowercase().ends_with(".passbox") {
            base_name[..base_name.len() - ".passbox".len()].to_string()
        } else {
            base_name.clone()
        };
        let dir = std::path::Path::new(path)
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| std::path::PathBuf::from("."));
        let container_path = dir.join(format!("{}.astbox", stem));

        let data = std::fs::read(path)
            .map_err(|e| crate::err!(E::Io, "cannot read {}: {}", path, e))?;
        if data.len() < 16 + 4 + 2 + 4 + 32 {
            return Err(err(".passbox 文件过短或损坏"));
        }
        let body = &data[..data.len() - 32];
        let trailer = &data[data.len() - 32..];
        let digest = Crypto::sha256(body);
        if !Crypto::constant_time_equals(&digest, trailer) {
            return Err(err(".passbox 完整性校验失败(文件被截断或篡改)"));
        }

        let mut off = 0usize;
        if &body[off..off + 16] != magic().as_slice() {
            return Err(err("不是有效的 .passbox 文件"));
        }
        off += 16;
        let hlen = u32::from_be_bytes([body[off], body[off + 1], body[off + 2], body[off + 3]]) as usize;
        off += 4;
        let header: Value = serde_json::from_slice(&body[off..off + hlen])
            .map_err(|e| err(&format!("header parse error: {}", e)))?;
        off += hlen;
        let blen = u32::from_be_bytes([body[off], body[off + 1], body[off + 2], body[off + 3]]) as usize;
        off += 4;
        let blk = body[off..off + blen].to_vec();
        off += blen;
        let container_bytes = &body[off..];

        let get_str = |name: &str| -> String {
            header
                .get(name)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        };

        if let Some(csha_el) = header.get("csha").and_then(|v| v.as_str()) {
            let csha = hex_lower(&Crypto::sha256(container_bytes));
            if csha != csha_el {
                return Err(err("内嵌容器校验和不匹配"));
            }
        }

        let is_pass = header.get("wrap").and_then(|w| w.as_str()) == Some("pass");

        let plain: String;
        if is_pass {
            let passphrase = match passphrase {
                Some(p) if !p.is_empty() => p,
                _ => return Err(err("该传播包受口令保护，需要输入口令")),
            };
            let mut mem_kib: u64 = 65536;
            let mut t: u64 = 3;
            let mut p: u64 = 1;
            if let Some(kdf) = header.get("kdf") {
                if let Some(m) = kdf.get("mem_kib").and_then(|v| v.as_u64()) {
                    mem_kib = m;
                }
                if let Some(tt) = kdf.get("t").and_then(|v| v.as_u64()) {
                    t = tt;
                }
                if let Some(pp) = kdf.get("p").and_then(|v| v.as_u64()) {
                    p = pp;
                }
            }
            let salt = unhex(&get_str("salt"))?;
            let snonce = unhex(&get_str("snonce"))?;
            let wk = derive_wrap_key(passphrase, &salt, mem_kib as u32, t as u32, p as u32)?;
            match Crypto::aead_decrypt(&wk, &snonce, &blk, &magic()) {
                Ok(pt) => {
                    plain = String::from_utf8_lossy(&pt).into_owned();
                }
                Err(_) => return Err(err("口令错误或传播包已损坏")),
            }
        } else {
            plain = String::from_utf8_lossy(&blk).into_owned();
        }

        let norm: String = plain.trim().to_uppercase().replace(' ', "");
        match Crypto::base32_decode(&norm) {
            Ok(raw) => {
                if raw.len() < 10 {
                    return Err(err("传播包内的密钥块无效"));
                }
            }
            Err(_) => return Err(err("传播包内的密钥块无效")),
        }

        std::fs::write(&container_path, container_bytes).map_err(|e| {
            crate::err!(
                E::Io,
                "cannot write {}: {}",
                container_path.display(),
                e
            )
        })?;
        Ok(PassboxUnwrapResult {
            secret_base32: norm,
            header,
            container_path: container_path.to_string_lossy().into_owned(),
        })
    }
}

fn read_full(f: &mut impl std::io::Read, buf: &mut [u8]) -> Result<()> {
    let mut got = 0;
    while got < buf.len() {
        let r = f
            .read(&mut buf[got..])
            .map_err(|e| crate::err!(E::Read, "read error: {}", e))?;
        if r == 0 {
            return Err(err("不是有效的 .passbox 文件"));
        }
        got += r;
    }
    Ok(())
}
