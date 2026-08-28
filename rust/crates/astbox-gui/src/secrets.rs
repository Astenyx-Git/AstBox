// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
//! DPAPI (CurrentUser) protected TOTP secret registry.
//! File format copied verbatim from astbox_server.py:
//! `"ASTBOX1\x00" + CryptProtectData(JSON UTF-8)`, at
//! `%LOCALAPPDATA%\ASTBOX\secrets.bin`; `ASTBOX_SECRETS_PATH` redirects it.
//! Bidirectionally compatible with the python and C# versions
//! (CryptProtectData's szDataDescr does not participate in decryption).
//!
//! JSON key order follows first-insertion order like the C# Dictionary.

use std::collections::HashMap;
use std::path::PathBuf;

use astbox_core::passbox_file::JsonWriter;

/// Known secret entry: VaultID(hex) -> {b32, digits, created}.
#[derive(Debug, Clone)]
pub struct SecretEntry {
    pub b32: String,
    pub digits: u8,
    pub created: Option<i64>,
}

/// Ordered registry preserving first-insertion key order.
#[derive(Default)]
pub struct Registry {
    map: HashMap<String, SecretEntry>,
    order: Vec<String>,
}

impl Registry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn get(&self, key: &str) -> Option<&SecretEntry> {
        self.map.get(key)
    }

    /// Insert/overwrite; an overwrite keeps the key's original position
    /// (C# Dictionary semantics).
    pub fn put(&mut self, key: String, entry: SecretEntry) {
        if !self.map.contains_key(&key) {
            self.order.push(key.clone());
        }
        self.map.insert(key, entry);
    }
}

pub struct SecretsStore;

impl SecretsStore {
    fn magic() -> &'static [u8] {
        b"ASTBOX1\x00"
    }

    pub fn default_path() -> PathBuf {
        let local = std::env::var("LOCALAPPDATA").ok().filter(|s| !s.is_empty());
        let base = match local {
            Some(l) => PathBuf::from(l),
            None => std::env::var("USERPROFILE")
                .map(PathBuf::from)
                .unwrap_or_default(),
        };
        base.join("ASTBOX").join("secrets.bin")
    }

    pub fn store_path() -> PathBuf {
        match std::env::var("ASTBOX_SECRETS_PATH") {
            Ok(p) if !p.is_empty() => PathBuf::from(p),
            _ => Self::default_path(),
        }
    }

    /// Corrupt/moved-machine: silently degrade to an empty registry
    /// (python load_secrets semantics).
    pub fn load() -> Registry {
        let mut reg = Registry::new();
        let raw = match std::fs::read(Self::store_path()) {
            Ok(r) => r,
            Err(_) => return reg,
        };
        let magic = Self::magic();
        if raw.len() < magic.len() || &raw[..magic.len()] != magic {
            return reg;
        }
        let plain = match dpapi_unprotect(&raw[magic.len()..]) {
            Ok(p) => p,
            Err(_) => return reg,
        };
        let doc: serde_json::Map<String, serde_json::Value> =
            match serde_json::from_slice(&plain) {
                Ok(serde_json::Value::Object(m)) => m,
                _ => return reg,
            };
        // JSON object order here is the on-disk order; reinsert in that order
        for (key, value) in doc {
            let Some(obj) = value.as_object() else { continue };
            let Some(b32) = obj.get("b32").and_then(|v| v.as_str()) else {
                continue;
            };
            let digits = obj
                .get("digits")
                .and_then(|v| v.as_u64())
                .map(|d| d as u8)
                .unwrap_or(6);
            let created = obj.get("created").and_then(|v| {
                if v.is_null() {
                    None
                } else {
                    v.as_i64().or(Some(0))
                }
            });
            reg.put(key, SecretEntry { b32: b32.to_string(), digits, created });
        }
        reg
    }

    pub fn save(reg: &Registry) -> Result<(), String> {
        let path = Self::store_path();
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let mut w = JsonWriter::new();
        w.start_root();
        for key in &reg.order {
            let entry = &reg.map[key];
            w.write_start_object(key);
            w.write_string("b32", &entry.b32);
            w.write_number_i64("digits", entry.digits as i64);
            match entry.created {
                Some(c) => w.write_number_i64("created", c),
                None => w.write_null("created"),
            }
            w.write_end_object();
        }
        let raw = w.end_root();
        let blob = magic_protect(&raw)?;
        let tmp = path.with_extension("bin.tmp");
        std::fs::write(&tmp, &blob).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// "ASTBOX1\0" + DPAPI blob.
fn magic_protect(plain: &[u8]) -> Result<Vec<u8>, String> {
    let mut blob = SecretsStore::magic().to_vec();
    blob.extend_from_slice(&dpapi_protect(plain)?);
    Ok(blob)
}

fn dpapi_protect(plain: &[u8]) -> Result<Vec<u8>, String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{HLOCAL, LocalFree};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    unsafe {
        let input = CRYPT_INTEGER_BLOB {
            cbData: plain.len() as u32,
            pbData: plain.as_ptr() as *mut u8,
        };
        let mut out = CRYPT_INTEGER_BLOB::default();
        CryptProtectData(
            &input,
            PCWSTR::null(),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out,
        )
        .map_err(|e| e.to_string())?;
        let slice = std::slice::from_raw_parts(out.pbData, out.cbData as usize);
        let v = slice.to_vec();
        let _ = LocalFree(Some(HLOCAL(out.pbData as *mut core::ffi::c_void)));
        Ok(v)
    }
}

