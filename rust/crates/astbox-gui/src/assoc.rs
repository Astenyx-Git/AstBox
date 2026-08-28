// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
//! P5 关联治理 —— exp.md §1.1/§1.3 逐语义翻译(HKCU per-user, 免管理员)。
//!
//! 契约(exp.md §1.1, 三通道对齐;本实现为单点活机通道):
//! - `Software\Classes\.astbox`      = `Astbox.Container`(+OpenWithProgids 并行声明,不独占)
//! - `Software\Classes\Astbox.Container`  名称 `ASTBOX 容器`;`shell\open\command` = `"<exe>" "%1"`
//! - `Software\Classes\.passbox`     = `Astbox.Passbox`
//! - `Software\Classes\Astbox.Passbox`    `shell\open\command` = `"<exe>" --import-passbox "%1"`
//! - `Astbox.Container\DefaultIcon`  = `"<dir>\astbox.ico",0`(文件美术,非应用图标)
//! - `Astbox.Passbox\DefaultIcon`    = `"<dir>\passbox.ico",0`
//! - `Software\Astbox\Capabilities`  ApplicationName / ApplicationIcon(app.ico)/ FileAssociations
//! - `Software\RegisteredApplications` 值名/值 ASCII(坑#1)→ 指向 Capabilities
//!
//! 已验证的坑(§1.3)落点:
//! - #1 RegisteredApplications 值名 ASCII "ASTBOX";显示名放 Capabilities.ApplicationName
//! - #4 悬空 UserChoice → 启动时检测 → 清悬空 → 深链引导(§1.3-#5:UserChoice
//!   有 hash 校验不可直写,只能删除 + 深链 `ms-settings:defaultapps?registeredAppUser=ASTBOX`)

use std::io;
use std::path::PathBuf;

use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
use winreg::RegKey;

/// 双图标分离(§1.2):应用本体 app.ico 只进 Capabilities;
/// 文件关联 DefaultIcon 用 astbox.ico / passbox.ico。
pub struct AssocPaths {
    pub exe: PathBuf,
    pub icon_dir: PathBuf,
}

const PROGID_CONTAINER: &str = "Astbox.Container";
const PROGID_PASSBOX: &str = "Astbox.Passbox";
const REGISTERED_APP_NAME: &str = "ASTBOX"; // 坑#1: ASCII
const CAPABILITIES_PATH: &str = r"Software\Astbox\Capabilities";

fn hkcu() -> RegKey {
    RegKey::predef(HKEY_CURRENT_USER)
}

/// 写入 §1.1 全量契约。幂等(每次启动重写;安装位置变化即自愈
/// "注册表 vs 实际能力"错配)。
pub fn write_contract(p: &AssocPaths) -> io::Result<()> {
    let root = hkcu();

    // .astbox → ProgId(OpenWithProgids 并行声明,不独占)
    let (ext, _) = root.create_subkey_with_flags(r"Software\Classes\.astbox", KEY_WRITE)?;
    ext.set_value("", &PROGID_CONTAINER)?;
    let (owp, _) = ext.create_subkey("OpenWithProgids")?;
    owp.set_value(PROGID_CONTAINER, &"")?;

    // Astbox.Container
    let (prog, _) = root.create_subkey_with_flags(
        &format!(r"Software\Classes\{PROGID_CONTAINER}"),
        KEY_WRITE,
    )?;
    prog.set_value("", &"ASTBOX 容器")?;
    let (cmd, _) = prog.create_subkey(r"shell\open\command")?;
    cmd.set_value("", &format!("\"{}\" \"%1\"", p.exe.display()))?;
    let (di, _) = prog.create_subkey("DefaultIcon")?;
    di.set_value(
        "",
        &format!("\"{}\",0", p.icon_dir.join("astbox.ico").display()),
    )?;

    // .passbox → ProgId
    let (extp, _) = root.create_subkey_with_flags(r"Software\Classes\.passbox", KEY_WRITE)?;
    extp.set_value("", &PROGID_PASSBOX)?;
    let (owpp, _) = extp.create_subkey("OpenWithProgids")?;
    owpp.set_value(PROGID_PASSBOX, &"")?;

    // Astbox.Passbox
    let (progp, _) = root.create_subkey_with_flags(
        &format!(r"Software\Classes\{PROGID_PASSBOX}"),
        KEY_WRITE,
    )?;
    progp.set_value("", &"ASTBOX 传播包")?;
    let (cmdp, _) = progp.create_subkey(r"shell\open\command")?;
    cmdp.set_value(
        "",
        &format!("\"{}\" --import-passbox \"%1\"", p.exe.display()),
    )?;
    let (dip, _) = progp.create_subkey("DefaultIcon")?;
    dip.set_value(
        "",
        &format!("\"{}\",0", p.icon_dir.join("passbox.ico").display()),
    )?;

    // Capabilities(显示名在此;坑#1)
    let (cap, _) = root.create_subkey_with_flags(CAPABILITIES_PATH, KEY_WRITE)?;
    cap.set_value("ApplicationName", &"ASTBOX 容器管理器")?;
    cap.set_value(
        "ApplicationIcon",
        &format!("\"{}\",0", p.icon_dir.join("app.ico").display()),
    )?;
    let (fa, _) = cap.create_subkey("FileAssociations")?;
    fa.set_value(".astbox", &PROGID_CONTAINER)?;
    fa.set_value(".passbox", &PROGID_PASSBOX)?;

    // RegisteredApplications:值名 ASCII "ASTBOX" → 指向 Capabilities
    let (ra, _) = root.create_subkey_with_flags(r"Software\RegisteredApplications", KEY_WRITE)?;
    ra.set_value(REGISTERED_APP_NAME, &CAPABILITIES_PATH)?;

    Ok(())
}

