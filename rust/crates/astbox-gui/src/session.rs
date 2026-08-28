// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
//! Single-user local session: mirrors the original tkinter AstboxGui state
//! fields (line-fidelity port of python astbox_server.Session via the C#
//! Server). Parsed containers stay resident in memory while locked.

use std::collections::HashMap;

use astbox_core::constants::Constants;
use astbox_core::container::{cmp_ordinal, Container, Entry, ParsedContainer, UnlockedContainer};
use astbox_core::creator::{CreateParams, Creator};
use astbox_core::crypto::Crypto;
use astbox_core::errors::E;
use astbox_core::extractor::Extractor;
use astbox_core::modifier::Modifier;
use astbox_core::qr_util::QrUtil;
use astbox_core::err;

use crate::errors::ApiError;
use crate::secrets::{Registry, SecretEntry, SecretsStore};

// Server-level error codes (C# EApi strings).
pub mod eapi {
    pub const NO_CONTAINER: &str = "E_NO_CONTAINER";
    pub const NOT_UNLOCKED: &str = "E_NOT_UNLOCKED";
    pub const BAD_DIR: &str = "E_BAD_DIR";
    pub const BAD_OUT: &str = "E_BAD_OUT";
    pub const NO_FILES: &str = "E_NO_FILES";
    #[allow(dead_code)]
    pub const BROWSE: &str = "E_BROWSE";
    pub const AUTH_CODE: &str = "E_AUTH_CODE";
}

// ---------------------------------------------------------- snapshot DTOs

