// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
//! ASTBOX v1.0 desktop shell (Tauri v2 port of the Astbox.Server GUI).
//!
//! The 20-command IPC surface (P3) replaces the HTTP server; the state
//! snapshot contract stays byte-compatible with the python/C# frontend.

// 发布版隐藏控制台黑框(GUI 子系统);debug 保留控制台便于启动诊断。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use tauri_specta::{collect_commands, Builder};

mod assoc;
mod commands;
mod errors;
mod s2;
mod secrets;
mod session;

fn main() {
    // Sandbox/dev convenience: let tests redirect the WebView2 user-data
    // folder (defaults to %LOCALAPPDATA%\<identifier>). Production behavior
    // is unchanged when the variable is absent.
    if let Ok(dir) = std::env::var("ASTBOX_WV2_DATA_DIR") {
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", dir);
    }

    let builder = Builder::<tauri::Wry>::new().commands(collect_commands![
        commands::state,
        commands::open,
        commands::unlock,
        commands::lock,
        commands::nav,
        commands::back,
        commands::forward,
        commands::up,
        commands::outdir,
        commands::extract,
        commands::verify,
        commands::totp,
        commands::pack,
        commands::demo,
        commands::add,
        commands::export_passbox,
        commands::selftest,
        commands::browse,
        commands::shutdown,
        commands::read_file_progress,
        commands::import_passbox,
        commands::take_pending_import,
    ]);

    // P0#4: generate TS bindings at debug-build time so the P4 frontend can
    // import command types at compile time. Anchor on CARGO_MANIFEST_DIR so
    // the path is CWD-independent.
    #[cfg(debug_assertions)]
    builder
        .export(
            // u64 progress counters (≤ 4 GiB) are exact under TS number
            // (2^53), so export them as numbers rather than bigint.
            specta_typescript::Typescript::default()
                .bigint(specta_typescript::BigIntExportBehavior::Number),
            concat!(env!("CARGO_MANIFEST_DIR"), "/../../../frontend/src/bindings.ts"),
        )
        .expect("failed to export typescript bindings");

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // 第二实例 → 聚焦 + 转交启动参数(深链/双击重入,P5)
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
            handle_launch_argv(app, &argv, true);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            app.manage(commands::SharedSession::new(session::AppState::new()));
            app.manage(commands::PendingImport(std::sync::Mutex::new(None)));

            p5_system_integration(app.handle());

            // 首实例启动参数(双击 .astbox / .passbox)
            let argv: Vec<String> = std::env::args().skip(1).collect();
            handle_launch_argv(app.handle(), &argv, false);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// P5 系统集成编排(exp.md §2 → §1):
/// S2′ 旧版迁移兜底 → 关联契约写入(幂等自愈错配)→ 悬空 UserChoice
/// 清理 + 深链引导。密钥库零成本接管 = 路径/作用域不变, 无需复制。
fn p5_system_integration(app: &tauri::AppHandle) {
    let self_dir = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(|p| p.to_path_buf()));

    // §2.1-#2 S2′ 兜底:静默卸载旧 Inno/MSI 版(正常路径由 NSIS 检测段做)
    let legacy = s2::detect_legacy(self_dir.as_deref());
    if !legacy.is_empty() {
        let report = s2::migrate_legacy(&legacy);
        eprintln!(
            "[s2] uninstalled={:?} remnants={:?} secrets_kept={}",
            report.uninstalled, report.remnants_cleared, report.secrets_kept
        );
    }

    // §1.1 契约写入(每次启动幂等重写 → 安装位置变化自愈)
    if let Some(exe) = std::env::current_exe().ok() {
        let icon_dir = assoc_icon_dir(&exe);
        if let Some(icon_dir) = icon_dir {
            match assoc::write_contract(&assoc::AssocPaths { exe, icon_dir }) {
                Ok(()) => {}
                Err(exc) => eprintln!("[assoc] contract write failed: {exc}"),
            }
        }
    }

    // spec §5.3(C# CheckAssociationNudge 逐行翻译): 双向错配检测
    // → 悬空自愈 → 被接管时交互确权弹窗(epoch 限频)+ 深链引导
    let version = app.package_info().version.to_string();
    let nudge = assoc::check_association_nudge(&version, true);
    if !nudge.dangling_cleared.is_empty() {
        eprintln!("[assoc] {:?}", nudge.dangling_cleared);
    }
    if nudge.ask_user {
        use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
        let detail = nudge.foreign.join("; ");
        let yes = app
            .dialog()
            .message(format!(
                "检测到以下文件类型的默认打开方式由其他程序接管:\n\n  {detail}\n\n是否前往系统设置改为 ASTBOX?\n(稍后可在 设置 > 应用 > 默认应用 > ASTBOX 中修改)"
            ))
            .title("ASTBOX 关联确权")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::YesNo)
            .blocking_show();
        // epoch 标记写入与用户选择无关(C# 同款时序)
        assoc::mark_nudged(&version);
        if yes {
            use tauri_plugin_opener::OpenerExt;
            let _ = app.opener().open_url(&assoc::assoc_deep_link(), None::<&str>);
        }
    }
}

/// 双图标(§1.2):ico 与 exe 同目录安装;开发期回退 installer/assets。
/// canonicalize 会产生 `\\?\` 前缀, 写注册表前剥掉(DefaultIcon 解析器
/// 对设备路径形式敏感)。
fn assoc_icon_dir(exe: &std::path::Path) -> Option<std::path::PathBuf> {
    fn clean(p: std::path::PathBuf) -> std::path::PathBuf {
        let s = p.to_string_lossy();
        if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
            std::path::PathBuf::from(format!(r"\\{rest}"))
        } else if let Some(rest) = s.strip_prefix(r"\\?\") {
            std::path::PathBuf::from(rest)
        } else {
            p
        }
    }
    let dir = exe.parent()?;
    if dir.join("astbox.ico").is_file() {
        return Some(clean(dir.to_path_buf()));
    }
    let dev = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../installer/assets");
    let dev = std::path::Path::new(dev);
    if dev.join("astbox.ico").is_file() {
        return Some(clean(dev.canonicalize().unwrap_or_else(|_| dev.to_path_buf())));
    }
    None
}

/// 启动参数语义(首实例与第二实例共用):
/// `<path.astbox>` → 直接打开;`--import-passbox <path>` → 挂起待导入,
/// 前端启动后经 take_pending_import 取走并弹出导入 Sheet。
fn handle_launch_argv(app: &tauri::AppHandle, argv: &[String], emit: bool) {
    let mut iter = argv.iter();
    while let Some(arg) = iter.next() {
        if arg == "--import-passbox" {
            if let Some(path) = iter.next() {
                if let Some(pending) = app.try_state::<commands::PendingImport>() {
                    if let Ok(mut guard) = pending.0.lock() {
                        *guard = Some(path.clone());
                    }
                }
                if emit {
                    use tauri::Emitter;
                    let _ = app.emit("pending-import", ());
                }
            }
        } else if arg.to_lowercase().ends_with(".astbox") {
            if let Some(state) = app.try_state::<commands::SharedSession>() {
                if let Ok(mut s) = state.lock() {
                    let _ = s.open_path(arg.trim().trim_matches('"'));
                }
            }
        }
    }
}