/// 卸载对称清理(P6 NSIS 卸载段亦调用此语义)。密钥库不在清理范围。
pub fn remove_contract() -> io::Result<()> {
    let root = hkcu();
    let classes = root.open_subkey_with_flags(r"Software\Classes", KEY_WRITE)?;
    for name in [".astbox", PROGID_CONTAINER, ".passbox", PROGID_PASSBOX] {
        let _ = classes.delete_subkey_all(name);
    }
    if let Ok(cap_parent) = root.open_subkey_with_flags(r"Software\Astbox", KEY_WRITE) {
        // Capabilities 含 FileAssociations 子键 → 需递归删
        let _ = cap_parent.delete_subkey_all("Capabilities");
    }
    if let Ok(ra) = root.open_subkey_with_flags(r"Software\RegisteredApplications", KEY_WRITE) {
        let _ = ra.delete_value(REGISTERED_APP_NAME);
    }
    Ok(())
}

#[derive(Debug, Default, Clone)]
pub struct NudgeReport {
    /// 悬空 UserChoice 已自愈清除(C# "悬空 UserChoice 已清除" 日志行)
    pub dangling_cleared: Vec<String>,
    /// 被其他程序接管的扩展名("ext → ProgId")
    pub foreign: Vec<String>,
    /// 交互模式 + 本 epoch 未提示过 → 请求原生确权弹窗
    pub ask_user: bool,
}

/// 设置页深链(C# AssocDeepLink: EscapeDataString("ASTBOX") 无转义变化)。
pub fn assoc_deep_link() -> String {
    "ms-settings:defaultapps?registeredAppUser=ASTBOX".to_string()
}

fn nudge_key() -> RegKey {
    hkcu().create_subkey_with_flags(r"Software\Astbox", KEY_WRITE).unwrap().0
}

