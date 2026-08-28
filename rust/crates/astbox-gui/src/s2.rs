// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
//! P5 S2′ 无缝迁移 —— exp.md §2.1 逐语义翻译(装后兜底;NSIS 检测段见 P6)。
//!
//! - #1 per-user 安装,独立目录(旧 Inno/MSI 与新 NSIS 可共存后再迁移)
//! - #2 首装静默卸载旧版:Inno `unins000.exe /VERYSILENT /SUPPRESSMSGBOXES
//!   /NORESTART`;MSI `msiexec /x {ProductCode} /qn`(CustomAction 语义的
//!   Rust 兜底等价物,base64 编码脚本不再需要 —— 直接 spawn)
//! - #3 密钥库零成本接管:`secrets.bin` 格式跨版本稳定(`ASTBOX1\0` +
//!   DPAPI(CurrentUser) blob + JSON vid)→ 同用户路径不变,免重录;
//!   本模块只校验其存在,不做任何复制
//! - #4 关联自动切换:契约一致即自然覆盖(assoc::write_contract)
//! - #5 卸载残骸:Inno `unins000.dat` 只读残留 → 清属性后删;校验旧目录

use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, PartialEq)]
pub enum LegacyKind {
    Inno { uninstaller: String },
    Msi { product_code: String },
}

#[derive(Debug, Clone)]
pub struct LegacyInstall {
    pub key_name: String,
    pub display: String,
    pub location: String,
    pub kind: LegacyKind,
}

#[derive(Debug, Default)]
pub struct MigrateReport {
    pub uninstalled: Vec<(String, bool)>,
    pub remnants_cleared: Vec<String>,
    pub secrets_kept: bool,
}

const UNINSTALL_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall";

/// 扫描 HKCU 卸载登记,识别旧 ASTBOX 安装(Inno `_is1` / MSI GUID)。
/// 跳过当前安装本身(InstallLocation 与本进程同目录)。
pub fn detect_legacy(self_dir: Option<&Path>) -> Vec<LegacyInstall> {
    let mut found = Vec::new();
    let root = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
    let Ok(uninst) = root.open_subkey_with_flags(UNINSTALL_KEY, winreg::enums::KEY_READ) else {
        return found;
    };
    for name in uninst.enum_keys().flatten() {
        let Ok(k) = uninst.open_subkey_with_flags(&name, winreg::enums::KEY_READ) else {
            continue;
        };
        let display: String = k.get_value("DisplayName").unwrap_or_default();
        if !display.to_lowercase().contains("astbox") {
            continue;
        }
        let location: String = k.get_value("InstallLocation").unwrap_or_default();
        if let Some(sd) = self_dir {
            if !location.is_empty()
                && Path::new(&location).canonicalize().ok()
                    == Some(sd.canonicalize().unwrap_or_else(|_| sd.to_path_buf()))
            {
                continue; // 我们自己(NSIS)的登记
            }
        }
        let uninst_str: String = k.get_value("UninstallString").unwrap_or_default();
        let low = uninst_str.to_lowercase();
        let kind = if name.ends_with("_is1") && low.contains("unins000.exe") {
            LegacyKind::Inno {
                uninstaller: parse_quoted_program(&uninst_str),
            }
        } else if low.contains("msiexec") {
            // UninstallString: MsiExec.exe /X{GUID} 或 /I{GUID}
            let code = uninst_str
                .split(['/'])
                .find_map(|seg| seg.strip_prefix('X').or_else(|| seg.strip_prefix('I')))
                .unwrap_or(&name)
                .trim()
                .to_string();
            LegacyKind::Msi { product_code: code }
        } else if is_guid(&name) {
            LegacyKind::Msi { product_code: name.clone() }
        } else {
            continue; // 未知通道,不盲动
        };
        found.push(LegacyInstall {
            key_name: name,
            display,
            location,
            kind,
        });
    }
    found
}

fn is_guid(s: &str) -> bool {
    s.starts_with('{') && s.ends_with('}') && s.len() == 38
}

/// UninstallString 的程序路径:引号内优先,否则取到第一个参数分隔。
fn parse_quoted_program(s: &str) -> String {
    let t = s.trim();
    if let Some(rest) = t.strip_prefix('"') {
        if let Some(end) = rest.find('"') {
            return rest[..end].to_string();
        }
    }
    t.split(" /").next().unwrap_or(t).trim().to_string()
}

/// §2.1-#2/#5:静默卸载 + 残骸清理。任何一步失败不中断(记录后继续)。
pub fn migrate_legacy(installs: &[LegacyInstall]) -> MigrateReport {
    let mut report = MigrateReport::default();
    for inst in installs {
        let ok = match &inst.kind {
            LegacyKind::Inno { uninstaller } => {
                if uninstaller.is_empty() || !Path::new(&uninstaller).is_file() {
                    false
                } else {
                    // spec §6.2 精确旗标(/SILENT, 非 /VERYSILENT)
                    Command::new(&uninstaller)
                        .args(["/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART"])
                        .status()
                        .map(|s| s.success())
                        .unwrap_or(false)
                }
            }
            LegacyKind::Msi { product_code } => Command::new("msiexec.exe")
                .args(["/x", product_code, "/qn"])
                .status()
                .map(|s| s.success())
                .unwrap_or(false),
        };
        report.uninstalled.push((inst.display.clone(), ok));

        // §2.1-#5 残骸:旧目录残留(unins000.dat 只读错误 5 场景)
        if !inst.location.is_empty() {
            let dir = PathBuf::from(&inst.location);
            if dir.is_dir() {
                clear_readonly_recursive(&dir);
                if std::fs::remove_dir_all(&dir).is_ok() {
                    report.remnants_cleared.push(inst.location.clone());
                }
            }
        }
    }
    // §2.1-#3 密钥库零成本接管:CurrentUser DPAPI → 路径/作用域不变
    report.secrets_kept = secrets_bin_exists();
    report
}

fn clear_readonly_recursive(dir: &Path) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
        let p = entry.path();
        if p.is_dir() {
            clear_readonly_recursive(&p);
        } else if let Ok(md) = std::fs::metadata(&p) {
            if md.permissions().readonly() {
                let mut perm = md.permissions();
                perm.set_readonly(false);
                let _ = std::fs::set_permissions(&p, perm);
            }
        }
    }
}

fn secrets_bin_exists() -> bool {
    let base = std::env::var("LOCALAPPDATA").unwrap_or_default();
    !base.is_empty() && Path::new(&base).join(r"ASTBOX\secrets.bin").is_file()
        || std::env::var("ASTBOX_SECRETS_PATH")
            .map(|p| Path::new(&p).is_file())
            .unwrap_or(false)
}