fn dpapi_unprotect(blob: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::{HLOCAL, LocalFree};
    use windows::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    unsafe {
        let input = CRYPT_INTEGER_BLOB {
            cbData: blob.len() as u32,
            pbData: blob.as_ptr() as *mut u8,
        };
        let mut out = CRYPT_INTEGER_BLOB::default();
        CryptUnprotectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out,
        )
        .map_err(|e| e.to_string())?;
        let slice = std::slice::from_raw_parts(out.pbData, out.cbData as usize);
        let v = slice.to_vec();
        let _ = LocalFree(Some(HLOCAL(out.pbData as *mut core::ffi::c_void)));
        Ok(v)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// exp.md §S2-3 字节布局符合性:`ASTBOX1\0`(8B magic)+ DPAPI
    /// (CurrentUser)blob + JSON(vid)。任何新实现必须原样读写此格式
    /// (跨版本密钥库零成本接管的前提)。C# 版互通在 P7 三方终验。
    #[test]
    fn secrets_bin_byte_layout_conformance() {
        let dir = std::env::temp_dir().join("astbox-secrets-conformance");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("secrets.bin");
        std::env::set_var("ASTBOX_SECRETS_PATH", &path);

        let mut reg = Registry::new();
        reg.put(
            "ab12cd34ef56ab12cd34ef56ab12cd34".to_string(), // vid key (hex)
            SecretEntry {
                b32: "JBSWY3DPEHPK3PXP".to_string(),
                digits: 8,
                created: Some(1700000000),
            },
        );
        SecretsStore::save(&reg).expect("save");

        let raw = std::fs::read(&path).unwrap();
        // 1) 8B magic 逐字节
        assert!(raw.len() > 8);
        assert_eq!(&raw[..8], b"ASTBOX1\0", "magic must be ASTBOX1\\0");
        // 2) 余下部分 = DPAPI(CurrentUser) blob, 可本进程解回
        let plain = dpapi_unprotect(&raw[8..]).expect("DPAPI blob readable in-scope");
        // 3) 明文 = JSON, vid 键存在且字段精确
        let doc: serde_json::Map<String, serde_json::Value> =
            serde_json::from_slice(&plain).expect("plaintext is JSON object");
        let entry = doc
            .get("ab12cd34ef56ab12cd34ef56ab12cd34")
            .expect("vid key present")
            .as_object()
            .unwrap();
        assert_eq!(entry.get("b32").unwrap().as_str().unwrap(), "JBSWY3DPEHPK3PXP");
        assert_eq!(entry.get("digits").unwrap().as_i64().unwrap(), 8);
        assert_eq!(entry.get("created").unwrap().as_i64().unwrap(), 1700000000);

        // 4) load 往返一致
        let back = SecretsStore::load();
        let got = back.get("ab12cd34ef56ab12cd34ef56ab12cd34").unwrap();
        assert_eq!(got.b32, "JBSWY3DPEHPK3PXP");
        assert_eq!(got.digits, 8);
        assert_eq!(got.created, Some(1700000000));

        let _ = std::fs::remove_file(&path);
        std::env::remove_var("ASTBOX_SECRETS_PATH");
    }
}