/// spec §5.3(C# Program.cs CheckAssociationNudge 逐行翻译):
/// 心跳先行(AssocNudgeLastRun);悬空 UserChoice(ProgId 键已不存在)直接
/// 自愈删除;被接管(foreign)记录 —— 交互模式且本 epoch 未提示过时请求
/// 弹窗;非交互只记日志不弹窗不写标记。尽力而为, 任何失败可观测不致命。
pub fn check_association_nudge(
    version: &str,
    interactive: bool,
) -> NudgeReport {
    let mut report = NudgeReport::default();
    // 轻量遥测: 最近一次检测时间(运维排障 + 执行链活性证据)
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let _ = nudge_key().set_value("AssocNudgeLastRun", &format!("{now} interactive={interactive}"));

    let root = hkcu();
    for (ext, progid) in [(".astbox", PROGID_CONTAINER), (".passbox", PROGID_PASSBOX)] {
        let Ok(file_exts) = root.open_subkey_with_flags(
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts",
            KEY_READ | KEY_WRITE,
        ) else {
            continue;
        };
        // FileExts 子键名保留点号(".astbox" — Explorer 惯例, 勿 trim)
        let Ok(ext_key) = file_exts.open_subkey_with_flags(ext, KEY_READ | KEY_WRITE) else {
            continue;
        };
        let Ok(uc) = ext_key.open_subkey_with_flags("UserChoice", KEY_READ) else {
            continue; // 回退生效, 无需干预
        };
        let Ok(pid) = uc.get_value::<String, _>("ProgId") else {
            continue;
        };
        if pid == progid {
            continue; // 已是我们
        }
        if root
            .open_subkey_with_flags(format!(r"Software\Classes\{pid}").as_str(), KEY_READ)
            .is_err()
        {
            // 悬空指针自愈: 指向的 ProgId 已不存在, 删除残留键恢复回退
            let _ = ext_key.delete_subkey("UserChoice");
            report.dangling_cleared.push(format!("{ext} 悬空 UserChoice({pid}) 已清除"));
            continue;
        }
        report.foreign.push(format!("{ext} → {pid}"));
    }
    if report.foreign.is_empty() {
        return report;
    }
    if !interactive {
        return report; // 非交互: 只记日志, 不弹窗不写标记
    }
    let prev = hkcu()
        .open_subkey_with_flags(r"Software\Astbox", KEY_READ)
        .and_then(|mk| mk.get_value::<String, _>("AssocNudgeVersion"))
        .unwrap_or_default();
    if prev == version {
        return report; // 本版本内不再打扰(epoch 于版本升级时重置)
    }
    report.ask_user = true;
    report
}