/// Fields and key names exactly mirror C# WriteSnapshot (frontend contract).
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct Snapshot {
    pub phase: String,
    pub info: Option<Info>,
    pub path: String,
    pub can_back: bool,
    pub can_forward: bool,
    pub can_up: bool,
    pub items: Vec<Item>,
    pub out_dir: String,
    pub home: String,
    pub qr_ok: bool,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct Info {
    pub name: String,
    pub path: String,
    pub vault_id: String,
    pub generation: u64,
    pub files: Option<u64>,
    pub slots_digits: Vec<u8>,
    pub status: String,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct Item {
    pub id: String,
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub size_h: String,
    pub modified: u64,
    pub modified_h: String,
}

/// /api/pack payload (C# DoPack).
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct PackInfo {
    pub b32: String,
    pub digits: u8,
    pub uri: String,
    pub matrix: Option<Vec<Vec<u8>>>,
    pub dst: String,
    pub vault_id: String,
    pub generation: u64,
    pub entries: usize,
}

/// /api/demo payload (C# MakeDemo — no vault_id/generation/entries).
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct DemoInfo {
    pub b32: String,
    pub digits: u8,
    pub uri: String,
    pub matrix: Option<Vec<Vec<u8>>>,
    pub dst: String,
}

// ------------------------------------------------------------- helpers

/// Port of the server's Human() (identical to astbox_cli._human).
pub fn human(bytes: u64) -> String {
    let units = ["B", "KiB", "MiB", "GiB", "TiB"];
    let mut n = bytes as f64;
    for &unit in &units {
        if n < 1024.0 || unit == "TiB" {
            return if unit == "B" {
                format!("{} B", bytes)
            } else {
                format!("{:.1} {}", n, unit)
            };
        }
        n /= 1024.0;
    }
    format!("{}", bytes)
}

/// Server FmtTime: local "%Y-%m-%d HH:mm" (no seconds, unlike the CLI).
fn fmt_time(t: u64) -> String {
    use chrono::{Local, TimeZone};
    if t > i64::MAX as u64 {
        return format!("{}", t);
    }
    match chrono::DateTime::from_timestamp(t as i64, 0) {
        Some(utc) => match Local.from_local_datetime(&utc.naive_local()) {
            chrono::LocalResult::Single(dt) => {
                dt.format("%Y-%m-%d %H:%M").to_string()
            }
            _ => format!("{}", t),
        },
        None => format!("{}", t),
    }
}

fn hex(data: &[u8]) -> String {
    astbox_core::bin::hex_lower(data)
}

/// python ValueError passthrough for non-hex id arguments.
fn from_hex(raw: &str) -> Result<Vec<u8>, ApiError> {
    astbox_core::bin::unhex(raw)
        .map_err(|_| ApiError::plain("non-hexadecimal number found in fromhex() argument"))
}

// --------------------------------------------------------------- session

/// /api/nav target (C# reads the raw JSON element; this typed shape covers
/// every payload the frontend emits).
#[derive(Debug, Clone, Default, serde::Deserialize, serde::Serialize, specta::Type)]
pub struct NavTarget {
    pub dir: Option<String>,
    pub path: Option<String>,
}

pub struct AppState {
    pc: Option<ParsedContainer>,
    uc: Option<UnlockedContainer>,
    file_path: Option<String>,
    cred: Option<String>,
    /// Base32 secret actually used at unlock (self-verification channel for
    /// /api/add); the entered TOTP code (cred) is display/log semantics only.
    cred_secret: Option<String>,
    current_dir: Vec<u8>,
    history: Vec<Vec<u8>>,
    forward: Vec<Vec<u8>>,
    out_dir: String,
    secrets: Registry,
}

impl AppState {
    pub fn new() -> Self {
        AppState {
            pc: None,
            uc: None,
            file_path: None,
            cred: None,
            cred_secret: None,
            current_dir: Constants::ROOT_DIRECTORY_ID.to_vec(),
            history: Vec::new(),
            forward: Vec::new(),
            out_dir: String::new(),
            secrets: SecretsStore::load(),
        }
    }

    fn vid_key(vault_id: &[u8]) -> String {
        hex(vault_id)
    }

    pub fn set_out_dir(&mut self, value: &str) {
        self.out_dir = value.to_string();
    }

    pub fn out_dir(&self) -> &str {
        &self.out_dir
    }

    /// Record a known secret for the currently open container
    /// (merges to preserve an existing created timestamp).
    pub fn remember_secret(&mut self, b32: &str, digits: u8, created: Option<i64>) {
        if b32.is_empty() {
            return;
        }
        let Some(pc) = &self.pc else { return };
        let key = Self::vid_key(&pc.header.vault_id);
        self.remember_secret_for(key, b32.to_string(), digits, created);
    }

    /// Register a secret directly by VaultID (called after packing).
    pub fn register_secret(
        &mut self,
        vault_id: &[u8],
        b32: &str,
        digits: u8,
        created: Option<i64>,
    ) {
        if !b32.is_empty() {
            let key = Self::vid_key(vault_id);
            self.remember_secret_for(key, b32.to_string(), digits, created);
        }
    }

    fn remember_secret_for(
        &mut self,
        key: String,
        b32: String,
        digits: u8,
        created: Option<i64>,
    ) {
        let old_created = self.secrets.get(&key).and_then(|e| e.created);
        self.secrets.put(
            key,
            SecretEntry {
                b32,
                digits,
                created: created.or(old_created),
            },
        );
        if let Err(exc) = SecretsStore::save(&self.secrets) {
            eprintln!("  [warn] 密钥注册表落盘失败: {}", exc);
        }
    }

    /// §10/§67: allow adjacent time steps to compensate clock skew. A known
    /// secret with matching digits generates candidates at "now" and at the
    /// container creation time, ±5 steps each.
    fn window_candidates(&self, vault_id: &[u8], digits_hint: Option<u8>) -> Vec<String> {
        let Some(entry) = self.secrets.get(&Self::vid_key(vault_id)) else {
            return Vec::new();
        };
        if let Some(hint) = digits_hint {
            if entry.digits != hint {
                return Vec::new();
            }
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let mut bases: Vec<i64> = vec![now];
        if let Some(cr) = entry.created {
            bases.push(cr);
        }
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut codes = Vec::new();
        for b in bases {
            for step in -5i64..=5 {
                let t = b + step * Constants::TOTP_PERIOD as i64;
                let Ok(code) = Crypto::totp_at(&entry.b32, entry.digits as u32, Some(t))
                else {
                    continue;
                };
                if seen.insert(code.clone()) {
                    codes.push(code);
                }
            }
        }
        codes
    }

    pub fn phase(&self) -> String {
        if self.uc.is_some() {
            "unlocked".into()
        } else if self.pc.is_some() {
            "locked".into()
        } else {
            "empty".into()
        }
    }

    fn parsed(&self) -> Option<&ParsedContainer> {
        self.uc.as_ref().map(|u| &u.parsed).or(self.pc.as_ref())
    }

    pub fn current_path(&self) -> String {
        let Some(uc) = &self.uc else { return "/".into() };
        if self.current_dir == Constants::ROOT_DIRECTORY_ID {
            return "/".into();
        }
        let mut parts: Vec<String> = Vec::new();
        let mut cur = &uc.entries[&self.current_dir];
        while cur.parent_id != Constants::ROOT_DIRECTORY_ID {
            parts.push(cur.name.clone());
            cur = &uc.entries[&cur.parent_id];
        }
        parts.push(cur.name.clone());
        parts.reverse();
        format!("/{}", parts.join("/"))
    }

    /// python: sort by (is_file, name.lower())
    fn listing(&self) -> Vec<&Entry> {
        let Some(uc) = &self.uc else { return Vec::new() };
        let mut items: Vec<&Entry> = uc
            .children
            .get(&self.current_dir)
            .map(|kids| kids.iter().collect())
            .unwrap_or_default();
        items.sort_by(|a, b| {
            a.is_file()
                .cmp(&b.is_file())
                .then_with(|| {
                    a.name
                        .to_lowercase()
                        .as_bytes()
                        .cmp(b.name.to_lowercase().as_bytes())
                })
        });
        items
    }

    fn write_info(&self) -> Option<Info> {
        let parsed = self.parsed()?;
        let unlocked = self.uc.is_some();
        let files = if unlocked {
            Some(
                self.uc.as_ref().unwrap().entries.values().filter(|e| e.is_file()).count()
                    as u64,
            )
        } else {
            None
        };
        Some(Info {
            name: std::path::Path::new(&parsed.path)
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| parsed.path.clone()),
            path: parsed.path.clone(),
            vault_id: hex(&parsed.header.vault_id),
            generation: parsed.header.generation,
            files,
            slots_digits: parsed
                .slots
                .iter()
                .filter(|s| s.is_totp())
                .map(|s| s.totp_digits().unwrap_or(6))
                .collect(),
            status: if unlocked { "已解锁".into() } else { "未解锁".into() },
        })
    }

    pub fn snapshot(&self, home: String) -> Snapshot {
        Snapshot {
            phase: self.phase(),
            info: self.write_info(),
            path: self.current_path(),
            can_back: !self.history.is_empty(),
            can_forward: !self.forward.is_empty(),
            can_up: self.uc.is_some()
                && self.current_dir != Constants::ROOT_DIRECTORY_ID,
            items: self
                .listing()
                .into_iter()
                .map(|e| Item {
                    id: hex(&e.file_id),
                    name: e.name.clone(),
                    is_dir: e.is_dir(),
                    size: if e.is_dir() { 0 } else { e.size },
                    size_h: if e.is_dir() { String::new() } else { human(e.size) },
                    modified: e.modified,
                    modified_h: fmt_time(e.modified),
                })
                .collect(),
            out_dir: self.out_dir.clone(),
            home,
            qr_ok: QrUtil::available(),
        }
    }

    // ------------------------------------------------------------ actions

    pub fn open_path(&mut self, path: &str) -> Result<(), ApiError> {
        if path.is_empty() || !std::path::Path::new(path).is_file() {
            return Err(ApiError::plain(format!("文件不存在: {}", path)));
        }
        let pc = Container::parse_container(path, None).map_err(ApiError::from)?;
        self.pc = Some(pc);
        self.uc = None;
        self.cred = None;
        self.cred_secret = None;
        self.file_path = Some(path.to_string());
        self.current_dir = Constants::ROOT_DIRECTORY_ID.to_vec();
        self.history.clear();
        self.forward.clear();
        Ok(())
    }

    /// P5 §1.1 .passbox 导入(exp.md 双击语义):解包 → 容器落盘并打开 →
    /// 密钥零成本注册(§2.1-#3 同款接管语义)。digits/created 取传播包头。
    pub fn import_passbox(
        &mut self,
        path: &str,
        passphrase: Option<&str>,
    ) -> Result<String, ApiError> {
        let r = astbox_core::passbox_file::PassboxFile::unwrap_secret(path, passphrase)
            .map_err(ApiError::from)?;
        self.open_path(&r.container_path)?;
        let vid = self
            .pc
            .as_ref()
            .expect("open_path just parsed it")
            .header
            .vault_id
            .clone();
        let digits = r
            .header
            .get("digits")
            .and_then(|v| v.as_u64())
            .map(|d| d as u8)
            .unwrap_or(6);
        let created = r.header.get("created").and_then(|v| v.as_i64());
        self.register_secret(&vid, &r.secret_base32, digits, created);
        Ok(r.container_path)
    }

    /// Unlock the open container (verification-code path only). The code is
    /// first constant-time verified inside the now±5 / created±5 windows,
    /// then the registry's Base32 secret performs the KDF unlock.
    pub fn unlock(&mut self, totp: &str) -> Result<(), ApiError> {
        let Some(pc) = &self.pc else {
            return Err(ApiError::api(eapi::NO_CONTAINER, "尚未打开容器"));
        };
        let vid = pc.header.vault_id.clone();
        let digits_hint = pc
            .slots
            .iter()
            .find(|s| s.is_totp())
            .and_then(|s| s.totp_digits());

        let registry_miss = self.secrets.get(&Self::vid_key(&vid)).is_none();
        if registry_miss || totp.trim().is_empty() {
            return Err(ApiError::api(
                eapi::AUTH_CODE,
                "本机没有该容器的密钥记录，无法校验验证码。请在封装该容器的设备上解锁，或重新封装。",
            ));
        }

        let expected = self.window_candidates(&vid, digits_hint);
        let typed = ascii_ignore_bytes(totp.trim());
        let verified = expected
            .iter()
            .any(|code| Crypto::constant_time_equals(&typed, code.as_bytes()));
        if !verified {
            let hint = match digits_hint {
                Some(dh) => format!("容器为 {} 位验证码", dh),
                None => "位数未知".into(),
            };
            return Err(ApiError::api(
                eapi::AUTH_CODE,
                format!(
                    "验证码不匹配（{}）。请核对：① 验证器时间已与本机同步(±150 秒内可自动补偿) ② 使用的是该容器对应的密钥",
                    hint
                ),
            ));
        }
        let b32 = self.secrets.get(&Self::vid_key(&vid)).unwrap().b32.clone();
        let pc = self.pc.take().expect("checked above");
        match Container::unlock_parsed(pc, None, Some(&b32)) {
            Ok(uc) => {
                self.finish_unlock(uc, totp, &b32);
                Ok(())
            }
            Err(exc) => Err(ApiError::api(
                eapi::AUTH_CODE,
                format!("验证码正确但容器解锁失败: {}", exc),
            )),
        }
    }

    fn finish_unlock(&mut self, uc: UnlockedContainer, cred: &str, cred_secret: &str) {
        self.cred = Some(cred.to_string());
        self.cred_secret = Some(cred_secret.to_string());
        self.file_path = Some(uc.parsed.path.clone());
        self.current_dir = Constants::ROOT_DIRECTORY_ID.to_vec();
        self.history.clear();
        self.forward.clear();
        self.uc = Some(uc);
        self.pc = None;
    }

    pub fn lock(&mut self) {
        if let Some(uc) = self.uc.take() {
            self.pc = Some(uc.parsed);
        }
        self.cred = None;
        self.cred_secret = None;
        self.current_dir = Constants::ROOT_DIRECTORY_ID.to_vec();
        self.history.clear();
        self.forward.clear();
    }

    /// target: {"dir": hex-or-'root'} or {"path": "/a/b"}; None takes the
    /// empty-object path branch (python args={} semantics). An explicit
    /// `"dir": null` follows the C# "no dir" rule and lands on the path
    /// branch as "/" (indistinguishable from a missing key on the wire).
    pub fn nav_to(&mut self, target: Option<NavTarget>) -> Result<(), ApiError> {
        if self.uc.is_none() {
            return Ok(());
        }
        let new_dir = match target.as_ref().and_then(|t| t.dir.as_deref()) {
            Some(raw) => self.resolve_dir(raw)?,
            None => {
                let path = target
                    .as_ref()
                    .and_then(|t| t.path.as_deref())
                    .unwrap_or("/");
                let path = path.trim();
                if path.is_empty() || path == "/" || path == "\\" {
                    Constants::ROOT_DIRECTORY_ID.to_vec()
                } else {
                    let mut cur = Constants::ROOT_DIRECTORY_ID.to_vec();
                    for p in path.trim_matches(|c| c == '/' || c == '\\').split('/') {
                        if p.is_empty() {
                            continue;
                        }
                        let uc = self.uc.as_ref().unwrap();
                        let found = uc.children.get(&cur).and_then(|siblings| {
                            siblings
                                .iter()
                                .find(|e| e.is_dir() && &e.name == p)
                                .map(|e| e.file_id.clone())
                        });
                        let Some(id) = found else {
                            return Err(ApiError::api(
                                eapi::BAD_DIR,
                                format!("未找到目录: {}", path),
                            ));
                        };
                        cur = id;
                    }
                    cur
                }
            }
        };
        if new_dir != self.current_dir {
            self.history.push(self.current_dir.clone());
            self.forward.clear();
        }
        self.current_dir = new_dir;
        Ok(())
    }

    /// nav_to({"dir": hex}) internal direct path (same state transition).
    fn resolve_dir(&self, raw: &str) -> Result<Vec<u8>, ApiError> {
        if raw == "root" || raw == "/" || raw.is_empty() {
            return Ok(Constants::ROOT_DIRECTORY_ID.to_vec());
        }
        let id = from_hex(raw)?;
        let uc = self.uc.as_ref().unwrap();
        match uc.entries.get(&id) {
            Some(ent) if ent.is_dir() => Ok(id),
            _ => Err(ApiError::api(eapi::BAD_DIR, "目录不存在")),
        }
    }

    pub fn nav_back(&mut self) {
        if !self.history.is_empty() && self.uc.is_some() {
            self.forward.push(self.current_dir.clone());
            self.current_dir = self.history.pop().unwrap();
        }
    }

    pub fn nav_forward(&mut self) {
        if !self.forward.is_empty() && self.uc.is_some() {
            self.history.push(self.current_dir.clone());
            self.current_dir = self.forward.pop().unwrap();
        }
    }

    pub fn nav_up(&mut self) -> Result<(), ApiError> {
        if self.uc.is_some() && self.current_dir != Constants::ROOT_DIRECTORY_ID {
            // python: self.nav_to({"dir": parent.hex()})
            let parent = self.uc.as_ref().unwrap().entries[&self.current_dir]
                .parent_id
                .clone();
            let raw = hex(&parent);
            let new_dir = self.resolve_dir(&raw)?;
            if new_dir != self.current_dir {
                self.history.push(self.current_dir.clone());
                self.forward.clear();
            }
            self.current_dir = new_dir;
        }
        Ok(())
    }

    pub fn extract(
        &mut self,
        ids: Option<Vec<String>>,
        out_dir: &str,
    ) -> Result<(usize, String), ApiError> {
        let Some(uc) = &self.uc else {
            return Err(ApiError::api(eapi::NOT_UNLOCKED, "请先解锁容器"));
        };
        if out_dir.is_empty() {
            return Err(ApiError::api(eapi::BAD_OUT, "请指定输出目录"));
        }
        std::fs::create_dir_all(out_dir)
            .map_err(|e| ApiError::from(err!(E::Io, "cannot create {}: {}", out_dir, e)))?;
        let n = match ids {
            None => {
                Extractor::extract_all(uc, out_dir, None, false)
                    .map_err(ApiError::from)?
                    .len()
            }
            Some(ids) => {
                let mut targets: Vec<&Entry> = Vec::new();
                for hx in &ids {
                    let id = from_hex(hx)?;
                    if let Some(ent) = uc.entries.get(&id) {
                        if ent.is_file() {
                            targets.push(ent);
                        }
                    }
                }
                if targets.is_empty() {
                    return Err(ApiError::api(eapi::NO_FILES, "所选项目中没有文件"));
                }
                for ent in &targets {
                    Extractor::extract_entry(uc, ent, out_dir, None)
                        .map_err(ApiError::from)?;
                }
                targets.len()
            }
        };
        Ok((n, out_dir.to_string()))
    }

    pub fn verify(&self) -> Result<(), ApiError> {
        let Some(uc) = &self.uc else {
            return Err(ApiError::api(eapi::NOT_UNLOCKED, "请先解锁容器"));
        };
        Container::verify_full(uc).map_err(ApiError::from)
    }

    /// /api/totp helper: compute + remember (needs an open container).
    pub fn totp(&mut self, b32: &str, digits: u8) -> Result<String, ApiError> {
        let code = Crypto::totp_at(b32, digits as u32, None).map_err(ApiError::from)?;
        self.remember_secret(b32, digits, None);
        Ok(code)
    }

    /// do_pack: pack a folder (or all contents of the currently unlocked
    /// container) into a new container. NOTE: the C# enumeration order is
    /// unspecified; we sort by relative path for determinism (same
    /// deviation as the CLI, effectively NTFS index order).
    pub fn pack(
        &mut self,
        src: &str,
        dst: &str,
        digits: u8,
        b32: Option<&str>,
        profile: u16,
    ) -> Result<PackInfo, ApiError> {
        let dst = dst.trim().trim_matches('"');
        if dst.is_empty() {
            return Err(ApiError::api(eapi::BAD_OUT, "请指定目标文件"));
        }
        let src = src.trim().trim_matches('"');
        if !src.is_empty() && !std::path::Path::new(src).is_dir() {
            return Err(ApiError::api(eapi::BAD_DIR, format!("源文件夹不存在: {}", src)));
        }
        if let Some(parent) = std::path::Path::new(dst).parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent).map_err(|e| {
                    ApiError::from(err!(E::Io, "cannot create {}: {}", parent.display(), e))
                })?;
            }
        }

        let mut files: Vec<(String, Vec<u8>)> = Vec::new();
        if !src.is_empty() {
            files = gather_dir_files(src)?;
        } else if let Some(uc) = &self.uc {
            for (path, ent) in Container::walk_entries(uc) {
                if ent.is_file() {
                    let data = Container::read_file(uc, &ent).map_err(ApiError::from)?;
                    files.push((path, data));
                }
            }
        } else {
            return Err(ApiError::api(
                eapi::BAD_DIR,
                "请先打开并解锁要封装的容器，或指定源文件夹",
            ));
        }

        let b32_used = match b32 {
            Some(b) if !b.trim().is_empty() => b.trim().to_string(),
            _ => QrUtil::generate_secret(20).map_err(ApiError::from)?,
        };
        let uc = Creator::create_container(
            dst,
            &CreateParams {
                totp_secret: Some(&b32_used),
                totp_digits: digits,
                files,
                kdf_profile: profile,
                ..Default::default()
            },
        )
        .map_err(ApiError::from)?;

        self.register_secret(
            &uc.parsed.header.vault_id,
            &b32_used,
            digits,
            Some(uc.created as i64),
        );

        let (uri, matrix) = qr_payload(&b32_used, digits, &format!("ASTBOX:{}", file_name(dst)));
        Ok(PackInfo {
            b32: b32_used,
            digits,
            uri,
            matrix,
            dst: dst.to_string(),
            vault_id: hex(&uc.parsed.header.vault_id),
            generation: uc.parsed.header.generation,
            entries: uc.entries.len(),
        })
    }

    /// Create the built-in demo container at a user-specified location and
    /// open it (locked state).
    pub fn make_demo(
        &mut self,
        dst_raw: &str,
        digits_raw: u8,
        profile_str: &str,
    ) -> Result<DemoInfo, ApiError> {
        let dst = dst_raw.trim().trim_matches('"');
        if dst.is_empty() {
            return Err(ApiError::api(eapi::BAD_OUT, "请指定保存位置"));
        }
        if let Some(parent) = std::path::Path::new(dst).parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent).map_err(|e| {
                    ApiError::from(err!(E::Io, "cannot create {}: {}", parent.display(), e))
                })?;
            }
        }
        let digits = if digits_raw == 6 { 6 } else { 8 };
        let profile = if profile_str == "constrained" {
            Constants::KDF_PROFILE_MEMORY_CONSTRAINED
        } else {
            Constants::KDF_PROFILE_HIGH
        };
        let secret = QrUtil::generate_secret(20).map_err(ApiError::from)?;
        let uc = Creator::create_container(
            dst,
            &CreateParams {
                totp_secret: Some(&secret),
                totp_digits: digits,
                files: demo_files(),
                kdf_profile: profile,
                ..Default::default()
            },
        )
        .map_err(ApiError::from)?;
        self.register_secret(&uc.parsed.header.vault_id, &secret, digits, Some(uc.created as i64));
        self.open_path(dst)?;
        self.remember_secret(&secret, digits, Some(uc.created as i64));
        let (uri, matrix) = qr_payload(&secret, digits, &format!("ASTBOX:{}", file_name(dst)));
        Ok(DemoInfo {
            b32: secret,
            digits,
            uri,
            matrix,
            dst: dst.to_string(),
        })
    }

    /// Add files from given paths (dirs recurse; relative logical paths).
    /// The new generation is self-verified through the secret channel (the
    /// KDF credential actually used at unlock); the TOTP ASCII code is not
    /// a KDF credential and cannot pass self-verification for
    /// secret-credential containers. (Absorbed from the C#-line review fix
    /// 519061c; byte layout untouched.)
    pub fn add_paths(&mut self, paths: &[String]) -> Result<usize, ApiError> {
        let Some(uc) = self.uc.take() else {
            return Err(ApiError::api(eapi::NOT_UNLOCKED, "请先解锁容器"));
        };
        let prefix = if self.current_dir == Constants::ROOT_DIRECTORY_ID {
            String::new()
        } else {
            let p = self.current_path();
            p.trim_start_matches('/').to_string()
        };
        // python dict semantics: insertion order kept, same-name overwrites
        let mut files: Vec<(String, Vec<u8>)> = Vec::new();
        let mut index: HashMap<String, usize> = HashMap::new();
        for raw_p in paths {
            let p = raw_p.trim().trim_matches('"');
            if p.is_empty() {
                continue;
            }
            if std::path::Path::new(p).is_dir() {
                for (rel, data) in gather_dir_files(p)? {
                    let logical = if prefix.is_empty() {
                        rel
                    } else {
                        format!("{}/{}", prefix, rel)
                    };
                    match index.get(&logical) {
                        Some(&i) => files[i].1 = data,
                        None => {
                            index.insert(logical.clone(), files.len());
                            files.push((logical, data));
                        }
                    }
                }
            } else if std::path::Path::new(p).is_file() {
                let logical = if prefix.is_empty() {
                    file_name(p)
                } else {
                    format!("{}/{}", prefix, file_name(p))
                };
                let data = std::fs::read(p).map_err(|e| {
                    ApiError::from(err!(E::Io, "cannot read {}: {}", p, e))
                })?;
                match index.get(&logical) {
                    Some(&i) => files[i].1 = data,
                    None => {
                        index.insert(logical.clone(), files.len());
                        files.push((logical, data));
                    }
                }
            }
        }
        if files.is_empty() {
            // restore the taken container before failing
            self.uc = Some(uc);
            return Err(ApiError::api(eapi::NO_FILES, "没有可添加的文件"));
        }
        let out_path = self.file_path.clone().unwrap_or_default();
        match Modifier::add_files(
            &uc,
            &files,
            &out_path,
            self.cred.as_deref(),
            self.cred_secret.as_deref(),
        )
        .map_err(ApiError::from)
        {
            Ok(Some(uc2)) => {
                self.uc = Some(uc2);
                self.pc = None;
            }
            Ok(None) => {
                // no-cred path: core commits without reopening (unreachable
                // in practice: unlocking always leaves a credential)
                self.uc = None;
            }
            Err(e) => {
                // C# propagates the self-verification failure with the old
                // session state intact (the file on disk is the new gen).
                self.uc = Some(uc);
                return Err(e);
            }
        }
        // New-generation entry IDs may change: fall back to root when the
        // current directory vanished.
        if self.current_dir != Constants::ROOT_DIRECTORY_ID
            && !self.uc.as_ref().unwrap().entries.contains_key(&self.current_dir)
        {
            self.current_dir = Constants::ROOT_DIRECTORY_ID.to_vec();
            self.history.clear();
            self.forward.clear();
        }
        Ok(files.len())
    }

    /// export_passbox (needs an unlocked container with a local secret
    /// record for its VaultID).
    pub fn export_passbox(
        &self,
        out_path: &str,
        passphrase: Option<&str>,
    ) -> Result<(), ApiError> {
        let Some(uc) = &self.uc else {
            return Err(ApiError::plain("请先解锁容器"));
        };
        if out_path.is_empty() {
            return Err(ApiError::plain("请指定输出路径"));
        }
        let key = Self::vid_key(&uc.parsed.header.vault_id);
        let Some(entry) = self.secrets.get(&key) else {
            return Err(ApiError::plain("本机没有该容器的密钥记录，无法生成传播包"));
        };
        let digits = if entry.digits != 0 { entry.digits } else { 6 };
        astbox_core::passbox_file::PassboxFile::pack_passbox(
            &uc.parsed.path,
            &entry.b32,
            digits,
            Some(uc.created as i64),
            out_path,
            passphrase,
        )
        .map(|_| ())
        .map_err(|exc| {
            ApiError::plain(format!("生成失败: {}: {}", exc.code_name(), exc.message))
        })
    }

    /// Known-secret lookup for browse-side display (none today) and the
    /// metadata sheet; exposed for future use.
    #[allow(dead_code)]
    pub fn secret_for_current(&self) -> Option<&SecretEntry> {
        let pc = self.parsed()?;
        self.secrets.get(&Self::vid_key(&pc.header.vault_id))
    }
}

