// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
//! The 20-command IPC surface: a 1:1 semantic port of the C# server's
//! /api/* endpoints (each response merges the handler extras with the state
//! snapshot, mirroring the `{"ok":true, ...extra, "state":...}` envelope).
//!
//! open_upload is intentionally absent: the locked decision replaces the
//! multipart upload with path-based reading (选文件→传路径→Rust 直读).

use std::sync::Mutex;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::errors::ApiError;
use crate::session::{AppState, DemoInfo, NavTarget, PackInfo, Snapshot};

pub type SharedSession = Mutex<AppState>;

type CmdResult<T> = Result<T, ApiError>;

fn home_dir(app: &AppHandle) -> String {
    app.path()
        .home_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn with_session<T>(
    state: &State<SharedSession>,
    f: impl FnOnce(&mut AppState) -> CmdResult<T>,
) -> CmdResult<T> {
    let mut guard = state.lock().map_err(|_| ApiError::plain("session poisoned"))?;
    f(&mut guard)
}

// ------------------------------------------------------------- state-only

#[tauri::command]
#[specta::specta]
pub fn state(app: AppHandle, session: State<SharedSession>) -> CmdResult<Snapshot> {
    let home = home_dir(&app);
    with_session(&session, |s| Ok(s.snapshot(home.clone())))
}

#[tauri::command]
#[specta::specta]
pub fn open(
    app: AppHandle,
    session: State<SharedSession>,
    path: String,
) -> CmdResult<Snapshot> {
    let home = home_dir(&app);
    with_session(&session, |s| {
        s.open_path(path.trim().trim_matches('"'))?;
        Ok(s.snapshot(home.clone()))
    })
}

#[tauri::command]
#[specta::specta]
pub fn unlock(app: AppHandle, session: State<SharedSession>, totp: String) -> CmdResult<Snapshot> {
    let home = home_dir(&app);
    with_session(&session, |s| {
        s.unlock(totp.trim())?;
        Ok(s.snapshot(home.clone()))
    })
}

#[tauri::command]
#[specta::specta]
pub fn lock(app: AppHandle, session: State<SharedSession>) -> CmdResult<Snapshot> {
    let home = home_dir(&app);
    with_session(&session, |s| {
        s.lock();
        Ok(s.snapshot(home.clone()))
    })
}

#[tauri::command]
#[specta::specta]
pub fn nav(
    app: AppHandle,
    session: State<SharedSession>,
    target: Option<NavTarget>,
) -> CmdResult<Snapshot> {
    let home = home_dir(&app);
    with_session(&session, |s| {
        s.nav_to(target)?;
        Ok(s.snapshot(home.clone()))
    })
}

#[tauri::command]
#[specta::specta]
pub fn back(app: AppHandle, session: State<SharedSession>) -> CmdResult<Snapshot> {
    let home = home_dir(&app);
    with_session(&session, |s| {
        s.nav_back();
        Ok(s.snapshot(home.clone()))
    })
}

#[tauri::command]
#[specta::specta]
pub fn forward(app: AppHandle, session: State<SharedSession>) -> CmdResult<Snapshot> {
    let home = home_dir(&app);
    with_session(&session, |s| {
        s.nav_forward();
        Ok(s.snapshot(home.clone()))
    })
}

#[tauri::command]
#[specta::specta]
pub fn up(app: AppHandle, session: State<SharedSession>) -> CmdResult<Snapshot> {
    let home = home_dir(&app);
    with_session(&session, |s| {
        s.nav_up()?;
        Ok(s.snapshot(home.clone()))
    })
}

#[tauri::command]
#[specta::specta]
pub fn outdir(
    app: AppHandle,
    session: State<SharedSession>,
    path: String,
) -> CmdResult<Snapshot> {
    let home = home_dir(&app);
    with_session(&session, |s| {
        s.set_out_dir(path.trim());
        Ok(s.snapshot(home.clone()))
    })
}

// ------------------------------------------------------------- with extra

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct ExtractResult {
    pub count: usize,
    pub out: String,
    pub state: Snapshot,
}

/// /api/extract: out falls back to the session out_dir, which is then set
/// to the resolved value (python `(args.get("out") or SESSION.out_dir or "")`).
#[tauri::command]
#[specta::specta]
pub fn extract(
    app: AppHandle,
    session: State<SharedSession>,
    ids: Option<Vec<String>>,
    out: Option<String>,
) -> CmdResult<ExtractResult> {
    let home = home_dir(&app);
    with_session(&session, |s| {
        let out_raw = out
            .map(|o| o.trim().to_string())
            .filter(|o| !o.is_empty())
            .unwrap_or_else(|| s.out_dir().to_string());
        let out_dir = out_raw.trim().to_string();
        let (count, out_resolved) = s.extract(ids, &out_dir)?;
        s.set_out_dir(&out_resolved);
        Ok(ExtractResult {
            count,
            out: out_resolved,
            state: s.snapshot(home.clone()),
        })
    })
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct VerifyResult {
    pub message: String,
    pub state: Snapshot,
}

#[tauri::command]
#[specta::specta]
pub fn verify(app: AppHandle, session: State<SharedSession>) -> CmdResult<VerifyResult> {
    let home = home_dir(&app);
    with_session(&session, |s| {
        s.verify()?;
        Ok(VerifyResult {
            message: "完整性验证通过：全部数据记录认证成功".to_string(),
            state: s.snapshot(home.clone()),
        })
    })
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct TotpResult {
    pub code: String,
    pub state: Snapshot,
}

#[tauri::command]
#[specta::specta]
pub fn totp(
    app: AppHandle,
    session: State<SharedSession>,
    b32: String,
    digits: Option<u8>,
) -> CmdResult<TotpResult> {
    let home = home_dir(&app);
    with_session(&session, |s| {
        let code = s.totp(b32.trim(), digits.unwrap_or(6))?;
        Ok(TotpResult { code, state: s.snapshot(home.clone()) })
    })
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct PackResult {
    pub pack: PackInfo,
    pub state: Snapshot,
}

#[tauri::command]
#[specta::specta]
pub fn pack(
    app: AppHandle,
    session: State<SharedSession>,
    src: Option<String>,
    dst: Option<String>,
    digits: Option<u8>,
    b32: Option<String>,
    profile: Option<String>,
) -> CmdResult<PackResult> {
    let home = home_dir(&app);
    with_session(&session, |s| {
        let kdf_profile = match profile.as_deref().unwrap_or("high") {
            "high" => astbox_core::constants::Constants::KDF_PROFILE_HIGH,
            _ => astbox_core::constants::Constants::KDF_PROFILE_MEMORY_CONSTRAINED,
        };
        let info = s.pack(
            src.as_deref().unwrap_or(""),
            dst.as_deref().unwrap_or(""),
            digits.unwrap_or(6),
            b32.as_deref().filter(|b| !b.trim().is_empty()),
            kdf_profile,
        )?;
        Ok(PackResult { pack: info, state: s.snapshot(home.clone()) })
    })
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct DemoResult {
    pub demo: DemoInfo,
    pub state: Snapshot,
}

#[tauri::command]
#[specta::specta]
pub fn demo(
    app: AppHandle,
    session: State<SharedSession>,
    dst: Option<String>,
    digits: Option<u8>,
    profile: Option<String>,
) -> CmdResult<DemoResult> {
    let home = home_dir(&app);
    with_session(&session, |s| {
        let info = s.make_demo(
            dst.as_deref().unwrap_or(""),
            digits.unwrap_or(6),
            profile.as_deref().unwrap_or(""),
        )?;
        Ok(DemoResult { demo: info, state: s.snapshot(home.clone()) })
    })
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct AddResult {
    pub count: usize,
    pub state: Snapshot,
}

#[tauri::command]
#[specta::specta]
pub fn add(
    app: AppHandle,
    session: State<SharedSession>,
    paths: Vec<String>,
) -> CmdResult<AddResult> {
    let home = home_dir(&app);
    with_session(&session, |s| {
        let count = s.add_paths(&paths)?;
        Ok(AddResult { count, state: s.snapshot(home.clone()) })
    })
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct ExportPassboxResult {
    pub out: String,
    pub state: Snapshot,
}

#[tauri::command]
#[specta::specta]
pub fn export_passbox(
    app: AppHandle,
    session: State<SharedSession>,
    out: String,
    passphrase: Option<String>,
) -> CmdResult<ExportPassboxResult> {
    let home = home_dir(&app);
    with_session(&session, |s| {
        let out_path = out.trim().trim_matches('"').to_string();
        s.export_passbox(&out_path, passphrase.as_deref().filter(|p| !p.is_empty()))?;
        Ok(ExportPassboxResult { out: out_path, state: s.snapshot(home.clone()) })
    })
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct SelftestResult {
    pub lines: Vec<String>,
}

/// GET /api/selftest returns the plain string array (no state snapshot).
#[tauri::command]
#[specta::specta]
pub fn selftest() -> CmdResult<SelftestResult> {
    Ok(SelftestResult { lines: astbox_core::crypto::Crypto::selftest()? })
}

// ------------------------------------------------------------- dialogs

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct BrowseResult {
    pub paths: Vec<String>,
}

/// /api/browse via tauri-plugin-dialog (replaces the Win32 comdlg port).
/// mode: "file" | "dir" | "save"; filetypes: [[name, pattern], …].
/// Cancellation yields an empty list (python dialog semantics).
#[tauri::command]
#[specta::specta]
pub fn browse(
    app: AppHandle,
    mode: Option<String>,
    title: Option<String>,
    initial: Option<String>,
    filetypes: Option<Vec<(String, String)>>,
    defaultext: Option<String>,
) -> CmdResult<BrowseResult> {
    let mode = mode.unwrap_or_else(|| "file".into());
    let title = title.unwrap_or_default();
    let initial = initial.unwrap_or_default().trim().trim_matches('"').to_string();
    let dlg = app.dialog();
    let mut paths: Vec<String> = Vec::new();
    match mode.as_str() {
        "dir" => {
            let mut b = dlg.file();
            if !title.is_empty() {
                b = b.set_title(&title);
            }
            if !initial.is_empty() {
                b = b.set_directory(std::path::Path::new(&initial));
            }
            if let Some(f) = b.blocking_pick_folder() {
                paths.push(file_path_to_string(f));
            }
        }
        "save" => {
            let mut b = dlg.file();
            if !title.is_empty() {
                b = b.set_title(&title);
            }
            if !initial.is_empty() {
                b = b.set_directory(std::path::Path::new(&initial));
            }
            if let Some(name) = defaultext.as_deref().filter(|d| !d.is_empty()) {
                b = b.set_file_name(name);
            }
            if let Some(f) = b.blocking_save_file() {
                paths.push(file_path_to_string(f));
            }
        }
        _ => {
            let mut b = dlg.file();
            if !title.is_empty() {
                b = b.set_title(&title);
            }
            if let Some(fts) = &filetypes {
                for (name, pattern) in fts {
                    let exts: Vec<String> = pattern
                        .split([';', ','])
                        .map(|p| p.trim().trim_start_matches("*.").to_string())
                        .filter(|p| !p.is_empty() && *p != "*")
                        .collect();
                    if !exts.is_empty() {
                        b = b.add_filter(
                            name,
                            &exts.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
                        );
                    }
                }
            }
            if !initial.is_empty() {
                b = b.set_directory(std::path::Path::new(&initial));
            }
            if let Some(f) = b.blocking_pick_file() {
                paths.push(file_path_to_string(f));
            }
        }
    }
    Ok(BrowseResult { paths })
}

fn file_path_to_string(f: tauri_plugin_dialog::FilePath) -> String {
    match f {
        tauri_plugin_dialog::FilePath::Path(p) => p.to_string_lossy().into_owned(),
        tauri_plugin_dialog::FilePath::Url(u) => u.to_string(),
    }
}

// ------------------------------------------------------------- shutdown

/// 红点退出: reply first, then exit the app (python threading.Timer(0.3)).
#[tauri::command]
#[specta::specta]
pub fn shutdown(app: AppHandle) -> CmdResult<String> {
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        handle.exit(0);
    });
    Ok("ASTBOX 服务即将退出".to_string())
}

// ------------------------------------------------------------- P5 passbox

/// 双击 .passbox 的待导入路径(launch arg / single-instance re-entry)。
pub struct PendingImport(pub Mutex<Option<String>>);

/// 前端启动时取走待导入路径(取走即清空)。
#[tauri::command]
#[specta::specta]
pub fn take_pending_import(pending: State<PendingImport>) -> CmdResult<Option<String>> {
    let mut guard = pending.0.lock().map_err(|_| ApiError::plain("pending poisoned"))?;
    Ok(guard.take())
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct ImportPassboxResult {
    pub container: String,
    pub state: Snapshot,
}

/// §1.1 .passbox 导入:解包落盘 → 打开容器 → 密钥零成本注册。
/// 成功后容器处于 locked,用户以 TOTP 解锁(免重录)。
#[tauri::command]
#[specta::specta]
pub fn import_passbox(
    app: AppHandle,
    session: State<SharedSession>,
    path: String,
    passphrase: Option<String>,
) -> CmdResult<ImportPassboxResult> {
    let home = home_dir(&app);
    with_session(&session, |s| {
        let container =
            s.import_passbox(path.trim().trim_matches('"'), passphrase.as_deref())?;
        Ok(ImportPassboxResult {
            container,
            state: s.snapshot(home.clone()),
        })
    })
}

// ------------------------------------------------------------- P0 probe

/// Progress event pushed while streaming a file read in fixed-size chunks.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct ReadProgress {
    pub read: u64,
    pub total: u64,
}

/// P0#3 probe: constant-memory chunked read of an arbitrary-size file with
/// progress pushed through a Channel (P4 wires the big-file path to this).
#[tauri::command]
#[specta::specta]
pub fn read_file_progress(
    path: String,
    on_chunk: tauri::ipc::Channel<ReadProgress>,
) -> Result<u64, ApiError> {
    use std::io::Read;
    let total = std::fs::metadata(&path)
        .map_err(|e| ApiError::from(astbox_core::err!(astbox_core::errors::E::Io, "{}", e)))?
        .len();
    let mut file = std::fs::File::open(&path)
        .map_err(|e| ApiError::from(astbox_core::err!(astbox_core::errors::E::Io, "{}", e)))?;
    let mut chunk = vec![0u8; 1024 * 1024];
    let mut read: u64 = 0;
    loop {
        let n = file
            .read(&mut chunk)
            .map_err(|e| ApiError::from(astbox_core::err!(astbox_core::errors::E::Io, "{}", e)))?;
        if n == 0 {
            break;
        }
        // bytes stay in this 1 MiB buffer — only the counter crosses IPC
        read += n as u64;
        let _ = on_chunk.send(ReadProgress { read, total });
    }
    Ok(read)
}