/// 弹窗后调用(epoch 标记写入与用户选择无关 —— C# 同款时序)。
pub fn mark_nudged(version: &str) {
    let _ = nudge_key().set_value("AssocNudgeVersion", &version);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// exp.md §1.1 契约符合性:写 → 逐键断言 → 清 → 断言净。
    /// 直测真实 HKCU(与 C# 活动机器通道同库);结尾 remove_contract 清理。
    #[test]
    #[ignore = "touches real HKCU; run explicitly (SAC/registry escalation playbook)"]
    fn contract_write_read_remove_roundtrip() {
        let exe = std::env::current_exe().unwrap();
        let icon_dir = exe.parent().unwrap().to_path_buf();
        let paths = AssocPaths { exe: exe.clone(), icon_dir: icon_dir.clone() };

        write_contract(&paths).expect("contract write");

        let root = RegKey::predef(HKEY_CURRENT_USER);
        let ext = root
            .open_subkey(r"Software\Classes\.astbox")
            .expect(".astbox exists");
        assert_eq!(ext.get_value::<String, _>("").unwrap(), "Astbox.Container");
        let owp = root
            .open_subkey(r"Software\Classes\.astbox\OpenWithProgids")
            .expect("OpenWithProgids parallel declaration");
        assert_eq!(
            owp.get_value::<String, _>("Astbox.Container").unwrap(),
            ""
        );

        let cmd = root
            .open_subkey(r"Software\Classes\Astbox.Container\shell\open\command")
            .unwrap();
        assert_eq!(
            cmd.get_value::<String, _>("").unwrap(),
            format!("\"{}\" \"%1\"", exe.display())
        );

        let di = root
            .open_subkey(r"Software\Classes\Astbox.Container\DefaultIcon")
            .unwrap();
        assert_eq!(
            di.get_value::<String, _>("").unwrap(),
            format!("\"{}\",0", icon_dir.join("astbox.ico").display())
        );

        let cmdp = root
            .open_subkey(r"Software\Classes\Astbox.Passbox\shell\open\command")
            .unwrap();
        assert_eq!(
            cmdp.get_value::<String, _>("").unwrap(),
            format!("\"{}\" --import-passbox \"%1\"", exe.display())
        );

        let cap = root.open_subkey(CAPABILITIES_PATH).unwrap();
        // 坑#1: 显示名在此, RegisteredApplications 值名保持 ASCII
        assert_eq!(
            cap.get_value::<String, _>("ApplicationName").unwrap(),
            "ASTBOX 容器管理器"
        );
        assert!(cap
            .get_value::<String, _>("ApplicationIcon")
            .unwrap()
            .contains("app.ico"));

        let ra = root.open_subkey(r"Software\RegisteredApplications").unwrap();
        assert_eq!(
            ra.get_value::<String, _>(REGISTERED_APP_NAME).unwrap(),
            CAPABILITIES_PATH
        );

        remove_contract().expect("contract remove");
        assert!(root.open_subkey(r"Software\Classes\.astbox").is_err());
        assert!(root.open_subkey(CAPABILITIES_PATH).is_err());
    }

    /// exp.md §1.3-#4/#5 + spec §5.4 行为矩阵:
    ///   dangling UserChoice      → 启动删除、回退恢复(非交互也删)
    ///   foreign live, 非交互     → 记录, foreign 键保留, 不弹窗不写标记
    ///   foreign live, 交互       → 请求弹窗;mark 后本 epoch 静默
    /// 直测真实 HKCU;结尾清理。
    #[test]
    #[ignore = "touches real HKCU FileExts; run explicitly"]
    fn nudge_matrix_dangling_and_foreign() {
        let root = RegKey::predef(HKEY_CURRENT_USER);
        let fe = root
            .open_subkey_with_flags(
                r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts",
                winreg::enums::KEY_WRITE,
            )
            .expect("FileExts");
        let (ext_key, _) = fe.create_subkey(".astbox").unwrap();

        // ① 悬空:ProgId 指向不存在的键
        {
            let (uc, _) = ext_key.create_subkey("UserChoice").unwrap();
            uc.set_value("ProgId", &"Astbox.DanglingProbe").unwrap();
        }
        let r = check_association_nudge("3.0.0", false);
        assert!(
            !r.dangling_cleared.is_empty(),
            "expected dangling detection, got {r:?}"
        );
        assert!(r.ask_user == false && r.foreign.is_empty());
        assert!(ext_key.open_subkey("UserChoice").is_err(), "cleared");

        // ② foreign live:ProgId 键存在(指向别的程序)
        let (cls, _) = root
            .create_subkey_with_flags(
                r"Software\Classes\Astbox.ForeignProbe\shell\open\command",
                winreg::enums::KEY_WRITE,
            )
            .unwrap();
        cls.set_value("", &r#""C:\Program Files\somewhere.exe" "%1""#).unwrap();
        {
            let (uc, _) = ext_key.create_subkey("UserChoice").unwrap();
            uc.set_value("ProgId", &"Astbox.ForeignProbe").unwrap();
        }
        // 前次运行的 epoch 标记会让交互首询静默 —— 测试前置清理
        if let Ok(mk) = root.open_subkey_with_flags(r"Software\Astbox", winreg::enums::KEY_WRITE) {
            let _ = mk.delete_value("AssocNudgeVersion");
        }

        // 非交互:记录但不弹窗、不写 epoch 标记
        let r = check_association_nudge("3.0.0", false);
        assert!(r.foreign.iter().any(|s| s.contains(".astbox")), "foreign logged: {r:?}");
        assert!(!r.ask_user, "non-interactive must not ask");
        let marker = root
            .open_subkey(r"Software\Astbox")
            .unwrap()
            .get_value::<String, _>("AssocNudgeVersion");
        assert!(marker.is_err(), "non-interactive must not write epoch marker");

        // 交互首次:请求弹窗
        let r = check_association_nudge("3.0.0", true);
        assert!(r.ask_user, "interactive first-epoch must ask");

        // mark 后本 epoch 静默(5.3 epoch 语义)
        mark_nudged("3.0.0");
        let r = check_association_nudge("3.0.0", true);
        assert!(!r.ask_user, "same-epoch must not re-ask");

        // 清理
        let _ = ext_key.delete_subkey("UserChoice");
        let _ = root.delete_subkey_all(r"Software\Classes\Astbox.ForeignProbe");
    }
}