fn ascii_ignore_bytes(s: &str) -> Vec<u8> {
    s.bytes().filter(|&b| b < 128).collect()
}

fn file_name(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

/// otpauth URI + QR matrix (None when the generator is unavailable).
fn qr_payload(secret: &str, digits: u8, label: &str) -> (String, Option<Vec<Vec<u8>>>) {
    let uri = QrUtil::build_otpauth_uri(secret, digits, label);
    let matrix = if QrUtil::available() {
        QrUtil::qr_matrix(&uri, 2)
            .ok()
            .map(|rows| {
                rows.into_iter()
                    .map(|row| row.into_iter().map(|c| if c { 1u8 } else { 0u8 }).collect())
                    .collect()
            })
    } else {
        None
    };
    (uri, matrix)
}

/// Enumerate files under `dir` as (relative logical path, bytes), sorted by
/// relative path (deterministic; see pack() note).
pub fn gather_dir_files(dir: &str) -> Result<Vec<(String, Vec<u8>)>, ApiError> {
    fn walk(
        root: &std::path::Path,
        cur: &std::path::Path,
        out: &mut Vec<(String, Vec<u8>)>,
    ) -> Result<(), ApiError> {
        for entry in std::fs::read_dir(cur)
            .map_err(|e| ApiError::from(err!(E::Io, "cannot read {}: {}", cur.display(), e)))?
        {
            let entry = entry
                .map_err(|e| ApiError::from(err!(E::Io, "readdir: {}", e)))?;
            let p = entry.path();
            if p.is_dir() {
                walk(root, &p, out)?;
            } else if p.is_file() {
                let rel = p
                    .strip_prefix(root)
                    .unwrap_or(&p)
                    .to_string_lossy()
                    .replace('\\', "/");
                let data = std::fs::read(&p).map_err(|e| {
                    ApiError::from(err!(E::Io, "cannot read {}: {}", p.display(), e))
                })?;
                out.push((rel, data));
            }
        }
        Ok(())
    }
    let mut out = Vec::new();
    walk(std::path::Path::new(dir), std::path::Path::new(dir), &mut out)?;
    out.sort_by(|a, b| cmp_ordinal(&a.0, &b.0));
    Ok(out)
}

/// Server DemoFiles() replica (byte-for-byte), used by make_demo.
pub fn demo_files() -> Vec<(String, Vec<u8>)> {
    let text = b"ASTBOX v1.0 demo file.\n\nThis container was created by astbox-cli create --demo.\n";
    let guide = b"# ASTBOX decoder guide\n\nUnlock -> browse -> extract.\n";
    let mut readme = Vec::with_capacity(text.len() * 20);
    for _ in 0..20 {
        readme.extend_from_slice(text);
    }
    let mut guide_buf = Vec::with_capacity(guide.len() * 40);
    for _ in 0..40 {
        guide_buf.extend_from_slice(guide);
    }
    let big_len = 2 * 1048576 + 12345;
    let mut big = Vec::with_capacity(big_len);
    for i in 0..big_len {
        big.push(((i * 131 + 7) % 256) as u8);
    }
    vec![
        ("readme.txt".to_string(), readme),
        ("docs/guide.md".to_string(), guide_buf),
        ("assets/random.bin".to_string(), big),
        ("empty.txt".to_string(), Vec::new()),
        (
            "docs/notes/\u{6d4b}\u{8bd5}.txt".to_string(),
            b"unicode file name test\n".to_vec(),
        ),
    ]
}
