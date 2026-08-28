// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
/* ============================================================
   ASTBOX · Liquid Glass Web UI
   交互层：状态渲染 / 菜单 / Sheet / Toast / OTP / 拖放
   ============================================================ */
"use strict";

/* ---------------- i18n ---------------- */
const _LANG_KEY = "astbox_lang";
let _lang = localStorage.getItem(_LANG_KEY) || "zh";

function _t(key) {
  const dict = _I18N[_lang] || _I18N.zh;
  return (dict[key] !== undefined) ? dict[key] : (_I18N.zh[key] || key);
}

const _I18N = {
  zh: {
    // 状态栏
    sEmpty: "就绪 — 打开一个 .astbox 容器开始",
    sLocked: "容器已加载，输入 TOTP 验证码解锁",
    sUnlocked: "已解锁",
    // 地址栏
    addrEdit: "双击编辑路径",
    // OTP
    otpEnter: "请输入完整的 %d 位验证码",
    otpDigit: "第%d位验证码",
    otpDigitsLbl: "%d 位验证码",
    // 错误
    errConn: "与服务器的连接中断",
    errReq: "请求失败 (%d)",
    errFileSize: "容器超过 4 GiB 上限，请用“浏览(本机路径)”方式打开",
    errOutput: "请先在边栏填写输出目录",
    errUnlock: "请先解锁容器",
    errSpecify: "请指定目标文件",
    errPaths: "请至少填写一个路径",
    atLeastOnePath: "请至少填写一个路径",
    errBrowse: "无法打开系统对话框，请手动输入路径",
    errNoSel: "请先在列表中选择文件",
    // Toast/确认
    tUnlocked: "容器已解锁",
    tLocked: "已锁定",
    tCopied: "已复制",
    file: "文件",
    tExtracted: "已提取 %d 个文件 → %s",
    tGen: "已生成",
    // 菜单
    mExtractSel: "提取选中文件",
    mExtractAll: "提取全部文件",
    mOpenFolder: "打开（进入文件夹）",
    mRefresh: "刷新",
    mExportPack: "生成 .passbox 传播包",
    mLock: "锁定容器",
    mAbout: "关于此应用",
    // Sheet 标题
    shOpen: "打开容器",
    shOpenSub: "选择或输入服务器本机上的 .astbox 文件",
    shPack: "封装为 .astbox 容器",
    shPackSub: "把文件夹打包为加密容器，TOTP 为唯一打开凭据",
    shAddFile: "添加文件到当前目录",
    shAddFolder: "添加文件夹到当前目录",
    shAddSub: "点击下方按钮浏览选择，或每行手动填写一个服务器本机路径",
    shGen: "生成 .astbox 容器",
    shGenSub: "内置示例文件（说明文档、二进制样本等），自动生成 TOTP 凭据，生成后立即打开供体验",
    shVerify: "完整性验证通过",
    shSelftest: "密码学自检",
    selftestPass: "密码学自检通过",
    shAbout: "ASTBOX 容器管理器",
    shAboutBody: "依据 ASTBOX v1.0 规范实现的加密容器<br>解码 / 浏览 / 提取 / 封装工具<br><br>密码学: Argon2id + HKDF-SHA-256 + XChaCha20-Poly1305<br>界面: Liquid Glass Design System",
    packComplete: "封装完成",
    packCompleteSub: "请立即用验证器 App 扫描下方二维码，密钥只显示这一次",
    addFilesTitle: "添加文件到当前目录",
    addFolderTitle: "添加文件夹到当前目录",
    addFilesSub: "点击下方按钮浏览选择，或每行手动填写一个服务器本机路径",
    recurseNote: "（将递归读取整个文件夹）",
    browseFiles: "浏览文件…",
    browseFolders: "浏览文件夹…",
    pathList: "路径列表",
    pathListNote: "添加将以 Generation 事务写入并重新加密容器",
    addedFiles: "已添加 %d 个文件（Generation %d）",
    copied: "已复制",
    // 表单标签
    lblFilePath: "文件路径",
    lblSource: "源文件夹（留空 = 封装当前容器全部内容）",
    lblTarget: "目标 .astbox 文件",
    lblDigits: "验证码位数",
    lblB32: "Base32 密钥（留空 = 自动生成）",
    lblB32Hint: "自动生成 160 位密钥",
    lblKdf: "KDF 强度",
    lblKdfHigh: "高安全（256 MiB）",
    lblKdfLow: "低内存（64 MiB）",
    lblKdfNote: "封装完成后将弹出二维码，请用验证器 App 扫描导入。",
    digitsNote6: "6 位：兼容所有验证器 App（Google / Microsoft / ZOHO / Proton 等）。",
    digitsNote8: "⚠ 8 位建议使用Google、ZOHO、Proton Authenticator；微软 Authenticator 仅支持 6 位。",
    digitsShort: "位",
    lblSave: "保存位置",
    lblEntries: "条目数",
    lblCopyKey: "复制密钥",
    lblWarn: "丢失 Base32 密钥后 TOTP 凭据无法恢复，请妥善备份。",
    // 按钮
    btnBrowse: "浏览…",
    btnCancel: "取消",
    btnOpen: "打开",
    btnStart: "开始封装",
    btnAdd: "添加",
    btnGen: "生成",
    btnDone: "完成",
    btnOk: "好的",
    btnUnlock: "去解锁",
    // 文件列表
    colName: "名称",
    colKindDir: "文件夹",
    colKindFile: "文件",
    colSize: "大小",
    colModified: "修改时间",
    colKind: "类型",
    lblFolderEmpty: "此文件夹为空",
    lblNoContainer: "未打开容器",
    lblNoContainerSub: "打开一个 .astbox 文件，或生成一个 .astbox 容器开始体验。",
    lblReady: "容器已就绪",
    lblReadySub: "在右侧输入验证器显示的 TOTP 验证码解锁<br>Argon2id 密钥派生需要数秒，请耐心等待",
    // 侧栏
    lblOutDir: "输出目录",
    lblOutDirHint: "提取文件保存到…",
    // 拖放
    dropText: "松开以打开 .astbox 容器",
    // 主题
    themeAuto: "跟随系统",
    themeLight: "浅色",
    themeDark: "深色",
    themeToggle: "外观: %s（点击切换）",
    // 窗口
    quitTitle: "ASTBOX 已退出",
    quitSub: "本地服务已停止，可以关闭此标签页了。",
    // 口令包
    packPassHint: "为传播包设置口令（留空并确定 = 生成免口令快速包）：",
    packGenOk: "传播包已生成：%s",
    // 新容器
    genCreated: "容器已生成",
    genCreatedSub: "容器已打开并处于锁定状态，请用验证器 App 扫描下方二维码导入，密钥只显示这一次",
    // 提取
    extracting: "正在提取…",
    packing: "正在封装…",
    generating: "正在生成…",
    generateShort: "生成",
    specifySave: "请指定保存位置",
    // about sub
    aboutBody: "依据 ASTBOX v1.0 规范实现的加密容器<br>解码 / 浏览 / 提取 / 封装工具<br><br>密码学: Argon2id + HKDF-SHA-256 + XChaCha20-Poly1305<br>界面: Liquid Glass Design System",
    selftestBody: "Argon2id / HKDF / AEAD / TOTP 全部通过",
    // 浏览器
    openBrowse: "选择文件…（本机上传）",
    openPath: "输入服务器本机路径…",
    // 其他
    notFolder: "所选项目不是文件夹",
    dlgOpenFile: "选择 .astbox 容器",
    dlgPackDir: "选择要封装的文件夹",
    dlgSaveAs: "保存为 .astbox",
    dlgPickOutDir: "选择提取输出目录",
    ftAstbox: "ASTBOX 容器",
    ftAll: "所有文件",
    ftPassbox: "ASTBOX 传播包",
    parsedUnlock: "容器已解析，请输入凭据解锁",
    openOrSpecify: "请先打开并解锁容器，或指定源文件夹",
    copiedKey: "密钥已复制",
    b32Prompt: "输入 Base32 TOTP 密钥（来自你的验证器）:",
    totpComputed: "TOTP(%d位) = %s",
    ttClose: "退出 ASTBOX（关闭本地服务）",
    ttMin: "最小化请使用 Windows UI",
    ttZoom: "进入/退出全屏",
    navBack: "后退", navFwd: "前进", navUp: "上级目录",
    ttOpenBox: "打开 .astbox 容器…", ttPackBox: "封装为 .astbox…",
    ttAddBox: "添加文件到当前目录…", ttExtractBox: "提取选中文件",
    ttVerifyBox: "验证容器完整性", ttMore: "更多操作",
    ttLang: "切换语言", ttTheme: "切换外观",
    unlockTopBtn: "解锁…",
    ccEmptyTitle: "未打开容器",
    ccEmptySub: "打开一个 .astbox 文件，或生成 .astbox 容器开始体验。",
    dtFiles: "文件数", dtCred: "凭据",
    otpHead: "输入 TOTP 验证码",
    btnUnlockSide: "解锁",
    btnCalc: "Base32 计算…", ttCalc: "用 Base32 密钥计算当前验证码",
    btnLockSide: "锁定并清除凭据",
    sideLocation: "位置", qRoot: "根目录", sideActions: "操作",
    opOpen: "打开容器…", opPack: "封装文件夹…", opDemo: "生成 .astbox 容器…",
    opAddFiles: "添加文件…", opAddFolder: "添加文件夹…",
    opExtractAll: "提取全部文件", opVerify: "验证完整性", opSelftest: "密码学自检",
    heroSub: "加密容器的解码 · 浏览 · 提取 · 封装<br>Argon2id + HKDF-SHA256 + XChaCha20-Poly1305",
    btnHeroOpen: "打开 .astbox 文件…", btnHeroDemo: "生成 .astbox 容器",
    heroDim: "也可以把 .astbox 文件拖进本窗口",
    statusReady: "就绪",
    dlgAddFiles2: "选择要添加的文件（可多选）",
    dlgAddFolder2: "选择要添加的文件夹",
    items: "%d 个对象",
    copied: "已复制",
    passGenOk: "传播包已生成：%s",
    // P5 .passbox 导入(双击/启动参数承接)
    importTitle: "导入传播包",
    importSub: "将内嵌容器写入传播包同目录，并登记其验证码密钥（免重录）",
    packPassLabel: "口令",
    btnImport: "导入",
    importOk: "传播包已导入，请输入验证码解锁",
    // 工具栏 aria 群组标签
    grpNav: "导航", grpOps: "操作", mainToolbar: "主导航",
    addrBar: "地址栏", sidePanel: "边栏", fileList: "文件列表", stDot: "状态",
  },

  en: {
    // 状态栏
    sEmpty: "Ready — open a .astbox container to get started",
    sLocked: "Container loaded — enter your TOTP code to unlock",
    sUnlocked: "Unlocked",
    // 地址栏
    addrEdit: "Double-click to edit path",
    // OTP
    otpEnter: "Please enter the full %d-digit code",
    otpDigit: "Code digit %d",
    otpDigitsLbl: "%d-digit code",
    // 错误
    errConn: "Lost connection to server",
    errReq: "Request failed (%d)",
    errFileSize: "Container exceeds 4 GiB limit; use \"Browse (local path)\" instead",
    errOutput: "Please specify output directory in the sidebar first",
    errUnlock: "Please unlock the container first",
    errSpecify: "Please specify a target file",
    errPaths: "Please enter at least one path",
    atLeastOnePath: "Enter at least one path",
    errBrowse: "Couldn't open file dialog — please type the path below",
    errNoSel: "Please select files in the list first",
    // Toast/确认
    tUnlocked: "Container unlocked",
    tLocked: "Container locked",
    tCopied: "Copied",
    file: "File",
    tExtracted: "Extracted %d files → %s",
    tGen: "Generated",
    // 菜单
    mExtractSel: "Extract selected",
    mExtractAll: "Extract all",
    mOpenFolder: "Open / enter folder",
    mRefresh: "Refresh",
    mExportPack: "Export transfer package",
    mLock: "Lock container",
    mAbout: "About",
    // Sheet 标题
    shOpen: "Open container",
    shOpenSub: "Select or enter a .astbox file on the server",
    shPack: "Pack into .astbox container",
    shPackSub: "Pack a folder into an encrypted container. Your TOTP code is the only way to unlock it.",
    shAddFile: "Add files to current directory",
    shAddFolder: "Add folder to current directory",
    shAddSub: "Click buttons below to browse, or enter one server local path per line",
    shGen: "Generate .astbox container",
    shGenSub: "Includes sample files (docs, binary samples, etc.). TOTP secret is auto-generated — container opens immediately after creation.",
    shVerify: "Integrity verification passed",
    shSelftest: "Cryptography self-test",
    selftestPass: "Crypto self-test passed",
    shAbout: "ASTBOX Container Manager",
    shAboutBody: "Encrypted container implementation per ASTBOX v1.0 spec<br>Decode / Browse / Extract / Pack tool<br><br>Cryptography: Argon2id + HKDF-SHA-256 + XChaCha20-Poly1305<br>UI: Liquid Glass Design System",
    packComplete: "Packing complete",
    packCompleteSub: "Please scan the QR code below with your authenticator app immediately; the key is shown only once",
    addFilesTitle: "Add files to current directory",
    addFolderTitle: "Add folder to current directory",
    addFilesSub: "Click buttons below to browse, or enter one server local path per line",
    recurseNote: " (subfolders will be read recursively)",
    browseFiles: "Browse files…",
    browseFolders: "Browse folders…",
    pathList: "Path list",
    pathListNote: "Add will be written as a Generation transaction and re-encrypt the container",
    addedFiles: "Added %d files (Generation %d)",
    copied: "Copied",
    // 表单标签
    lblFilePath: "File path",
    lblSource: "Source folder (leave blank to pack all contents)",
    lblTarget: "Target .astbox file",
    lblDigits: "Code length",
    lblB32: "Base32 secret (leave blank to auto-generate)",
    lblB32Hint: "Auto-generate 160-bit secret",
    lblKdf: "KDF strength",
    lblKdfHigh: "Maximum security (256 MiB RAM)",
    lblKdfLow: "Minimal RAM (64 MiB)",
    lblKdfNote: "A QR code will appear after packing. Scan it with your authenticator app to import the secret.",
    digitsNote6: "6 digits: compatible with all authenticators (Google / Microsoft / ZOHO / Proton, etc.)",
    digitsNote8: "⚠ 8 digits recommended for Google、ZOHO、Proton Authenticator. Windows Authenticator supports 6 digits only.",
    digitsShort: "dig",
    lblSave: "Save location",
    lblEntries: "entries",
    lblCopyKey: "Copy secret",
    lblWarn: "If you lose the Base32 secret, your TOTP codes will be unrecoverable. Back up the secret now.",
    // 按钮
    btnBrowse: "Browse…",
    btnCancel: "Cancel",
    btnOpen: "Open",
    btnStart: "Pack",
    btnAdd: "Add",
    btnGen: "Generate",
    btnDone: "Done",
    btnOk: "OK",
    btnUnlock: "Unlock now",
    // 文件列表
    colName: "Name",
    colKindDir: "Folder",
    colKindFile: "File",
    colSize: "Size",
    colModified: "Modified",
    colKind: "Type",
    lblFolderEmpty: "This folder is empty",
    lblNoContainer: "No container open",
    lblNoContainerSub: "Open a .astbox file or generate a new container to get started.",
    lblReady: "Container ready",
    lblReadySub: "Enter the TOTP code shown by your authenticator on the right to unlock<br>Argon2id key derivation takes a few seconds — please wait",
    // 侧栏
    lblOutDir: "Output directory",
    lblOutDirHint: "Where to extract…",
    // 拖放
    dropText: "Drop a .astbox file here to open it",
    // 主题
    themeAuto: "Follow system",
    themeLight: "Light",
    themeDark: "Dark",
    themeToggle: "Theme: %s",
    // 窗口
    quitTitle: "ASTBOX has quit",
    quitSub: "Server stopped. You can close this tab.",
    // 口令包
    packPassHint: "Set a passphrase for the transfer package (leave blank for a no-passphrase quick package):",
    packGenOk: "Transfer package generated: %s",
    // 新容器
    genCreated: "Container generated",
    genCreatedSub: "Container is now locked; scan the QR code below with your authenticator app to import; the key is shown only once",
    // 提取
    extracting: "Extracting…",
    packing: "Packing…",
    generating: "Generating…",
    generateShort: "Generate",
    specifySave: "Please choose where to save",
    // about sub
    aboutBody: "Encrypted container implementation per ASTBOX v1.0 spec<br>Decode / Browse / Extract / Pack tool<br><br>Cryptography: Argon2id + HKDF-SHA-256 + XChaCha20-Poly1305<br>UI: Liquid Glass Design System",
    selftestBody: "Argon2id / HKDF / AEAD / TOTP all passed",
    // 浏览器
    openBrowse: "Upload a file from this device",
    openPath: "Enter path on the server…",
    // 其他
    notFolder: "That item is not a folder",
    items: "%d objects",
    copied: "Copied",
    passGenOk: "Transfer package saved to: %s",
    // P5 .passbox import (double-click / launch-arg flow)
    importTitle: "Import transfer package",
    importSub: "Writes the embedded container next to the package and registers its secret (no re-enrollment)",
    packPassLabel: "Passphrase",
    btnImport: "Import",
    importOk: "Transfer package imported — enter the verification code to unlock",
    dlgOpenFile: "Select .astbox container",
    dlgPackDir: "Select folder to pack",
    dlgSaveAs: "Save as .astbox",
    dlgPickOutDir: "Choose extraction output folder",
    ftAstbox: "ASTBOX containers",
    ftAll: "All files",
    ftPassbox: "ASTBOX transfer packages",
    parsedUnlock: "Container parsed — enter your code to unlock",
    openOrSpecify: "Open and unlock a container first, or pick a source folder",
    copiedKey: "Secret copied",
    b32Prompt: "Enter the Base32 TOTP secret (from your authenticator):",
    totpComputed: "TOTP (%d-digit) = %s",
    ttClose: "Quit ASTBOX (stops local service)",
    ttMin: "Minimize via Windows UI",
    ttZoom: "Enter/exit full screen",
    navBack: "Back", navFwd: "Forward", navUp: "Up one level",
    ttOpenBox: "Open .astbox container…", ttPackBox: "Pack as .astbox…",
    ttAddBox: "Add files to current folder…", ttExtractBox: "Extract selected files",
    ttVerifyBox: "Verify container integrity", ttMore: "More actions",
    ttLang: "Switch language", ttTheme: "Toggle appearance",
    unlockTopBtn: "Unlock…",
    ccEmptyTitle: "No container open",
    ccEmptySub: "Open a .astbox file or generate a new container to get started.",
    dtFiles: "Files", dtCred: "Credential",
    otpHead: "Enter TOTP code",
    btnUnlockSide: "Unlock",
    btnCalc: "Base32 calc…", ttCalc: "Compute current code from Base32 secret",
    btnLockSide: "Lock and wipe credential",
    sideLocation: "Locations", qRoot: "Root", sideActions: "Actions",
    opOpen: "Open container…", opPack: "Pack folder…", opDemo: "Generate .astbox container…",
    opAddFiles: "Add files…", opAddFolder: "Add folder…",
    opExtractAll: "Extract all files", opVerify: "Verify integrity", opSelftest: "Crypto self-test",
    heroSub: "Decode · Browse · Extract · Pack encrypted containers<br>Argon2id + HKDF-SHA256 + XChaCha20-Poly1305",
    btnHeroOpen: "Open a .astbox file…", btnHeroDemo: "Generate .astbox container",
    heroDim: "You can also drop a .astbox file into this window",
    statusReady: "Ready",
    dlgAddFiles2: "Choose files to add (multi-select)",
    dlgAddFolder2: "Choose folder to add",
    grpNav: "Navigation", grpOps: "Actions", mainToolbar: "Main toolbar",
    addrBar: "Address bar", sidePanel: "Sidebar", fileList: "File list", stDot: "Status",
  },

  /* ---- de:Rust 线扩展语言(TS 移植管线新增;非 C# 谱系逐字资产) ---- */
  de: {
    // 状态栏
    sEmpty: "Bereit — öffnen Sie einen .astbox-Container, um zu starten",
    sLocked: "Container geladen — geben Sie Ihren TOTP-Code zum Entsperren ein",
    sUnlocked: "Entsperrt",
    // 地址栏
    addrEdit: "Doppelklicken, um den Pfad zu bearbeiten",
    // OTP
    otpEnter: "Bitte geben Sie den vollständigen %d-stelligen Code ein",
    otpDigit: "Codeziffer %d",
    otpDigitsLbl: "%d-stelliger Code",
    // 错误
    errConn: "Verbindung zum Server verloren",
    errReq: "Anfrage fehlgeschlagen (%d)",
    errFileSize: "Container überschreitet das 4-GiB-Limit; bitte stattdessen \"Durchsuchen (lokaler Pfad)\" verwenden",
    errOutput: "Bitte geben Sie zuerst ein Ausgabeverzeichnis in der Seitenleiste an",
    errUnlock: "Bitte entsperren Sie den Container zuerst",
    errSpecify: "Bitte geben Sie eine Zieldatei an",
    errPaths: "Bitte geben Sie mindestens einen Pfad ein",
    atLeastOnePath: "Mindestens einen Pfad eingeben",
    errBrowse: "Dateidialog konnte nicht geöffnet werden — bitte Pfad unten eingeben",
    errNoSel: "Bitte wählen Sie zuerst Dateien in der Liste aus",
    // Toast/确认
    tUnlocked: "Container entsperrt",
    tLocked: "Container gesperrt",
    tCopied: "Kopiert",
    file: "Datei",
    tExtracted: "%d Dateien extrahiert → %s",
    tGen: "Generiert",
    // 菜单
    mExtractSel: "Auswahl extrahieren",
    mExtractAll: "Alles extrahieren",
    mOpenFolder: "Ordner öffnen / betreten",
    mRefresh: "Aktualisieren",
    mExportPack: "Übertragungspaket exportieren",
    mLock: "Container sperren",
    mAbout: "Info",
    // Sheet 标题
    shOpen: "Container öffnen",
    shOpenSub: "Wählen Sie eine .astbox-Datei auf dem Server oder geben Sie deren Pfad ein",
    shPack: "In .astbox-Container packen",
    shPackSub: "Packt einen Ordner in einen verschlüsselten Container. Ihr TOTP-Code ist der einzige Weg, ihn zu entsperren.",
    shAddFile: "Dateien zum aktuellen Verzeichnis hinzufügen",
    shAddFolder: "Ordner zum aktuellen Verzeichnis hinzufügen",
    shAddSub: "Klicken Sie unten auf die Schaltflächen, oder geben Sie pro Zeile einen lokalen Serverpfad ein",
    shGen: ".astbox-Container generieren",
    shGenSub: "Enthält Beispieldateien (Dokumente, Binärproben usw.). Das TOTP-Geheimnis wird automatisch erzeugt — der Container lässt sich direkt nach der Erstellung öffnen.",
    shVerify: "Integritätsprüfung bestanden",
    shSelftest: "Kryptographie-Selbsttest",
    selftestPass: "Kryptographie-Selbsttest bestanden",
    shAbout: "ASTBOX Container-Manager",
    shAboutBody: "Verschlüsselte-Container-Implementierung gemäß ASTBOX-v1.0-Spezifikation<br>Werkzeug zum Dekodieren / Durchsuchen / Extrahieren / Packen<br><br>Kryptographie: Argon2id + HKDF-SHA-256 + XChaCha20-Poly1305<br>UI: Liquid-Glass-Designsystem",
    packComplete: "Packen abgeschlossen",
    packCompleteSub: "Scannen Sie den untenstehenden QR-Code bitte umgehend mit Ihrer Authenticator-App; das Geheimnis wird nur einmal angezeigt",
    addFilesTitle: "Dateien zum aktuellen Verzeichnis hinzufügen",
    addFolderTitle: "Ordner zum aktuellen Verzeichnis hinzufügen",
    addFilesSub: "Klicken Sie unten auf die Schaltflächen, oder geben Sie pro Zeile einen lokalen Serverpfad ein",
    recurseNote: " (Unterordner werden rekursiv eingelesen)",
    browseFiles: "Dateien durchsuchen…",
    browseFolders: "Ordner durchsuchen…",
    pathList: "Pfadliste",
    pathListNote: "Das Hinzufügen wird als Generierungstransaktion geschrieben und der Container neu verschlüsselt",
    addedFiles: "%d Dateien hinzugefügt (Generierung %d)",
    copied: "Kopiert",
    // 表单标签
    lblFilePath: "Dateipfad",
    lblSource: "Quellordner (leer lassen, um den gesamten Inhalt zu packen)",
    lblTarget: "Ziel-.astbox-Datei",
    lblDigits: "Codelänge",
    lblB32: "Base32-Geheimnis (leer lassen für automatische Erzeugung)",
    lblB32Hint: "160-Bit-Geheimnis automatisch erzeugen",
    lblKdf: "KDF-Stärke",
    lblKdfHigh: "Maximale Sicherheit (256 MiB RAM)",
    lblKdfLow: "Minimaler RAM (64 MiB)",
    lblKdfNote: "Nach dem Packen erscheint ein QR-Code. Scannen Sie ihn mit Ihrer Authenticator-App, um das Geheimnis zu importieren.",
    digitsNote6: "6 Ziffern: kompatibel mit allen Authenticatoren (Google / Microsoft / ZOHO / Proton usw.)",
    digitsNote8: "⚠ 8 Ziffern werden für Google-, ZOHO- und Proton-Authenticator empfohlen. Der Windows-Authenticator unterstützt nur 6 Ziffern.",
    digitsShort: "Ziff.",
    lblSave: "Speicherort",
    lblEntries: "Einträge",
    lblCopyKey: "Geheimnis kopieren",
    lblWarn: "Wenn Sie das Base32-Geheimnis verlieren, sind Ihre TOTP-Codes unwiederbringlich. Sichern Sie das Geheimnis jetzt.",
    // 按钮
    btnBrowse: "Durchsuchen…",
    btnCancel: "Abbrechen",
    btnOpen: "Öffnen",
    btnStart: "Packen",
    btnAdd: "Hinzufügen",
    btnGen: "Generieren",
    btnDone: "Fertig",
    btnOk: "OK",
    btnUnlock: "Jetzt entsperren",
    // 文件列表
    colName: "Name",
    colKindDir: "Ordner",
    colKindFile: "Datei",
    colSize: "Größe",
    colModified: "Geändert",
    colKind: "Typ",
    lblFolderEmpty: "Dieser Ordner ist leer",
    lblNoContainer: "Kein Container geöffnet",
    lblNoContainerSub: "Öffnen Sie eine .astbox-Datei oder generieren Sie einen neuen Container, um zu starten.",
    lblReady: "Container bereit",
    lblReadySub: "Geben Sie rechts den in Ihrer Authenticator-App angezeigten TOTP-Code ein, um zu entsperren<br>Die Argon2id-Schlüsselableitung dauert einige Sekunden — bitte warten",
    // 侧栏
    lblOutDir: "Ausgabeverzeichnis",
    lblOutDirHint: "Ziel zum Extrahieren…",
    // 拖放
    dropText: ".astbox-Datei hier ablegen, um sie zu öffnen",
    // 主题
    themeAuto: "System folgen",
    themeLight: "Hell",
    themeDark: "Dunkel",
    themeToggle: "Design: %s",
    // 窗口
    quitTitle: "ASTBOX wurde beendet",
    quitSub: "Server gestoppt. Sie können diesen Tab schließen.",
    // 口令包
    packPassHint: "Passphrase für das Übertragungspaket festlegen (leer lassen für ein schnelles Paket ohne Passphrase):",
    packGenOk: "Übertragungspaket erzeugt: %s",
    // 新容器
    genCreated: "Container generiert",
    genCreatedSub: "Der Container ist nun gesperrt; scannen Sie den untenstehenden QR-Code mit Ihrer Authenticator-App, um das Geheimnis zu importieren; es wird nur einmal angezeigt",
    // 提取
    extracting: "Extrahiere…",
    packing: "Packe…",
    generating: "Generiere…",
    generateShort: "Generieren",
    specifySave: "Bitte wählen Sie einen Speicherort",
    // about sub
    aboutBody: "Verschlüsselte-Container-Implementierung gemäß ASTBOX-v1.0-Spezifikation<br>Werkzeug zum Dekodieren / Durchsuchen / Extrahieren / Packen<br><br>Kryptographie: Argon2id + HKDF-SHA-256 + XChaCha20-Poly1305<br>UI: Liquid-Glass-Designsystem",
    selftestBody: "Argon2id / HKDF / AEAD / TOTP alle bestanden",
    // 浏览器
    openBrowse: "Datei von diesem Gerät hochladen",
    openPath: "Pfad auf dem Server eingeben…",
    // 其他
    notFolder: "Dieses Element ist kein Ordner",
    items: "%d Objekte",
    passGenOk: "Übertragungspaket gespeichert unter: %s",
    // P5 .passbox import (double-click / launch-arg flow)
    importTitle: "Übertragungspaket importieren",
    importSub: "Schreibt den eingebetteten Container neben das Paket und registriert sein Geheimnis (keine Neuregistrierung)",
    packPassLabel: "Passphrase",
    btnImport: "Importieren",
    importOk: "Übertragungspaket importiert — geben Sie den Prüfcode ein, um zu entsperren",
    dlgOpenFile: ".astbox-Container auswählen",
    dlgPackDir: "Zu packenden Ordner auswählen",
    dlgSaveAs: "Als .astbox speichern",
    dlgPickOutDir: "Ausgabeverzeichnis für die Extraktion wählen",
    ftAstbox: "ASTBOX-Container",
    ftAll: "Alle Dateien",
    ftPassbox: "ASTBOX-Übertragungspakete",
    parsedUnlock: "Container eingelesen — geben Sie Ihren Code ein, um zu entsperren",
    openOrSpecify: "Öffnen und entsperren Sie zuerst einen Container, oder wählen Sie einen Quellordner",
    copiedKey: "Geheimnis kopiert",
    b32Prompt: "Base32-TOTP-Geheimnis eingeben (aus Ihrer Authenticator-App):",
    totpComputed: "TOTP (%d-stellig) = %s",
    ttClose: "ASTBOX beenden (stoppt den lokalen Dienst)",
    ttMin: "Über die Windows-Benutzeroberfläche minimieren",
    ttZoom: "Vollbild betreten/verlassen",
    navBack: "Zurück", navFwd: "Vorwärts", navUp: "Eine Ebene höher",
    ttOpenBox: ".astbox-Container öffnen…", ttPackBox: "Als .astbox packen…",
    ttAddBox: "Dateien zum aktuellen Ordner hinzufügen…", ttExtractBox: "Ausgewählte Dateien extrahieren",
    ttVerifyBox: "Container-Integrität prüfen", ttMore: "Weitere Aktionen",
    ttLang: "Sprache wechseln", ttTheme: "Darstellung umschalten",
    unlockTopBtn: "Entsperren…",
    ccEmptyTitle: "Kein Container geöffnet",
    ccEmptySub: "Öffnen Sie eine .astbox-Datei oder generieren Sie einen neuen Container, um zu starten.",
    dtFiles: "Dateien", dtCred: "Zugangsdaten",
    otpHead: "TOTP-Code eingeben",
    btnUnlockSide: "Entsperren",
    btnCalc: "Base32-Berechnung…", ttCalc: "Aktuellen Code aus Base32-Geheimnis berechnen",
    btnLockSide: "Sperren und Zugangsdaten verwerfen",
    sideLocation: "Speicherorte", qRoot: "Stamm", sideActions: "Aktionen",
    opOpen: "Container öffnen…", opPack: "Ordner packen…", opDemo: ".astbox-Container generieren…",
    opAddFiles: "Dateien hinzufügen…", opAddFolder: "Ordner hinzufügen…",
    opExtractAll: "Alle Dateien extrahieren", opVerify: "Integrität prüfen", opSelftest: "Kryptographie-Selbsttest",
    heroSub: "Dekodieren · Durchsuchen · Extrahieren · Packen verschlüsselter Container<br>Argon2id + HKDF-SHA256 + XChaCha20-Poly1305",
    btnHeroOpen: ".astbox-Datei öffnen…", btnHeroDemo: ".astbox-Container generieren",
    heroDim: "Sie können auch eine .astbox-Datei in dieses Fenster ziehen",
    statusReady: "Bereit",
    dlgAddFiles2: "Hinzuzufügende Dateien wählen (Mehrfachauswahl)",
    dlgAddFolder2: "Hinzuzufügenden Ordner wählen",
    grpNav: "Navigation", grpOps: "Aktionen", mainToolbar: "Hauptsymbolleiste",
    addrBar: "Adressleiste", sidePanel: "Seitenleiste", fileList: "Dateiliste", stDot: "Status",
  },

  /* ---- fr:Rust 线扩展语言(TS 移植管线新增;非 C# 谱系逐字资产) ---- */
  fr: {
    // 状态栏
    sEmpty: "Prêt — ouvrez un conteneur .astbox pour commencer",
    sLocked: "Conteneur chargé — saisissez votre code TOTP pour le déverrouiller",
    sUnlocked: "Déverrouillé",
    // 地址栏
    addrEdit: "Double-cliquez pour modifier le chemin",
    // OTP
    otpEnter: "Veuillez saisir le code complet à %d chiffres",
    otpDigit: "Chiffre du code %d",
    otpDigitsLbl: "Code à %d chiffres",
    // 错误
    errConn: "Connexion au serveur perdue",
    errReq: "Échec de la requête (%d)",
    errFileSize: "Le conteneur dépasse la limite de 4 Go ; utilisez plutôt « Parcourir (chemin local) »",
    errOutput: "Veuillez d'abord indiquer un répertoire de sortie dans la barre latérale",
    errUnlock: "Veuillez d'abord déverrouiller le conteneur",
    errSpecify: "Veuillez indiquer un fichier cible",
    errPaths: "Veuillez saisir au moins un chemin",
    atLeastOnePath: "Saisissez au moins un chemin",
    errBrowse: "Impossible d'ouvrir la boîte de dialogue de fichiers — veuillez saisir le chemin ci-dessous",
    errNoSel: "Veuillez d'abord sélectionner des fichiers dans la liste",
    // Toast/确认
    tUnlocked: "Conteneur déverrouillé",
    tLocked: "Conteneur verrouillé",
    tCopied: "Copié",
    file: "Fichier",
    tExtracted: "%d fichiers extraits → %s",
    tGen: "Généré",
    // 菜单
    mExtractSel: "Extraire la sélection",
    mExtractAll: "Tout extraire",
    mOpenFolder: "Ouvrir / entrer dans le dossier",
    mRefresh: "Actualiser",
    mExportPack: "Exporter le paquet de transfert",
    mLock: "Verrouiller le conteneur",
    mAbout: "À propos",
    // Sheet 标题
    shOpen: "Ouvrir un conteneur",
    shOpenSub: "Sélectionnez un fichier .astbox sur le serveur ou saisissez son chemin",
    shPack: "Empaqueter dans un conteneur .astbox",
    shPackSub: "Empaquette un dossier dans un conteneur chiffré. Votre code TOTP est le seul moyen de le déverrouiller.",
    shAddFile: "Ajouter des fichiers au répertoire courant",
    shAddFolder: "Ajouter un dossier au répertoire courant",
    shAddSub: "Cliquez sur les boutons ci-dessous, ou saisissez un chemin local du serveur par ligne",
    shGen: "Générer un conteneur .astbox",
    shGenSub: "Inclut des fichiers d'exemple (documents, échantillons binaires, etc.). Le secret TOTP est généré automatiquement — le conteneur s'ouvre dès sa création.",
    shVerify: "Vérification d'intégrité réussie",
    shSelftest: "Autotest cryptographique",
    selftestPass: "Autotest cryptographique réussi",
    shAbout: "Gestionnaire de conteneurs ASTBOX",
    shAboutBody: "Implémentation de conteneur chiffré selon la spécification ASTBOX v1.0<br>Outil de décodage / parcours / extraction / empaquetage<br><br>Cryptographie : Argon2id + HKDF-SHA-256 + XChaCha20-Poly1305<br>Interface : système de design Liquid Glass",
    packComplete: "Empaquetage terminé",
    packCompleteSub: "Scannez immédiatement le code QR ci-dessous avec votre application Authenticator ; le secret n'est affiché qu'une seule fois",
    addFilesTitle: "Ajouter des fichiers au répertoire courant",
    addFolderTitle: "Ajouter un dossier au répertoire courant",
    addFilesSub: "Cliquez sur les boutons ci-dessous, ou saisissez un chemin local du serveur par ligne",
    recurseNote: " (les sous-dossiers seront lus récursivement)",
    browseFiles: "Parcourir les fichiers…",
    browseFolders: "Parcourir les dossiers…",
    pathList: "Liste des chemins",
    pathListNote: "L'ajout sera écrit comme transaction de génération et re-chiffrera le conteneur",
    addedFiles: "%d fichiers ajoutés (Génération %d)",
    copied: "Copié",
    // 表单标签
    lblFilePath: "Chemin du fichier",
    lblSource: "Dossier source (laisser vide pour empaqueter tout le contenu)",
    lblTarget: "Fichier .astbox cible",
    lblDigits: "Longueur du code",
    lblB32: "Secret Base32 (laisser vide pour générer automatiquement)",
    lblB32Hint: "Générer automatiquement un secret de 160 bits",
    lblKdf: "Force du KDF",
    lblKdfHigh: "Sécurité maximale (256 MiB de RAM)",
    lblKdfLow: "RAM minimale (64 MiB)",
    lblKdfNote: "Un code QR apparaîtra après l'empaquetage. Scannez-le avec votre application Authenticator pour importer le secret.",
    digitsNote6: "6 chiffres : compatible avec tous les Authenticators (Google / Microsoft / ZOHO / Proton, etc.)",
    digitsNote8: "⚠ 8 chiffres recommandés pour Google, ZOHO et Proton Authenticator. Windows Authenticator ne prend en charge que 6 chiffres.",
    digitsShort: "chiff.",
    lblSave: "Emplacement d'enregistrement",
    lblEntries: "entrées",
    lblCopyKey: "Copier le secret",
    lblWarn: "Si vous perdez le secret Base32, vos codes TOTP seront irrécupérables. Sauvegardez le secret maintenant.",
    // 按钮
    btnBrowse: "Parcourir…",
    btnCancel: "Annuler",
    btnOpen: "Ouvrir",
    btnStart: "Empaqueter",
    btnAdd: "Ajouter",
    btnGen: "Générer",
    btnDone: "Terminé",
    btnOk: "OK",
    btnUnlock: "Déverrouiller maintenant",
    // 文件列表
    colName: "Nom",
    colKindDir: "Dossier",
    colKindFile: "Fichier",
    colSize: "Taille",
    colModified: "Modifié",
    colKind: "Type",
    lblFolderEmpty: "Ce dossier est vide",
    lblNoContainer: "Aucun conteneur ouvert",
    lblNoContainerSub: "Ouvrez un fichier .astbox ou générez un nouveau conteneur pour commencer.",
    lblReady: "Conteneur prêt",
    lblReadySub: "Saisissez à droite le code TOTP affiché par votre application Authenticator pour déverrouiller<br>La dérivation de clé Argon2id prend quelques secondes — veuillez patienter",
    // 侧栏
    lblOutDir: "Répertoire de sortie",
    lblOutDirHint: "Destination de l'extraction…",
    // 拖放
    dropText: "Déposez ici un fichier .astbox pour l'ouvrir",
    // 主题
    themeAuto: "Suivre le système",
    themeLight: "Clair",
    themeDark: "Sombre",
    themeToggle: "Thème : %s",
    // 窗口
    quitTitle: "ASTBOX s'est arrêté",
    quitSub: "Le serveur est arrêté. Vous pouvez fermer cet onglet.",
    // 口令包
    packPassHint: "Définissez une phrase secrète pour le paquet de transfert (laisser vide pour un paquet rapide sans phrase secrète) :",
    packGenOk: "Paquet de transfert généré : %s",
    // 新容器
    genCreated: "Conteneur généré",
    genCreatedSub: "Le conteneur est maintenant verrouillé ; scannez le code QR ci-dessous avec votre application Authenticator pour l'importer ; le secret n'est affiché qu'une seule fois",
    // 提取
    extracting: "Extraction…",
    packing: "Empaquetage…",
    generating: "Génération…",
    generateShort: "Générer",
    specifySave: "Veuillez choisir un emplacement d'enregistrement",
    // about sub
    aboutBody: "Implémentation de conteneur chiffré selon la spécification ASTBOX v1.0<br>Outil de décodage / parcours / extraction / empaquetage<br><br>Cryptographie : Argon2id + HKDF-SHA-256 + XChaCha20-Poly1305<br>Interface : système de design Liquid Glass",
    selftestBody: "Argon2id / HKDF / AEAD / TOTP : tous réussis",
    // 浏览器
    openBrowse: "Téléverser un fichier depuis cet appareil",
    openPath: "Saisir un chemin sur le serveur…",
    // 其他
    notFolder: "Cet élément n'est pas un dossier",
    items: "%d objets",
    passGenOk: "Paquet de transfert enregistré sous : %s",
    // P5 .passbox import (double-click / launch-arg flow)
    importTitle: "Importer un paquet de transfert",
    importSub: "Écrit le conteneur intégré à côté du paquet et enregistre son secret (sans nouvelle inscription)",
    packPassLabel: "Phrase secrète",
    btnImport: "Importer",
    importOk: "Paquet de transfert importé — saisissez le code de vérification pour déverrouiller",
    dlgOpenFile: "Sélectionner un conteneur .astbox",
    dlgPackDir: "Sélectionner le dossier à empaqueter",
    dlgSaveAs: "Enregistrer en .astbox",
    dlgPickOutDir: "Choisir le dossier de sortie de l'extraction",
    ftAstbox: "Conteneurs ASTBOX",
    ftAll: "Tous les fichiers",
    ftPassbox: "Paquets de transfert ASTBOX",
    parsedUnlock: "Conteneur analysé — saisissez votre code pour le déverrouiller",
    openOrSpecify: "Ouvrez et déverrouillez d'abord un conteneur, ou choisissez un dossier source",
    copiedKey: "Secret copié",
    b32Prompt: "Saisissez le secret TOTP Base32 (de votre application Authenticator) :",
    totpComputed: "TOTP (%d chiffres) = %s",
    ttClose: "Quitter ASTBOX (arrête le service local)",
    ttMin: "Réduire via l'interface Windows",
    ttZoom: "Passer en plein écran / quitter le plein écran",
    navBack: "Retour", navFwd: "Avancer", navUp: "Monter d'un niveau",
    ttOpenBox: "Ouvrir un conteneur .astbox…", ttPackBox: "Empaqueter en .astbox…",
    ttAddBox: "Ajouter des fichiers au dossier courant…", ttExtractBox: "Extraire les fichiers sélectionnés",
    ttVerifyBox: "Vérifier l'intégrité du conteneur", ttMore: "Autres actions",
    ttLang: "Changer de langue", ttTheme: "Basculer l'apparence",
    unlockTopBtn: "Déverrouiller…",
    ccEmptyTitle: "Aucun conteneur ouvert",
    ccEmptySub: "Ouvrez un fichier .astbox ou générez un nouveau conteneur pour commencer.",
    dtFiles: "Fichiers", dtCred: "Identifiants",
    otpHead: "Saisir le code TOTP",
    btnUnlockSide: "Déverrouiller",
    btnCalc: "Calcul Base32…", ttCalc: "Calculer le code actuel depuis le secret Base32",
    btnLockSide: "Verrouiller et effacer les identifiants",
    sideLocation: "Emplacements", qRoot: "Racine", sideActions: "Actions",
    opOpen: "Ouvrir un conteneur…", opPack: "Empaqueter un dossier…", opDemo: "Générer un conteneur .astbox…",
    opAddFiles: "Ajouter des fichiers…", opAddFolder: "Ajouter un dossier…",
    opExtractAll: "Extraire tous les fichiers", opVerify: "Vérifier l'intégrité", opSelftest: "Autotest cryptographique",
    heroSub: "Décoder · Parcourir · Extraire · Empaqueter des conteneurs chiffrés<br>Argon2id + HKDF-SHA256 + XChaCha20-Poly1305",
    btnHeroOpen: "Ouvrir un fichier .astbox…", btnHeroDemo: "Générer un conteneur .astbox",
    heroDim: "Vous pouvez aussi déposer un fichier .astbox dans cette fenêtre",
    statusReady: "Prêt",
    dlgAddFiles2: "Choisir les fichiers à ajouter (sélection multiple)",
    dlgAddFolder2: "Choisir le dossier à ajouter",
    grpNav: "Navigation", grpOps: "Actions", mainToolbar: "Barre d'outils principale",
    addrBar: "Barre d'adresse", sidePanel: "Barre latérale", fileList: "Liste des fichiers", stDot: "État",
  },

  /* ---- ko:Rust 线扩展语言(TS 移植管线新增;非 C# 谱系逐字资产) ---- */
  ko: {
    // 状态栏
    sEmpty: "준비됨 — 시작하려면 .astbox 컨테이너를 여세요",
    sLocked: "컨테이너가 로드되었습니다 — 잠금 해제하려면 TOTP 코드를 입력하세요",
    sUnlocked: "잠금 해제됨",
    // 地址栏
    addrEdit: "두 번 클릭하여 경로 편집",
    // OTP
    otpEnter: "전체 %d자리 코드를 입력하세요",
    otpDigit: "코드 자릿수 %d",
    otpDigitsLbl: "%d자리 코드",
    // 错误
    errConn: "서버와의 연결이 끊겼습니다",
    errReq: "요청 실패 (%d)",
    errFileSize: "컨테이너가 4GiB 한도를 초과합니다. 대신 \"찾아보기(로컬 경로)\"를 사용하세요",
    errOutput: "먼저 사이드바에서 출력 디렉터리를 지정하세요",
    errUnlock: "먼저 컨테이너의 잠금을 해제하세요",
    errSpecify: "대상 파일을 지정하세요",
    errPaths: "경로를 하나 이상 입력하세요",
    atLeastOnePath: "경로를 하나 이상 입력하세요",
    errBrowse: "파일 대화상자를 열 수 없습니다 — 아래에 경로를 입력하세요",
    errNoSel: "먼저 목록에서 파일을 선택하세요",
    // Toast/确认
    tUnlocked: "컨테이너 잠금 해제됨",
    tLocked: "컨테이너 잠금됨",
    tCopied: "복사됨",
    file: "파일",
    tExtracted: "파일 %d개를 추출했습니다 → %s",
    tGen: "생성됨",
    // 菜单
    mExtractSel: "선택 항목 추출",
    mExtractAll: "모두 추출",
    mOpenFolder: "폴더 열기 / 이동",
    mRefresh: "새로 고침",
    mExportPack: "전송 패키지 내보내기",
    mLock: "컨테이너 잠금",
    mAbout: "정보",
    // Sheet 标题
    shOpen: "컨테이너 열기",
    shOpenSub: "서버에서 .astbox 파일을 선택하거나 경로를 입력하세요",
    shPack: ".astbox 컨테이너로 패키징",
    shPackSub: "폴더를 암호화된 컨테이너로 패키징합니다. TOTP 코드가 잠금 해제를 위한 유일한 방법입니다.",
    shAddFile: "현재 디렉터리에 파일 추가",
    shAddFolder: "현재 디렉터리에 폴더 추가",
    shAddSub: "아래 버튼을 클릭하거나, 한 줄에 서버 로컬 경로를 하나씩 입력하세요",
    shGen: ".astbox 컨테이너 생성",
    shGenSub: "샘플 파일(문서, 바이너리 샘플 등)이 포함됩니다. TOTP 시크릿이 자동 생성되며 — 컨테이너는 생성 직후 바로 열립니다.",
    shVerify: "무결성 검증 통과",
    shSelftest: "암호화 자가 진단",
    selftestPass: "암호화 자가 진단 통과",
    shAbout: "ASTBOX 컨테이너 관리자",
    shAboutBody: "ASTBOX v1.0 사양에 따른 암호화 컨테이너 구현<br>디코딩 / 찾아보기 / 추출 / 패키징 도구<br><br>암호화: Argon2id + HKDF-SHA-256 + XChaCha20-Poly1305<br>UI: Liquid Glass 디자인 시스템",
    packComplete: "패키징 완료",
    packCompleteSub: "아래 QR 코드를 즉시 Authenticator 앱으로 스캔하세요. 시크릿은 한 번만 표시됩니다",
    addFilesTitle: "현재 디렉터리에 파일 추가",
    addFolderTitle: "현재 디렉터리에 폴더 추가",
    addFilesSub: "아래 버튼을 클릭하거나, 한 줄에 서버 로컬 경로를 하나씩 입력하세요",
    recurseNote: " (하위 폴더는 재귀적으로 읽습니다)",
    browseFiles: "파일 찾아보기…",
    browseFolders: "폴더 찾아보기…",
    pathList: "경로 목록",
    pathListNote: "추가는 생성 트랜잭션으로 기록되며 컨테이너를 다시 암호화합니다",
    addedFiles: "파일 %d개 추가됨 (생성 %d)",
    copied: "복사됨",
    // 表单标签
    lblFilePath: "파일 경로",
    lblSource: "원본 폴더 (비워 두면 전체 내용을 패키징)",
    lblTarget: "대상 .astbox 파일",
    lblDigits: "코드 길이",
    lblB32: "Base32 시크릿 (비워 두면 자동 생성)",
    lblB32Hint: "160비트 시크릿 자동 생성",
    lblKdf: "KDF 강도",
    lblKdfHigh: "최대 보안 (256 MiB RAM)",
    lblKdfLow: "최소 RAM (64 MiB)",
    lblKdfNote: "패키징 후 QR 코드가 나타납니다. Authenticator 앱으로 스캔하여 시크릿을 가져오세요.",
    digitsNote6: "6자리: 모든 Authenticator와 호환 (Google / Microsoft / ZOHO / Proton 등)",
    digitsNote8: "⚠ Google, ZOHO, Proton Authenticator에는 8자리를 권장합니다. Windows Authenticator는 6자리만 지원합니다.",
    digitsShort: "자릿수",
    lblSave: "저장 위치",
    lblEntries: "항목",
    lblCopyKey: "시크릿 복사",
    lblWarn: "Base32 시크릿을 잃어버리면 TOTP 코드를 복구할 수 없습니다. 지금 시크릿을 백업하세요.",
    // 按钮
    btnBrowse: "찾아보기…",
    btnCancel: "취소",
    btnOpen: "열기",
    btnStart: "패키징",
    btnAdd: "추가",
    btnGen: "생성",
    btnDone: "완료",
    btnOk: "확인",
    btnUnlock: "지금 잠금 해제",
    // 文件列表
    colName: "이름",
    colKindDir: "폴더",
    colKindFile: "파일",
    colSize: "크기",
    colModified: "수정한 날짜",
    colKind: "종류",
    lblFolderEmpty: "이 폴더는 비어 있습니다",
    lblNoContainer: "열린 컨테이너 없음",
    lblNoContainerSub: "시작하려면 .astbox 파일을 열거나 새 컨테이너를 생성하세요.",
    lblReady: "컨테이너 준비됨",
    lblReadySub: "오른쪽에 Authenticator 앱에 표시된 TOTP 코드를 입력하여 잠금 해제<br>Argon2id 키 유도는 몇 초 정도 걸립니다 — 기다려 주세요",
    // 侧栏
    lblOutDir: "출력 디렉터리",
    lblOutDirHint: "추출 대상…",
    // 拖放
    dropText: "열려면 .astbox 파일을 여기로 끌어다 놓으세요",
    // 主题
    themeAuto: "시스템 설정 따르기",
    themeLight: "밝게",
    themeDark: "어둡게",
    themeToggle: "테마: %s",
    // 窗口
    quitTitle: "ASTBOX가 종료되었습니다",
    quitSub: "서버가 중지되었습니다. 이 탭을 닫을 수 있습니다.",
    // 口令包
    packPassHint: "전송 패키지의 암호 문구를 설정하세요 (비워 두면 암호 문구 없는 빠른 패키지):",
    packGenOk: "전송 패키지 생성됨: %s",
    // 新容器
    genCreated: "컨테이너 생성됨",
    genCreatedSub: "컨테이너가 이제 잠겼습니다. 아래 QR 코드를 Authenticator 앱으로 스캔하여 시크릿을 가져오세요. 시크릿은 한 번만 표시됩니다",
    // 提取
    extracting: "추출 중…",
    packing: "패키징 중…",
    generating: "생성 중…",
    generateShort: "생성",
    specifySave: "저장 위치를 선택하세요",
    // about sub
    aboutBody: "ASTBOX v1.0 사양에 따른 암호화 컨테이너 구현<br>디코딩 / 찾아보기 / 추출 / 패키징 도구<br><br>암호화: Argon2id + HKDF-SHA-256 + XChaCha20-Poly1305<br>UI: Liquid Glass 디자인 시스템",
    selftestBody: "Argon2id / HKDF / AEAD / TOTP 모두 통과",
    // 浏览器
    openBrowse: "이 기기에서 파일 업로드",
    openPath: "서버 경로 입력…",
    // 其他
    notFolder: "이 항목은 폴더가 아닙니다",
    items: "%d개 항목",
    passGenOk: "전송 패키지를 저장했습니다: %s",
    // P5 .passbox import (double-click / launch-arg flow)
    importTitle: "전송 패키지 가져오기",
    importSub: "패키지 옆에 내장 컨테이너를 기록하고 시크릿을 등록합니다 (재등록 불필요)",
    packPassLabel: "암호 문구",
    btnImport: "가져오기",
    importOk: "전송 패키지를 가져왔습니다 — 잠금 해제하려면 확인 코드를 입력하세요",
    dlgOpenFile: ".astbox 컨테이너 선택",
    dlgPackDir: "패키징할 폴더 선택",
    dlgSaveAs: ".astbox로 저장",
    dlgPickOutDir: "추출 출력 디렉터리 선택",
    ftAstbox: "ASTBOX 컨테이너",
    ftAll: "모든 파일",
    ftPassbox: "ASTBOX 전송 패키지",
    parsedUnlock: "컨테이너를 분석했습니다 — 잠금 해제하려면 코드를 입력하세요",
    openOrSpecify: "먼저 컨테이너를 열고 잠금을 해제하거나, 원본 폴더를 선택하세요",
    copiedKey: "시크릿 복사됨",
    b32Prompt: "Base32 TOTP 시크릿을 입력하세요 (Authenticator 앱에서):",
    totpComputed: "TOTP (%d자리) = %s",
    ttClose: "ASTBOX 종료 (로컬 서비스 중지)",
    ttMin: "Windows 인터페이스로 최소화",
    ttZoom: "전체 화면 전환",
    navBack: "뒤로", navFwd: "앞으로", navUp: "위로 한 수준",
    ttOpenBox: ".astbox 컨테이너 열기…", ttPackBox: ".astbox로 패키징…",
    ttAddBox: "현재 폴더에 파일 추가…", ttExtractBox: "선택한 파일 추출",
    ttVerifyBox: "컨테이너 무결성 검증", ttMore: "기타 작업",
    ttLang: "언어 전환", ttTheme: "모양 전환",
    unlockTopBtn: "잠금 해제…",
    ccEmptyTitle: "열린 컨테이너 없음",
    ccEmptySub: "시작하려면 .astbox 파일을 열거나 새 컨테이너를 생성하세요.",
    dtFiles: "파일", dtCred: "자격 증명",
    otpHead: "TOTP 코드 입력",
    btnUnlockSide: "잠금 해제",
    btnCalc: "Base32 계산…", ttCalc: "Base32 시크릿에서 현재 코드 계산",
    btnLockSide: "잠금 및 자격 증명 지우기",
    sideLocation: "위치", qRoot: "루트", sideActions: "작업",
    opOpen: "컨테이너 열기…", opPack: "폴더 패키징…", opDemo: ".astbox 컨테이너 생성…",
    opAddFiles: "파일 추가…", opAddFolder: "폴더 추가…",
    opExtractAll: "모든 파일 추출", opVerify: "무결성 검증", opSelftest: "암호화 자가 진단",
    heroSub: "암호화된 컨테이너 디코딩 · 찾아보기 · 추출 · 패키징<br>Argon2id + HKDF-SHA256 + XChaCha20-Poly1305",
    btnHeroOpen: ".astbox 파일 열기…", btnHeroDemo: ".astbox 컨테이너 생성",
    heroDim: "이 창으로 .astbox 파일을 끌어다 놓을 수도 있습니다",
    statusReady: "준비됨",
    dlgAddFiles2: "추가할 파일 선택 (다중 선택)",
    dlgAddFolder2: "추가할 폴더 선택",
    grpNav: "탐색", grpOps: "작업", mainToolbar: "기본 도구 모음",
    addrBar: "주소 표시줄", sidePanel: "사이드바", fileList: "파일 목록", stDot: "상태",
  },

  /* ---- zh-Hant:Rust 线扩展语言(自简体源块平移, 台湾用语;非 C# 谱系逐字资产) ---- */
  "zh-Hant": {
    // 状态栏
    sEmpty: "就緒 — 開啟一個 .astbox 容器開始",
    sLocked: "容器已載入，輸入 TOTP 驗證碼解鎖",
    sUnlocked: "已解鎖",
    // 地址栏
    addrEdit: "按兩下以編輯路徑",
    // OTP
    otpEnter: "請輸入完整的 %d 位驗證碼",
    otpDigit: "第%d位驗證碼",
    otpDigitsLbl: "%d 位驗證碼",
    // 错误
    errConn: "與伺服器的連線中斷",
    errReq: "請求失敗 (%d)",
    errFileSize: "容器超過 4 GiB 上限，請以「瀏覽（本機路徑）」方式開啟",
    errOutput: "請先在側邊欄填寫輸出目錄",
    errUnlock: "請先解鎖容器",
    errSpecify: "請指定目標檔案",
    errPaths: "請至少填寫一個路徑",
    atLeastOnePath: "請至少填寫一個路徑",
    errBrowse: "無法開啟系統對話框，請手動輸入路徑",
    errNoSel: "請先在清單中選擇檔案",
    // Toast/确认
    tUnlocked: "容器已解鎖",
    tLocked: "已鎖定",
    tCopied: "已複製",
    file: "檔案",
    tExtracted: "已擷取 %d 個檔案 → %s",
    tGen: "已產生",
    // 菜单
    mExtractSel: "擷取選取的檔案",
    mExtractAll: "擷取全部檔案",
    mOpenFolder: "開啟（進入資料夾）",
    mRefresh: "重新整理",
    mExportPack: "產生 .passbox 傳播套件",
    mLock: "鎖定容器",
    mAbout: "關於此應用程式",
    // Sheet 标题
    shOpen: "開啟容器",
    shOpenSub: "選擇或輸入伺服器本機上的 .astbox 檔案",
    shPack: "封裝為 .astbox 容器",
    shPackSub: "將資料夾打包為加密容器，TOTP 為唯一開啟憑證",
    shAddFile: "新增檔案到目前目錄",
    shAddFolder: "新增資料夾到目前目錄",
    shAddSub: "點擊下方按鈕瀏覽選擇，或每行手動填寫一個伺服器本機路徑",
    shGen: "產生 .astbox 容器",
    shGenSub: "內建範例檔案（說明文件、二進位樣本等），自動產生 TOTP 憑證，產生後立即開啟供體驗",
    shVerify: "完整性驗證通過",
    shSelftest: "密碼學自我測試",
    selftestPass: "密碼學自我測試通過",
    shAbout: "ASTBOX 容器管理器",
    shAboutBody: "依據 ASTBOX v1.0 規範實作的加密容器<br>解碼 / 瀏覽 / 擷取 / 封裝工具<br><br>密碼學: Argon2id + HKDF-SHA-256 + XChaCha20-Poly1305<br>介面: Liquid Glass Design System",
    packComplete: "封裝完成",
    packCompleteSub: "請立即以驗證器 App 掃描下方 QR 碼，金鑰只顯示這一次",
    addFilesTitle: "新增檔案到目前目錄",
    addFolderTitle: "新增資料夾到目前目錄",
    addFilesSub: "點擊下方按鈕瀏覽選擇，或每行手動填寫一個伺服器本機路徑",
    recurseNote: "（將遞迴讀取整個資料夾）",
    browseFiles: "瀏覽檔案…",
    browseFolders: "瀏覽資料夾…",
    pathList: "路徑清單",
    pathListNote: "新增將以 Generation 交易寫入並重新加密容器",
    addedFiles: "已新增 %d 個檔案（Generation %d）",
    copied: "已複製",
    // 表单标签
    lblFilePath: "檔案路徑",
    lblSource: "來源資料夾（留空 = 封裝目前容器全部內容）",
    lblTarget: "目標 .astbox 檔案",
    lblDigits: "驗證碼位數",
    lblB32: "Base32 金鑰（留空 = 自動產生）",
    lblB32Hint: "自動產生 160 位元金鑰",
    lblKdf: "KDF 強度",
    lblKdfHigh: "高安全性（256 MiB）",
    lblKdfLow: "低記憶體（64 MiB）",
    lblKdfNote: "封裝完成後將彈出 QR 碼，請以驗證器 App 掃描匯入。",
    digitsNote6: "6 位：相容所有驗證器 App（Google / Microsoft / ZOHO / Proton 等）。",
    digitsNote8: "⚠ 8 位建議使用 Google、ZOHO、Proton Authenticator；微軟 Authenticator 僅支援 6 位。",
    digitsShort: "位",
    lblSave: "儲存位置",
    lblEntries: "項目數",
    lblCopyKey: "複製金鑰",
    lblWarn: "遺失 Base32 金鑰後 TOTP 憑證將無法復原，請妥善備份。",
    // 按钮
    btnBrowse: "瀏覽…",
    btnCancel: "取消",
    btnOpen: "開啟",
    btnStart: "開始封裝",
    btnAdd: "新增",
    btnGen: "產生",
    btnDone: "完成",
    btnOk: "確定",
    btnUnlock: "前往解鎖",
    // 文件列表
    colName: "名稱",
    colKindDir: "資料夾",
    colKindFile: "檔案",
    colSize: "大小",
    colModified: "修改日期",
    colKind: "類型",
    lblFolderEmpty: "此資料夾是空的",
    lblNoContainer: "未開啟容器",
    lblNoContainerSub: "開啟一個 .astbox 檔案，或產生一個 .astbox 容器開始體驗。",
    lblReady: "容器已就緒",
    lblReadySub: "在右側輸入驗證器顯示的 TOTP 驗證碼解鎖<br>Argon2id 金鑰衍生需要數秒，請耐心等待",
    // 侧栏
    lblOutDir: "輸出目錄",
    lblOutDirHint: "擷取檔案儲存到…",
    // 拖放
    dropText: "放開以開啟 .astbox 容器",
    // 主题
    themeAuto: "跟隨系統",
    themeLight: "淺色",
    themeDark: "深色",
    themeToggle: "外觀: %s（點擊切換）",
    // 窗口
    quitTitle: "ASTBOX 已結束",
    quitSub: "本機服務已停止，可以關閉此分頁了。",
    // 口令包
    packPassHint: "為傳播套件設定密碼（留空並確定 = 產生免密碼快速套件）：",
    packGenOk: "傳播套件已產生:%s",
    // 新容器
    genCreated: "容器已產生",
    genCreatedSub: "容器已開啟並處於鎖定狀態，請以驗證器 App 掃描下方 QR 碼匯入，金鑰只顯示這一次",
    // 提取
    extracting: "正在擷取…",
    packing: "正在封裝…",
    generating: "正在產生…",
    generateShort: "產生",
    specifySave: "請指定儲存位置",
    // about sub
    aboutBody: "依據 ASTBOX v1.0 規範實作的加密容器<br>解碼 / 瀏覽 / 擷取 / 封裝工具<br><br>密碼學: Argon2id + HKDF-SHA-256 + XChaCha20-Poly1305<br>介面: Liquid Glass Design System",
    selftestBody: "Argon2id / HKDF / AEAD / TOTP 全部通過",
    // 浏览器
    openBrowse: "選擇檔案…（本機上傳）",
    openPath: "輸入伺服器本機路徑…",
    // 其他
    notFolder: "所選項目不是資料夾",
    dlgOpenFile: "選擇 .astbox 容器",
    dlgPackDir: "選擇要封裝的資料夾",
    dlgSaveAs: "儲存為 .astbox",
    dlgPickOutDir: "選擇擷取輸出目錄",
    ftAstbox: "ASTBOX 容器",
    ftAll: "所有檔案",
    ftPassbox: "ASTBOX 傳播套件",
    parsedUnlock: "容器已解析，請輸入憑證解鎖",
    openOrSpecify: "請先開啟並解鎖容器，或指定來源資料夾",
    copiedKey: "金鑰已複製",
    b32Prompt: "輸入 Base32 TOTP 金鑰（來自你的驗證器）:",
    totpComputed: "TOTP(%d 位) = %s",
    ttClose: "結束 ASTBOX（關閉本機服務）",
    ttMin: "最小化請使用 Windows UI",
    ttZoom: "進入/結束全螢幕",
    navBack: "返回", navFwd: "前進", navUp: "上層目錄",
    ttOpenBox: "開啟 .astbox 容器…", ttPackBox: "封裝為 .astbox…",
    ttAddBox: "新增檔案到目前目錄…", ttExtractBox: "擷取選取的檔案",
    ttVerifyBox: "驗證容器完整性", ttMore: "更多動作",
    ttLang: "切換語言", ttTheme: "切換外觀",
    unlockTopBtn: "解鎖…",
    ccEmptyTitle: "未開啟容器",
    ccEmptySub: "開啟一個 .astbox 檔案，或產生 .astbox 容器開始體驗。",
    dtFiles: "檔案數", dtCred: "憑證",
    otpHead: "輸入 TOTP 驗證碼",
    btnUnlockSide: "解鎖",
    btnCalc: "Base32 計算…", ttCalc: "以 Base32 金鑰計算目前驗證碼",
    btnLockSide: "鎖定並清除憑證",
    sideLocation: "位置", qRoot: "根目錄", sideActions: "操作",
    opOpen: "開啟容器…", opPack: "封裝資料夾…", opDemo: "產生 .astbox 容器…",
    opAddFiles: "新增檔案…", opAddFolder: "新增資料夾…",
    opExtractAll: "擷取全部檔案", opVerify: "驗證完整性", opSelftest: "密碼學自我測試",
    heroSub: "加密容器的解碼 · 瀏覽 · 擷取 · 封裝<br>Argon2id + HKDF-SHA256 + XChaCha20-Poly1305",
    btnHeroOpen: "開啟 .astbox 檔案…", btnHeroDemo: "產生 .astbox 容器",
    heroDim: "也可以把 .astbox 檔案拖曳進本視窗",
    statusReady: "就緒",
    dlgAddFiles2: "選擇要新增的檔案（可多選）",
    dlgAddFolder2: "選擇要新增的資料夾",
    items: "%d 個物件",
    passGenOk: "傳播套件已產生:%s",
    // P5 .passbox 导入(双击/启动参数承接)
    importTitle: "匯入傳播套件",
    importSub: "將內嵌容器寫入傳播套件同目錄，並登記其驗證碼金鑰（免重錄）",
    packPassLabel: "密碼",
    btnImport: "匯入",
    importOk: "傳播套件已匯入，請輸入驗證碼解鎖",
    // 工具栏 aria 群组标签
    grpNav: "導覽", grpOps: "操作", mainToolbar: "主導覽",
    addrBar: "位址列", sidePanel: "側邊欄", fileList: "檔案清單", stDot: "狀態",
  },

  /* ---- es:Rust 线扩展语言(中性西语, tú 体;非 C# 谱系逐字资产) ---- */
  es: {
    // 状态栏
    sEmpty: "Listo — abre un contenedor .astbox para empezar",
    sLocked: "Contenedor cargado — introduce tu código TOTP para desbloquearlo",
    sUnlocked: "Desbloqueado",
    // 地址栏
    addrEdit: "Haz doble clic para editar la ruta",
    // OTP
    otpEnter: "Introduce el código completo de %d dígitos",
    otpDigit: "Dígito del código %d",
    otpDigitsLbl: "Código de %d dígitos",
    // 错误
    errConn: "Se perdió la conexión con el servidor",
    errReq: "Error en la solicitud (%d)",
    errFileSize: "El contenedor supera el límite de 4 GiB; usa \"Examinar (ruta local)\" en su lugar",
    errOutput: "Indica primero un directorio de salida en la barra lateral",
    errUnlock: "Desbloquea primero el contenedor",
    errSpecify: "Indica un archivo de destino",
    errPaths: "Introduce al menos una ruta",
    atLeastOnePath: "Introduce al menos una ruta",
    errBrowse: "No se pudo abrir el diálogo de archivos — escribe la ruta abajo",
    errNoSel: "Selecciona primero archivos de la lista",
    // Toast/确认
    tUnlocked: "Contenedor desbloqueado",
    tLocked: "Contenedor bloqueado",
    tCopied: "Copiado",
    file: "Archivo",
    tExtracted: "%d archivos extraídos → %s",
    tGen: "Generado",
    // 菜单
    mExtractSel: "Extraer selección",
    mExtractAll: "Extraer todo",
    mOpenFolder: "Abrir / entrar en la carpeta",
    mRefresh: "Actualizar",
    mExportPack: "Exportar paquete de transferencia",
    mLock: "Bloquear contenedor",
    mAbout: "Acerca de",
    // Sheet 标题
    shOpen: "Abrir contenedor",
    shOpenSub: "Selecciona un archivo .astbox del servidor o escribe su ruta",
    shPack: "Empaquetar en un contenedor .astbox",
    shPackSub: "Empaqueta una carpeta en un contenedor cifrado. Tu código TOTP es la única forma de desbloquearlo.",
    shAddFile: "Añadir archivos al directorio actual",
    shAddFolder: "Añadir carpeta al directorio actual",
    shAddSub: "Haz clic en los botones de abajo, o escribe una ruta local del servidor por línea",
    shGen: "Generar un contenedor .astbox",
    shGenSub: "Incluye archivos de ejemplo (documentos, muestras binarias, etc.). El secreto TOTP se genera automáticamente — el contenedor se abre justo tras crearse.",
    shVerify: "Verificación de integridad superada",
    shSelftest: "Autodiagnóstico criptográfico",
    selftestPass: "Autodiagnóstico criptográfico superado",
    shAbout: "ASTBOX Administrador de contenedores",
    shAboutBody: "Implementación de contenedor cifrado según la especificación ASTBOX v1.0<br>Herramienta de decodificación / examen / extracción / empaquetado<br><br>Criptografía: Argon2id + HKDF-SHA-256 + XChaCha20-Poly1305<br>Interfaz: sistema de diseño Liquid Glass",
    packComplete: "Empaquetado completado",
    packCompleteSub: "Escanea de inmediato el código QR de abajo con tu app de autenticación; el secreto se muestra solo una vez",
    addFilesTitle: "Añadir archivos al directorio actual",
    addFolderTitle: "Añadir carpeta al directorio actual",
    addFilesSub: "Haz clic en los botones de abajo, o escribe una ruta local del servidor por línea",
    recurseNote: " (las subcarpetas se leerán de forma recursiva)",
    browseFiles: "Examinar archivos…",
    browseFolders: "Examinar carpetas…",
    pathList: "Lista de rutas",
    pathListNote: "La adición se escribirá como una transacción de Generation y volverá a cifrar el contenedor",
    addedFiles: "Añadidos %d archivos (Generation %d)",
    copied: "Copiado",
    // 表单标签
    lblFilePath: "Ruta del archivo",
    lblSource: "Carpeta de origen (déjalo vacío para empaquetar todo el contenido)",
    lblTarget: "Archivo .astbox de destino",
    lblDigits: "Longitud del código",
    lblB32: "Secreto Base32 (déjalo vacío para generarlo automáticamente)",
    lblB32Hint: "Generar automáticamente un secreto de 160 bits",
    lblKdf: "Fuerza del KDF",
    lblKdfHigh: "Seguridad máxima (256 MiB de RAM)",
    lblKdfLow: "RAM mínima (64 MiB)",
    lblKdfNote: "Tras el empaquetado aparecerá un código QR. Escanéalo con tu app de autenticación para importar el secreto.",
    digitsNote6: "6 dígitos: compatible con todas las apps de autenticación (Google / Microsoft / ZOHO / Proton, etc.)",
    digitsNote8: "⚠ Se recomiendan 8 dígitos para Google, ZOHO y Proton Authenticator. Windows Authenticator solo admite 6 dígitos.",
    digitsShort: "díg.",
    lblSave: "Ubicación de guardado",
    lblEntries: "entradas",
    lblCopyKey: "Copiar secreto",
    lblWarn: "Si pierdes el secreto Base32, tus códigos TOTP serán irrecuperables. Haz una copia de seguridad del secreto ahora.",
    // 按钮
    btnBrowse: "Examinar…",
    btnCancel: "Cancelar",
    btnOpen: "Abrir",
    btnStart: "Empaquetar",
    btnAdd: "Añadir",
    btnGen: "Generar",
    btnDone: "Hecho",
    btnOk: "Aceptar",
    btnUnlock: "Desbloquear ahora",
    // 文件列表
    colName: "Nombre",
    colKindDir: "Carpeta",
    colKindFile: "Archivo",
    colSize: "Tamaño",
    colModified: "Modificado",
    colKind: "Tipo",
    lblFolderEmpty: "Esta carpeta está vacía",
    lblNoContainer: "Ningún contenedor abierto",
    lblNoContainerSub: "Abre un archivo .astbox o genera un contenedor nuevo para empezar.",
    lblReady: "Contenedor listo",
    lblReadySub: "Introduce a la derecha el código TOTP que muestra tu app de autenticación para desbloquear<br>La derivación de clave Argon2id tarda unos segundos — espera un momento",
    // 侧栏
    lblOutDir: "Directorio de salida",
    lblOutDirHint: "Destino de la extracción…",
    // 拖放
    dropText: "Suelta aquí un archivo .astbox para abrirlo",
    // 主题
    themeAuto: "Según el sistema",
    themeLight: "Claro",
    themeDark: "Oscuro",
    themeToggle: "Tema: %s",
    // 窗口
    quitTitle: "ASTBOX se ha cerrado",
    quitSub: "El servidor se detuvo. Puedes cerrar esta pestaña.",
    // 口令包
    packPassHint: "Define una contraseña para el paquete de transferencia (déjalo vacío para un paquete rápido sin contraseña):",
    packGenOk: "Paquete de transferencia generado: %s",
    // 新容器
    genCreated: "Contenedor generado",
    genCreatedSub: "El contenedor ahora está bloqueado; escanea el código QR de abajo con tu app de autenticación para importar el secreto; se muestra solo una vez",
    // 提取
    extracting: "Extrayendo…",
    packing: "Empaquetando…",
    generating: "Generando…",
    generateShort: "Generar",
    specifySave: "Elige una ubicación de guardado",
    // about sub
    aboutBody: "Implementación de contenedor cifrado según la especificación ASTBOX v1.0<br>Herramienta de decodificación / examen / extracción / empaquetado<br><br>Criptografía: Argon2id + HKDF-SHA-256 + XChaCha20-Poly1305<br>Interfaz: sistema de diseño Liquid Glass",
    selftestBody: "Argon2id / HKDF / AEAD / TOTP superados todos",
    // 浏览器
    openBrowse: "Cargar un archivo desde este equipo",
    openPath: "Escribir una ruta del servidor…",
    // 其他
    notFolder: "Este elemento no es una carpeta",
    items: "%d elementos",
    passGenOk: "Paquete de transferencia guardado en: %s",
    // P5 .passbox import (double-click / launch-arg flow)
    importTitle: "Importar paquete de transferencia",
    importSub: "Escribe el contenedor incrustado junto al paquete y registra su secreto (sin reinscripción)",
    packPassLabel: "Contraseña",
    btnImport: "Importar",
    importOk: "Paquete de transferencia importado — introduce el código de verificación para desbloquear",
    dlgOpenFile: "Seleccionar un contenedor .astbox",
    dlgPackDir: "Seleccionar la carpeta a empaquetar",
    dlgSaveAs: "Guardar como .astbox",
    dlgPickOutDir: "Elegir el directorio de salida de la extracción",
    ftAstbox: "Contenedores ASTBOX",
    ftAll: "Todos los archivos",
    ftPassbox: "Paquetes de transferencia ASTBOX",
    parsedUnlock: "Contenedor analizado — introduce tu código para desbloquearlo",
    openOrSpecify: "Abre y desbloquea primero un contenedor, o elige una carpeta de origen",
    copiedKey: "Secreto copiado",
    b32Prompt: "Introduce el secreto TOTP Base32 (de tu app de autenticación):",
    totpComputed: "TOTP (%d dígitos) = %s",
    ttClose: "Cerrar ASTBOX (detiene el servicio local)",
    ttMin: "Minimiza desde la interfaz de Windows",
    ttZoom: "Entrar/salir de pantalla completa",
    navBack: "Atrás", navFwd: "Adelante", navUp: "Subir un nivel",
    ttOpenBox: "Abrir un contenedor .astbox…", ttPackBox: "Empaquetar como .astbox…",
    ttAddBox: "Añadir archivos a la carpeta actual…", ttExtractBox: "Extraer los archivos seleccionados",
    ttVerifyBox: "Verificar la integridad del contenedor", ttMore: "Más acciones",
    ttLang: "Cambiar de idioma", ttTheme: "Cambiar el tema",
    unlockTopBtn: "Desbloquear…",
    ccEmptyTitle: "Ningún contenedor abierto",
    ccEmptySub: "Abre un archivo .astbox o genera un contenedor nuevo para empezar.",
    dtFiles: "Archivos", dtCred: "Credencial",
    otpHead: "Introducir el código TOTP",
    btnUnlockSide: "Desbloquear",
    btnCalc: "Cálculo Base32…", ttCalc: "Calcular el código actual a partir del secreto Base32",
    btnLockSide: "Bloquear y borrar la credencial",
    sideLocation: "Ubicaciones", qRoot: "Raíz", sideActions: "Acciones",
    opOpen: "Abrir contenedor…", opPack: "Empaquetar carpeta…", opDemo: "Generar un contenedor .astbox…",
    opAddFiles: "Añadir archivos…", opAddFolder: "Añadir carpeta…",
    opExtractAll: "Extraer todos los archivos", opVerify: "Verificar integridad", opSelftest: "Autodiagnóstico criptográfico",
    heroSub: "Decodifica · Examina · Extrae · Empaqueta contenedores cifrados<br>Argon2id + HKDF-SHA256 + XChaCha20-Poly1305",
    btnHeroOpen: "Abrir un archivo .astbox…", btnHeroDemo: "Generar un contenedor .astbox",
    heroDim: "También puedes arrastrar un archivo .astbox a esta ventana",
    statusReady: "Listo",
    dlgAddFiles2: "Elige los archivos a añadir (selección múltiple)",
    dlgAddFolder2: "Elige la carpeta a añadir",
    grpNav: "Navegación", grpOps: "Acciones", mainToolbar: "Barra de herramientas principal",
    addrBar: "Barra de direcciones", sidePanel: "Barra lateral", fileList: "Lista de archivos", stDot: "Estado",
  },

  /* ---- pt-BR:Rust 线扩展语言(巴西葡语;非 C# 谱系逐字资产) ---- */
  "pt-BR": {
    // 状态栏
    sEmpty: "Pronto — abra um contêiner .astbox para começar",
    sLocked: "Contêiner carregado — digite seu código TOTP para desbloqueá-lo",
    sUnlocked: "Desbloqueado",
    // 地址栏
    addrEdit: "Clique duas vezes para editar o caminho",
    // OTP
    otpEnter: "Digite o código completo de %d dígitos",
    otpDigit: "Dígito do código %d",
    otpDigitsLbl: "Código de %d dígitos",
    // 错误
    errConn: "A conexão com o servidor foi perdida",
    errReq: "Falha na solicitação (%d)",
    errFileSize: "O contêiner excede o limite de 4 GiB; use \"Procurar (caminho local)\" em vez disso",
    errOutput: "Especifique primeiro um diretório de saída na barra lateral",
    errUnlock: "Desbloqueie primeiro o contêiner",
    errSpecify: "Especifique um arquivo de destino",
    errPaths: "Insira pelo menos um caminho",
    atLeastOnePath: "Insira pelo menos um caminho",
    errBrowse: "Não foi possível abrir o diálogo de arquivos — digite o caminho abaixo",
    errNoSel: "Selecione primeiro arquivos na lista",
    // Toast/确认
    tUnlocked: "Contêiner desbloqueado",
    tLocked: "Contêiner bloqueado",
    tCopied: "Copiado",
    file: "Arquivo",
    tExtracted: "%d arquivos extraídos → %s",
    tGen: "Gerado",
    // 菜单
    mExtractSel: "Extrair seleção",
    mExtractAll: "Extrair tudo",
    mOpenFolder: "Abrir / entrar na pasta",
    mRefresh: "Atualizar",
    mExportPack: "Exportar pacote de transferência",
    mLock: "Bloquear contêiner",
    mAbout: "Sobre",
    // Sheet 标题
    shOpen: "Abrir contêiner",
    shOpenSub: "Selecione um arquivo .astbox no servidor ou digite seu caminho",
    shPack: "Empacotar em um contêiner .astbox",
    shPackSub: "Empacota uma pasta em um contêiner criptografado. Seu código TOTP é a única forma de desbloqueá-lo.",
    shAddFile: "Adicionar arquivos ao diretório atual",
    shAddFolder: "Adicionar pasta ao diretório atual",
    shAddSub: "Clique nos botões abaixo, ou insira um caminho local do servidor por linha",
    shGen: "Gerar um contêiner .astbox",
    shGenSub: "Inclui arquivos de exemplo (documentos, amostras binárias etc.). O segredo TOTP é gerado automaticamente — o contêiner abre logo após a criação.",
    shVerify: "Verificação de integridade bem-sucedida",
    shSelftest: "Autoteste criptográfico",
    selftestPass: "Autoteste criptográfico bem-sucedido",
    shAbout: "ASTBOX Gerenciador de contêineres",
    shAboutBody: "Implementação de contêiner criptografado conforme a especificação ASTBOX v1.0<br>Ferramenta de decodificação / navegação / extração / empacotamento<br><br>Criptografia: Argon2id + HKDF-SHA-256 + XChaCha20-Poly1305<br>Interface: sistema de design Liquid Glass",
    packComplete: "Empacotamento concluído",
    packCompleteSub: "Escaneie imediatamente o código QR abaixo com seu aplicativo autenticador; o segredo é exibido apenas uma vez",
    addFilesTitle: "Adicionar arquivos ao diretório atual",
    addFolderTitle: "Adicionar pasta ao diretório atual",
    addFilesSub: "Clique nos botões abaixo, ou insira um caminho local do servidor por linha",
    recurseNote: " (as subpastas serão lidas recursivamente)",
    browseFiles: "Procurar arquivos…",
    browseFolders: "Procurar pastas…",
    pathList: "Lista de caminhos",
    pathListNote: "A adição será gravada como uma transação de Generation e criptografará o contêiner novamente",
    addedFiles: "%d arquivos adicionados (Generation %d)",
    copied: "Copiado",
    // 表单标签
    lblFilePath: "Caminho do arquivo",
    lblSource: "Pasta de origem (deixe em branco para empacotar todo o conteúdo)",
    lblTarget: "Arquivo .astbox de destino",
    lblDigits: "Comprimento do código",
    lblB32: "Segredo Base32 (deixe em branco para gerar automaticamente)",
    lblB32Hint: "Gerar automaticamente um segredo de 160 bits",
    lblKdf: "Força do KDF",
    lblKdfHigh: "Segurança máxima (256 MiB de RAM)",
    lblKdfLow: "RAM mínima (64 MiB)",
    lblKdfNote: "Um código QR aparecerá após o empacotamento. Escaneie-o com seu aplicativo autenticador para importar o segredo.",
    digitsNote6: "6 dígitos: compatível com todos os aplicativos autenticadores (Google / Microsoft / ZOHO / Proton etc.)",
    digitsNote8: "⚠ Recomendam-se 8 dígitos para Google, ZOHO e Proton Authenticator. O Windows Authenticator só é compatível com 6 dígitos.",
    digitsShort: "díg.",
    lblSave: "Local para salvar",
    lblEntries: "entradas",
    lblCopyKey: "Copiar segredo",
    lblWarn: "Se você perder o segredo Base32, seus códigos TOTP ficarão irrecuperáveis. Faça backup do segredo agora.",
    // 按钮
    btnBrowse: "Procurar…",
    btnCancel: "Cancelar",
    btnOpen: "Abrir",
    btnStart: "Empacotar",
    btnAdd: "Adicionar",
    btnGen: "Gerar",
    btnDone: "Concluído",
    btnOk: "OK",
    btnUnlock: "Desbloquear agora",
    // 文件列表
    colName: "Nome",
    colKindDir: "Pasta",
    colKindFile: "Arquivo",
    colSize: "Tamanho",
    colModified: "Modificado",
    colKind: "Tipo",
    lblFolderEmpty: "Esta pasta está vazia",
    lblNoContainer: "Nenhum contêiner aberto",
    lblNoContainerSub: "Abra um arquivo .astbox ou gere um novo contêiner para começar.",
    lblReady: "Contêiner pronto",
    lblReadySub: "Digite à direita o código TOTP exibido pelo seu aplicativo autenticador para desbloquear<br>A derivação de chave Argon2id leva alguns segundos — aguarde",
    // 侧栏
    lblOutDir: "Diretório de saída",
    lblOutDirHint: "Destino da extração…",
    // 拖放
    dropText: "Solte aqui um arquivo .astbox para abri-lo",
    // 主题
    themeAuto: "Seguir o sistema",
    themeLight: "Claro",
    themeDark: "Escuro",
    themeToggle: "Tema: %s",
    // 窗口
    quitTitle: "O ASTBOX foi encerrado",
    quitSub: "O servidor foi parado. Você pode fechar esta aba.",
    // 口令包
    packPassHint: "Defina uma senha para o pacote de transferência (deixe em branco para um pacote rápido sem senha):",
    packGenOk: "Pacote de transferência gerado: %s",
    // 新容器
    genCreated: "Contêiner gerado",
    genCreatedSub: "O contêiner agora está bloqueado; escaneie o código QR abaixo com seu aplicativo autenticador para importar o segredo; ele é exibido apenas uma vez",
    // 提取
    extracting: "Extraindo…",
    packing: "Empacotando…",
    generating: "Gerando…",
    generateShort: "Gerar",
    specifySave: "Escolha um local para salvar",
    // about sub
    aboutBody: "Implementação de contêiner criptografado conforme a especificação ASTBOX v1.0<br>Ferramenta de decodificação / navegação / extração / empacotamento<br><br>Criptografia: Argon2id + HKDF-SHA-256 + XChaCha20-Poly1305<br>Interface: sistema de design Liquid Glass",
    selftestBody: "Argon2id / HKDF / AEAD / TOTP todos aprovados",
    // 浏览器
    openBrowse: "Enviar um arquivo deste computador",
    openPath: "Digitar um caminho no servidor…",
    // 其他
    notFolder: "Este item não é uma pasta",
    items: "%d itens",
    passGenOk: "Pacote de transferência salvo em: %s",
    // P5 .passbox import (double-click / launch-arg flow)
    importTitle: "Importar pacote de transferência",
    importSub: "Grava o contêiner incorporado ao lado do pacote e registra seu segredo (sem novo cadastro)",
    packPassLabel: "Senha",
    btnImport: "Importar",
    importOk: "Pacote de transferência importado — digite o código de verificação para desbloquear",
    dlgOpenFile: "Selecionar um contêiner .astbox",
    dlgPackDir: "Selecionar a pasta a empacotar",
    dlgSaveAs: "Salvar como .astbox",
    dlgPickOutDir: "Escolher o diretório de saída da extração",
    ftAstbox: "Contêineres ASTBOX",
    ftAll: "Todos os arquivos",
    ftPassbox: "Pacotes de transferência ASTBOX",
    parsedUnlock: "Contêiner analisado — digite seu código para desbloqueá-lo",
    openOrSpecify: "Abra e desbloqueie primeiro um contêiner, ou escolha uma pasta de origem",
    copiedKey: "Segredo copiado",
    b32Prompt: "Digite o segredo TOTP Base32 (do seu aplicativo autenticador):",
    totpComputed: "TOTP (%d dígitos) = %s",
    ttClose: "Encerrar o ASTBOX (interrompe o serviço local)",
    ttMin: "Minimize pela interface do Windows",
    ttZoom: "Entrar/sair da tela cheia",
    navBack: "Voltar", navFwd: "Avançar", navUp: "Subir um nível",
    ttOpenBox: "Abrir um contêiner .astbox…", ttPackBox: "Empacotar como .astbox…",
    ttAddBox: "Adicionar arquivos à pasta atual…", ttExtractBox: "Extrair os arquivos selecionados",
    ttVerifyBox: "Verificar a integridade do contêiner", ttMore: "Mais ações",
    ttLang: "Mudar o idioma", ttTheme: "Alternar o tema",
    unlockTopBtn: "Desbloquear…",
    ccEmptyTitle: "Nenhum contêiner aberto",
    ccEmptySub: "Abra um arquivo .astbox ou gere um novo contêiner para começar.",
    dtFiles: "Arquivos", dtCred: "Credencial",
    otpHead: "Digitar o código TOTP",
    btnUnlockSide: "Desbloquear",
    btnCalc: "Cálculo Base32…", ttCalc: "Calcular o código atual a partir do segredo Base32",
    btnLockSide: "Bloquear e apagar a credencial",
    sideLocation: "Locais", qRoot: "Raiz", sideActions: "Ações",
    opOpen: "Abrir contêiner…", opPack: "Empacotar pasta…", opDemo: "Gerar um contêiner .astbox…",
    opAddFiles: "Adicionar arquivos…", opAddFolder: "Adicionar pasta…",
    opExtractAll: "Extrair todos os arquivos", opVerify: "Verificar integridade", opSelftest: "Autoteste criptográfico",
    heroSub: "Decodifique · Navegue · Extraia · Empacote contêineres criptografados<br>Argon2id + HKDF-SHA256 + XChaCha20-Poly1305",
    btnHeroOpen: "Abrir um arquivo .astbox…", btnHeroDemo: "Gerar um contêiner .astbox",
    heroDim: "Você também pode arrastar um arquivo .astbox para esta janela",
    statusReady: "Pronto",
    dlgAddFiles2: "Escolha os arquivos a adicionar (seleção múltipla)",
    dlgAddFolder2: "Escolha a pasta a adicionar",
    grpNav: "Navegação", grpOps: "Ações", mainToolbar: "Barra de ferramentas principal",
    addrBar: "Barra de endereços", sidePanel: "Barra lateral", fileList: "Lista de arquivos", stDot: "Estado",
  },

  ja: {
    // 状态栏
    sEmpty: "準備完了 — .astbox コンテナを開いて始めましょう",
    sLocked: "コンテナ読み込み済み — TOTP 認証コードを入力してロック解除",
    sUnlocked: "ロック解除済み",
    // 地址栏
    addrEdit: "ダブルクリックでパスを編集",
    // OTP
    otpEnter: "%d 桁すべての認証コードを入力してください",
    otpDigit: "認証コード 第%d桁",
    otpDigitsLbl: "%d 桁の認証コード",
    // 错误
    errConn: "サーバーとの接続が切断されました",
    errReq: "リクエスト失敗 (%d)",
    errFileSize: "コンテナが 4 GiB 上限を超えています。「参照(ローカルパス)」をご利用ください",
    errOutput: "先にサイドバーに出力フォルダーを入力してください",
    errUnlock: "先にコンテナをロック解除してください",
    errSpecify: "保存先ファイルを指定してください",
    errPaths: "パスを少なくとも 1 つ入力してください",
    atLeastOnePath: "パスを少なくとも 1 つ入力してください",
    errBrowse: "システムダイアログを開けませんでした。下の欄に直接パスを入力してください",
    errNoSel: "先にリストからファイルを選択してください",
    // Toast/确认
    tUnlocked: "コンテナのロックを解除しました",
    tLocked: "ロックしました",
    tCopied: "コピーしました",
    file: "ファイル",
    tExtracted: "%d 個のファイルを展開しました → %s",
    tGen: "生成しました",
    // 菜单
    mExtractSel: "選択したファイルを展開",
    mExtractAll: "すべて展開",
    mOpenFolder: "開く（フォルダーへ移動）",
    mRefresh: "更新",
    mExportPack: ".passbox 伝播パッケージを生成",
    mLock: "コンテナをロック",
    mAbout: "このアプリについて",
    // Sheet 标题
    shOpen: "コンテナを開く",
    shOpenSub: "サーバー上の .astbox ファイルを選択または入力",
    shPack: ".astbox コンテナへパック化",
    shPackSub: "フォルダーを暗号化コンテナへパック化します。TOTP 認証コードだけが解錠手段です",
    shAddFile: "現在のディレクトリへファイルを追加",
    shAddFolder: "現在のディレクトリへフォルダーを追加",
    shAddSub: "下のボタンで参照選択、または 1 行に 1 件ずつサーバーのローカルパスを入力",
    shGen: ".astbox コンテナを生成",
    shGenSub: "サンプルファイル（説明書・バイナリ等）を同梱し、TOTP シークレットを自動生成。生成後すぐに開いて体験できます",
    shVerify: "整合性検証に合格しました",
    shSelftest: "暗号セルフテスト",
    selftestPass: "暗号セルフテスト合格",
    shAbout: "ASTBOX コンテナマネージャー",
    shAboutBody: "ASTBOX v1.0 仕様準拠の暗号化コンテナ<br>デコード / ブラウズ / 展開 / パック化ツール<br><br>暗号: Argon2id + HKDF-SHA-256 + XChaCha20-Poly1305<br>UI: Liquid Glass Design System",
    packComplete: "パック化が完了しました",
    packCompleteSub: "下の QR コードを今すぐ認証アプリでスキャンしてください。シークレットは今回のみ表示されます",
    addFilesTitle: "現在のディレクトリへファイルを追加",
    addFolderTitle: "現在のディレクトリへフォルダーを追加",
    addFilesSub: "下のボタンで参照選択、または 1 行に 1 件ずつサーバーのローカルパスを入力",
    recurseNote: "（サブフォルダーも再帰的に読み込みます）",
    browseFiles: "ファイルを参照…",
    browseFolders: "フォルダーを参照…",
    pathList: "パス一覧",
    pathListNote: "追加は Generation トランザクションとして書き込まれ、コンテナは再暗号化されます",
    addedFiles: "%d 個のファイルを追加しました（Generation %d）",
    copied: "コピーしました",
    // 表单标签
    lblFilePath: "ファイルパス",
    lblSource: "ソースフォルダー（空欄＝現在のコンテナ内容全体）",
    lblTarget: "出力 .astbox ファイル",
    lblDigits: "認証コード桁数",
    lblB32: "Base32 シークレット（空欄＝自動生成）",
    lblB32Hint: "160 ビットのシークレットを自動生成",
    lblKdf: "KDF 強度",
    lblKdfHigh: "最高セキュリティ（256 MiB）",
    lblKdfLow: "省メモリ（64 MiB）",
    lblKdfNote: "パック化後に QR コードが表示されます。認証アプリでスキャンして取り込んでください。",
    digitsNote6: "6 桁：すべての認証アプリと互換（Google / Microsoft / ZOHO / Proton など）。",
    digitsNote8: "⚠ 8 桁は Google・ZOHO・Proton Authenticator 推奨。Microsoft Authenticator は 6 桁のみ対応です。",
    digitsShort: "桁",
    lblSave: "保存先",
    lblEntries: "件数",
    lblCopyKey: "シークレットをコピー",
    lblWarn: "Base32 シークレットを失うと TOTP 認証情報は復元できません。必ずバックアップを取ってください。",
    // 按钮
    btnBrowse: "参照…",
    btnCancel: "キャンセル",
    btnOpen: "開く",
    btnStart: "パック化開始",
    btnAdd: "追加",
    btnGen: "生成",
    btnDone: "完了",
    btnOk: "OK",
    btnUnlock: "ロック解除へ",
    // 文件列表
    colName: "名前",
    colKindDir: "フォルダー",
    colKindFile: "ファイル",
    colSize: "サイズ",
    colModified: "更新日時",
    colKind: "種類",
    lblFolderEmpty: "このフォルダーは空です",
    lblNoContainer: "コンテナ未接続",
    lblNoContainerSub: ".astbox ファイルを開くか、新しいコンテナを生成して始めましょう。",
    lblReady: "コンテナ準備完了",
    lblReadySub: "右側に認証アプリの表示する TOTP 認証コードを入力してロック解除<br>Argon2id の鍵導出には数秒かかります",
    // 侧栏
    lblOutDir: "出力フォルダー",
    lblOutDirHint: "展開先…",
    // 拖放
    dropText: "離して .astbox コンテナを開く",
    // 主题
    themeAuto: "システムに従う",
    themeLight: "ライト",
    themeDark: "ダーク",
    themeToggle: "外観: %s（クリックで切替）",
    // 窗口
    quitTitle: "ASTBOX を終了しました",
    quitSub: "ローカルサービスを停止しました。このタブを閉じられます。",
    // 口令包
    packPassHint: "伝播パッケージのパスフレーズを設定（空欄＋確定でノンパスのクイックパッケージ）：",
    packGenOk: "伝播パッケージを生成しました：%s",
    // 新容器
    genCreated: "コンテナを生成しました",
    genCreatedSub: "コンテナはロック状態で開かれました。下の QR コードを認証アプリでスキャンして取り込んでください。シークレットは今回のみ表示されます",
    // 提取
    extracting: "展開中…",
    packing: "パック化中…",
    generating: "生成中…",
    generateShort: "生成",
    specifySave: "保存先を指定してください",
    // about sub
    aboutBody: "ASTBOX v1.0 仕様準拠の暗号化コンテナ<br>デコード / ブラウズ / 展開 / パック化ツール<br><br>暗号: Argon2id + HKDF-SHA-256 + XChaCha20-Poly1305<br>UI: Liquid Glass Design System",
    selftestBody: "Argon2id / HKDF / AEAD / TOTP すべて合格",
    // 浏览器
    openBrowse: "ファイルを選択…（この端末からアップロード）",
    openPath: "サーバーのローカルパスを入力…",
    // 其他
    notFolder: "選択した項目はフォルダーではありません",
    dlgOpenFile: ".astbox コンテナを選択",
    dlgPackDir: "パック化するフォルダーを選択",
    dlgSaveAs: ".astbox として保存",
    dlgPickOutDir: "展開先フォルダーを選択",
    ftAstbox: "ASTBOX コンテナ",
    ftAll: "すべてのファイル",
    ftPassbox: "ASTBOX 伝播パッケージ",
    parsedUnlock: "コンテナ解析済み — 認証情報を入力してロック解除",
    openOrSpecify: "まずコンテナを開いてロック解除するか、ソースフォルダーを指定してください",
    copiedKey: "シークレットをコピーしました",
    b32Prompt: "Base32 TOTP シークレットを入力（認証アプリのもの）:",
    totpComputed: "TOTP(%d 桁) = %s",
    ttClose: "ASTBOX を終了（ローカルサービス停止）",
    ttMin: "最小化は Windows UI を使用",
    ttZoom: "全画面を切り替え",
    navBack: "戻る", navFwd: "進む", navUp: "上へ",
    ttOpenBox: ".astbox コンテナを開く…", ttPackBox: ".astbox へパック化…",
    ttAddBox: "現在のディレクトリへファイル追加…", ttExtractBox: "選択ファイルを展開",
    ttVerifyBox: "整合性を検証", ttMore: "その他の操作",
    ttLang: "言語を切り替え", ttTheme: "外観を切り替え",
    unlockTopBtn: "ロック解除…",
    ccEmptyTitle: "コンテナ未接続",
    ccEmptySub: ".astbox ファイルを開くか、コンテナを生成して始めましょう。",
    dtFiles: "ファイル数", dtCred: "認証情報",
    otpHead: "TOTP 認証コードを入力",
    btnUnlockSide: "ロック解除",
    btnCalc: "Base32 計算…", ttCalc: "Base32 シークレットから現在のコードを計算",
    btnLockSide: "ロックして認証情報を消去",
    sideLocation: "場所", qRoot: "ルート", sideActions: "操作",
    opOpen: "コンテナを開く…", opPack: "フォルダーをパック化…", opDemo: ".astbox コンテナを生成…",
    opAddFiles: "ファイルを追加…", opAddFolder: "フォルダーを追加…",
    opExtractAll: "すべて展開", opVerify: "整合性検証", opSelftest: "暗号セルフテスト",
    heroSub: "暗号化コンテナの デコード · ブラウズ · 展開 · パック化<br>Argon2id + HKDF-SHA256 + XChaCha20-Poly1305",
    btnHeroOpen: ".astbox ファイルを開く…", btnHeroDemo: ".astbox コンテナを生成",
    heroDim: "このウィンドウへの .astbox ファイルのドロップも可能",
    statusReady: "準備完了",
    dlgAddFiles2: "追加するファイルを選択（複数可）",
    dlgAddFolder2: "追加するフォルダーを選択",
    items: "%d 件",
    passGenOk: "伝播パッケージを保存しました：%s",
    // P5 .passbox 取り込み(ダブルクリック/起動引数フロー)
    importTitle: "伝播パッケージを取り込む",
    importSub: "内蔵コンテナをパッケージと同じフォルダーに書き出し、シークレットを登録します(再登録不要)",
    packPassLabel: "パスフレーズ",
    btnImport: "取り込む",
    importOk: "取り込み完了 — 確認コードを入力してロック解除してください",
    // 工具栏 aria 群组标签
    grpNav: "ナビゲーション", grpOps: "操作", mainToolbar: "メインツールバー",
    addrBar: "アドレスバー", sidePanel: "サイドバー", fileList: "ファイル一覧", stDot: "状態",
  }
};

/* 动态替换字符串中的 %s / %d 占位符 */
function _fmt(str, ...args) {
  if (args.length === 1 && typeof args[0] === "number") args = [args[0]];
  let i = 0;
  return str.replace(/%[sd]/g, () => String(args[i++]));
}

/* 静态 DOM 文案应用：data-i18n / data-i18n-html / data-i18n-ph / data-i18n-title */
function _applyStatic() {
  document.querySelectorAll("[data-i18n]").forEach(n => { n.textContent = _t(n.dataset.i18n); });
  document.querySelectorAll("[data-i18n-html]").forEach(n => { n.innerHTML = _t(n.dataset.i18nHtml); });
  document.querySelectorAll("[data-i18n-ph]").forEach(n => { n.placeholder = _t(n.dataset.i18nPh); });
  document.querySelectorAll("[data-i18n-title]").forEach(n => {
    const s = _t(n.dataset.i18nTitle);
    n.title = s; n.setAttribute("aria-label", s);
  });
  document.querySelectorAll("[data-i18n-aria]").forEach(n => {
    n.setAttribute("aria-label", _t(n.dataset.i18nAria));
  });
  document.title = ({ zh: "ASTBOX 容器管理器 · V3.1.4",
                      en: "ASTBOX Container Manager · V3.1.4",
                      ja: "ASTBOX コンテナマネージャー · V3.1.4" })[_lang]
                   || "ASTBOX 容器管理器 · V3.1.4";
  const lc = document.getElementById("langCode");
  if (lc) lc.textContent = _LANG_CODES[_lang] || _lang;
}

/* 动态已渲染片段刷新（语言切换时） */
function _refreshI18n() {
  _applyStatic();
  const hintEl = document.querySelector(".addr-hint");
  if (hintEl) hintEl.textContent = _t("addrEdit");
  if (typeof applyTheme === "function") applyTheme();   // 同步 btnTheme tooltip
  if (typeof renderAll === "function") renderAll();
}

/* 语言切换入口(下拉菜单选择) */
const _LANGS = ["zh", "en", "ja"];
const _LANG_CODES = { zh: "中", en: "EN", ja: "あ" };          // 按钮代码(各语言自称)
const _LANG_MENU  = { zh: "中文(简体)", en: "English", ja: "日本語" }; // 菜单项(各自语言, 不走翻译)
function _setLang(l) {
  if (!_LANGS.includes(l) || l === _lang) return;
  _lang = l;
  localStorage.setItem(_LANG_KEY, _lang);
  document.documentElement.lang = _lang;
  _refreshI18n();
}
function _switchLang() { _setLang(_LANGS[(_LANGS.indexOf(_lang) + 1) % _LANGS.length] || "zh"); }

/* 启动：脚本位于 body 尾部，DOM 已就绪，直接执行 */
const _savedLang = localStorage.getItem(_LANG_KEY);
if (_LANGS.includes(_savedLang)) _lang = _savedLang;
document.documentElement.lang = _lang;
_applyStatic();

/* ---------------- 服务器错误消息本地化(ja) ----------------
   服务器侧消息保持中文原样(双轨契约), 前端按 exact/pattern 两级查表映射。
   未命中一律原样透传 —— 永不因新增服务器文案而裸崩。仅 ja 生效,
   zh/en 维持既有透传行为。 */
const _SRV_EXACT = {
  "请先解锁容器": "先にコンテナをロック解除してください",
  "尚未打开容器": "コンテナが開かれていません",
  "请指定输出路径": "出力パスを指定してください",
  "请指定输出目录": "出力フォルダーを指定してください",
  "请指定目标文件": "保存先ファイルを指定してください",
  "请指定保存位置": "保存先を指定してください",
  "请手动输入路径": "パスを手動で入力してください",
  "位数未知": "桁数不明",
  "请求体过大": "リクエストボディが大きすぎます",
  "目录不存在": "ディレクトリが存在しません",
  "没有可添加的文件": "追加できるファイルがありません",
  "所选项目中没有文件": "選択した項目にファイルがありません",
  "无可用端口": "利用可能なポートがありません",
  "文件为空或过大(上限 4 GiB)": "ファイルが空または大きすぎます（上限 4 GiB）",
  "完整性验证通过：全部数据记录认证成功": "整合性検証に合格：全データレコードの認証に成功しました",
  "口令连续错误，已放弃导入": "パスフレーズの誤入力が続いたため、インポートを中止しました",
  "已取消导入": "インポートを取り消しました",
  "请在封装该容器的设备上解锁，或重新封装。": "このコンテナを作成した端末でロック解除するか、再パック化してください。",
  "本机没有该容器的密钥记录，无法生成传播包": "この端末にはこのコンテナのシークレット記録がないため、伝播パッケージを生成できません",
  "本机没有该容器的密钥记录，无法校验验证码。": "この端末にはこのコンテナのシークレット記録がないため、認証コードを照合できません。",
  "请先打开并解锁要封装的容器，或指定源文件夹": "まずコンテナを開いてロック解除するか、ソースフォルダーを指定してください",
  "该传播包受口令保护，请输入口令：": "この伝播パッケージはパスフレーズで保護されています。パスフレーズを入力してください：",
};
const _SRV_PAT = [
  [/^源文件夹不存在:\s*([\s\S]+)/,        "ソースフォルダーが存在しません: $1"],
  [/^文件不存在:\s*([\s\S]+)/,            "ファイルが存在しません: $1"],
  [/^未找到目录:\s*([\s\S]+)/,            "ディレクトリが見つかりません: $1"],
  [/容器为 (\d+) 位验证码/,               "認証コードは $1 桁です"],
  [/磁盘空间不足：需要约 ([\d.,]+) GiB，剩余 ([\d.,]+) GiB/, "ディスク容量が不足しています（必要 約$1 GiB ／ 空き $2 GiB）"],
  [/^验证码不匹配（(.+?)）。[\s\S]*$/,    "認証コードが一致しません（$1）。確認事項: ① 認証アプリの時刻を本機と同期すること（±150 秒以内なら自動補正されます） ② このコンテナに対応するシークレットを使用していること"],
  [/^无法打开系统对话框\((.+?)\)，?\s*$/, "システムダイアログを開けませんでした（$1）"],
  [/^打开容器失败:\s*([\s\S]*)/,          "コンテナを開けませんでした: $1"],
  [/^写入失败:\s*([\s\S]+)/,              "書き込みに失敗しました: $1"],
  [/^生成失败:\s*([\s\S]*)/,              "生成に失敗しました: $1"],
  [/^验证码正确但容器解锁失败:\s*/,       "コードは正しいもののロック解除に失敗しました: "],
  [/客户端提前断开\(缺 (\d+) 字节\)/,     "クライアントが早期切断しました（残り $1 バイト欠損）"],
  [/^保存上传副本失败:\s*([\s\S]+)/,      "アップロードの一時保存に失敗しました: $1"],
];
function _srv(s) {
  if (typeof s !== "string" || s.length > 400) return s;   // 超长(如 dump)不处理
  if (_SRV_EXACT[s] !== undefined) return _SRV_EXACT[s];
  for (const [rx, rep] of _SRV_PAT) if (rx.test(s)) return s.replace(rx, rep);
  return s;
}

/* ---------------- 基础工具 ---------------- */
const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};

let state = {
  phase: "empty", info: null, path: "/", can_back: false,
  can_forward: false, can_up: false, items: [],
  out_dir: "", home: "", qr_ok: true,
};
let busyCount = 0;
let selection = new Set();
let sortKey = null, sortDir = 1;          // null = 服务器默认(文件夹优先)
let themeMode = localStorage.getItem("astbox-theme") || "auto";
let otpDigits = 6;
const MAX_UPLOAD = 4 * 1024 * 1024 * 1024; // 与服务器 MAX_UPLOAD 一致

/* ---------------- API ---------------- */
async function api(path, body, opts = {}) {
  setBusy(true);
  try {
    const init = { method: body === undefined ? "GET" : "POST",
                   headers: {} };
    if (body !== undefined) {
      if (body instanceof Blob || body instanceof ArrayBuffer) {
        init.body = body;
        Object.assign(init.headers, opts.headers || {});
      } else {
        init.body = JSON.stringify(body);
        init.headers["Content-Type"] = "application/json";
      }
    }
    const res = await fetch(path, init);
    let data = null;
    try { data = await res.json(); } catch { /* ignore */ }
    if (!res.ok || !data || data.ok === false) {
      throw new Error((data && data.error) ? (_lang === "ja" ? _srv(data.error) : data.error)
                                           : (_t("errReq").replace("(%d)", " (" + res.status + ")")));
    }
    if (data.state) applyState(data.state);
    return data;
  } catch (err) {
    const msg = (err instanceof TypeError)
      ? _t("errConn")
      : (err.message || String(err));
    if (!(opts.silent)) toast(msg, "err");
    throw err;
  } finally {
    setBusy(false);
  }
}

function setBusy(on) {
  busyCount = Math.max(0, busyCount + (on ? 1 : -1));
  $("#progress").hidden = busyCount === 0;
  document.querySelectorAll(".toolbar .btn-icon, .toolbar .btn")
    .forEach(b => { if (!b.dataset.keepEnabled) b.disabled = busyCount > 0; });
  renderNavButtons();
}

/* ---------------- 状态应用与渲染 ---------------- */
function applyState(s) {
  const prevPhase = state.phase;
  state = s;
  if (!s.out_dir && !$("#outDir").value) {
    $("#outDir").value = s.home ? s.home + "\\Desktop\\astbox-out" : "";
  } else if (s.out_dir) {
    $("#outDir").value = s.out_dir;
  }
  renderAll();
  if (s.phase !== prevPhase) {
    if (s.phase === "unlocked") toast(_t("tUnlocked"), "ok");
    if (s.phase === "locked" && prevPhase === "unlocked") toast(_t("tLocked"));
    if (s.phase === "locked") setTimeout(() => otpFocus(), 260);
  }
}

function renderAll() {
  renderNavButtons();
  renderAddress();
  renderContainerCard();
  renderUnlockCard();
  renderRows();
  renderStatus();
  const locked = state.phase === "locked";
  $("#btnUnlockTop").hidden = !locked;
  $("#btnAdd").disabled = state.phase !== "unlocked";
  $("#btnExtractSel").disabled = state.phase !== "unlocked";
  $("#btnVerify").disabled = state.phase !== "unlocked";
}

function renderNavButtons() {
  $("#btnBack").disabled = busyCount > 0 || !state.can_back;
  $("#btnFwd").disabled = busyCount > 0 || !state.can_forward;
  $("#btnUp").disabled = busyCount > 0 || !state.can_up;
}

function renderStatus() {
  const map = { empty: _t("sEmpty"), locked: _t("sLocked"), unlocked: _t("sUnlocked") };
  $("#stLeft").textContent = map[state.phase] || _t("sEmpty");
}

function renderAddress() {
  const bar = $("#addressBar");
  bar.innerHTML = "";
  if (state.phase === "empty") {
    bar.appendChild(el("span", "crumbs",
      '<button class="crumb" disabled>ASTBOX</button>'));
    return;
  }
  const crumbs = el("div", "crumbs");
  const segs = state.path.split("/").filter(Boolean);
  const mk = (label, path, current) => {
    const b = el("button", "crumb" + (current ? " current" : ""), label);
    b.addEventListener("click", () => nav({ path }));
    return b;
  };
  const rootBtn = mk("/", "/", segs.length === 0);
  crumbs.appendChild(rootBtn);
  let acc = "";
  segs.forEach((seg, i) => {
    acc += "/" + seg;
    const sep = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    sep.setAttribute("class", "crumb-sep");
    sep.innerHTML = '<use href="#i-chev-right"/>';
    crumbs.appendChild(sep);
    crumbs.appendChild(mk(seg, acc, i === segs.length - 1));
  });
  crumbs.appendChild(el("span", "crumb-spacer"));
  const hint = el("span", "addr-hint", _t("addrEdit"));
  crumbs.appendChild(hint);
  bar.appendChild(crumbs);

  bar.ondblclick = () => {
    const input = el("input", "addr-edit");
    input.value = state.path;
    input.spellcheck = false;
    bar.innerHTML = "";
    bar.appendChild(input);
    input.focus();
    input.select();
    const done = (commit) => {
      if (commit && input.value.trim() && input.value !== state.path) {
        nav({ path: input.value.trim() });
      } else { renderAddress(); }
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") done(true);
      if (e.key === "Escape") done(false);
      e.stopPropagation();
    });
    input.addEventListener("blur", () => done(false));
  };
}

function renderContainerCard() {
  const info = state.info;
  $("#ccEmpty").hidden = !!info;
  $("#ccBody").hidden = !info;
  if (!info) return;
  $("#ccName").textContent = info.name;
  $("#ccName").title = info.path || info.name;
  $("#ccVault").textContent = "VaultID " + info.vault_id.slice(0, 16) + "…";
  $("#ccGen").textContent = info.generation;
  $("#ccFiles").textContent = info.files === null ? "—" : info.files;
  $("#ccSlots").textContent = info.slots_digits.length
    ? info.slots_digits.map(d => "TOTP-" + d + (_lang==="zh"?_t("digitsShort"):"")).join(", ") : "TOTP";
  const badge = $("#ccStatus");
  badge.textContent = info.status;
  badge.className = "badge " + (state.phase === "unlocked" ? "ok" : "warn");
  const dot = $("#phaseDot");
  dot.className = "phase-dot " +
    (state.phase === "unlocked" ? "ok" : state.phase === "locked" ? "warn" : "");
}

function renderUnlockCard() {
  const show = state.phase === "locked";
  $("#unlockCard").hidden = !show;
  if (!show) return;
  otpDigits = (state.info && state.info.slots_digits[0]) || 6;
  buildOtpBoxes();
}

/* ---------------- OTP 分格输入 ---------------- */
function buildOtpBoxes() {
  const wrap = $("#otpBoxes");
  const single = otpDigits > 6;   // 超过 6 位：改用单个大输入框
  if (wrap.dataset.mode === String(otpDigits)) return;
  wrap.dataset.mode = String(otpDigits);
  wrap.classList.toggle("otp--single", single);
  wrap.innerHTML = "";
  if (single) {
    const inp = el("input");
    inp.type = "text";
    inp.inputMode = "numeric";
    inp.maxLength = otpDigits;
    inp.autocomplete = "one-time-code";
    inp.setAttribute("aria-label", _t("otpDigitsLbl").replace("%d", otpDigits));
    inp.addEventListener("input", () => {
      inp.value = inp.value.replace(/\D/g, "").slice(0, otpDigits);
      maybeAutoUnlock();
    });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doUnlock();
      e.stopPropagation();
    });
    wrap.appendChild(inp);
    return;
  }
  for (let i = 0; i < otpDigits; i++) {
    const inp = el("input");
    inp.type = "text";
    inp.inputMode = "numeric";
    inp.maxLength = 1;
    inp.autocomplete = "one-time-code";
    inp.setAttribute("aria-label", _t("otpDigit").replace("%d", (i + 1)));
    inp.addEventListener("input", () => {
      inp.value = inp.value.replace(/\D/g, "").slice(-1);
      inp.classList.toggle("filled", !!inp.value);
      if (inp.value && i < otpDigits - 1) wrap.children[i + 1].focus();
      maybeAutoUnlock();
    });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !inp.value && i > 0) {
        wrap.children[i - 1].focus();
      }
      if (e.key === "Enter") doUnlock();
      if (e.key === "v" && (e.metaKey || e.ctrlKey)) return; // 放行粘贴
      e.stopPropagation();
    });
    inp.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData.getData("text") || "")
        .replace(/\D/g, "");
      if (!text) return;
      for (let k = 0; k < otpDigits; k++) {
        const box = wrap.children[k];
        box.value = text[k] || "";
        box.classList.toggle("filled", !!box.value);
      }
      wrap.children[Math.min(text.length, otpDigits) - 1].focus();
      maybeAutoUnlock();
    });
    wrap.appendChild(inp);
  }
}

function otpValue() {
  return [...$("#otpBoxes").children].map(b => b.value).join("");
}

function otpFocus() {
  const first = $("#otpBoxes").children[0];
  if (first && !$("#unlockCard").hidden) first.focus();
}

let autoUnlockTimer = null;
function maybeAutoUnlock() {
  clearTimeout(autoUnlockTimer);
  if (otpValue().length === otpDigits) {
    autoUnlockTimer = setTimeout(doUnlock, 160);
  }
}

async function doUnlock() {
  const code = otpValue();
  if (code.length !== otpDigits) {
    toast(_fmt(_t("otpEnter"), otpDigits), "err");
    return;
  }
  try {
    await api("/api/unlock", { totp: code });
    $("#otpBoxes").querySelectorAll("input")
      .forEach(b => { b.value = ""; b.classList.remove("filled"); });
  } catch { /* toast 已提示 */ }
}

/* ---------------- 文件列表 ---------------- */
const EXT_COLORS = ["#5e6ad2", "#0a84ff", "#34c759", "#ff9f0a", "#ff375f",
                    "#bf5af2", "#64d2ff", "#ff6482", "#8e8e93", "#6c6c70"];
function extColor(name) {
  const m = name.match(/\.([a-z0-9]{1,5})$/i);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  let h = 0;
  for (const ch of ext) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { ext, color: EXT_COLORS[h % EXT_COLORS.length] };
}

function sortedItems() {
  const items = [...state.items];
  if (!sortKey) return items;                    // 文件夹优先(服务器已排序)
  items.sort((a, b) => {
    if (sortKey === "name") {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      return a.name.localeCompare(b.name, "zh-Hans-CN") * sortDir;
    }
    return ((a[sortKey] || 0) - (b[sortKey] || 0)) * sortDir;
  });
  return items;
}

function renderRows() {
  const ul = $("#rows");
  ul.innerHTML = "";
  selection.clear();

  const items = sortedItems();
  const hasContainer = state.phase !== "empty";
  $("#listHead").hidden = !hasContainer;
  $("#heroEmpty").hidden = state.phase !== "empty";
  $("#heroLocked").hidden = state.phase !== "locked";
  $("#heroFolderEmpty").hidden =
    !(state.phase === "unlocked" && items.length === 0);
  $("#listHead").querySelectorAll(".sortable")
    .forEach(h => {
      h.classList.toggle("asc", sortKey === h.dataset.sort && sortDir === 1);
      h.classList.toggle("desc", sortKey === h.dataset.sort && sortDir === -1);
    });

  items.forEach((item, i) => {
    const li = el("li", "row");
    li.style.setProperty("--i", i);
    li.dataset.id = item.id;

    const ec = item.is_dir ? null : extColor(item.name);
    const icon = item.is_dir
      ? '<svg class="fileic"><use href="#i-folder"/></svg>'
      : '<svg class="fileic"><use href="#i-doc"/></svg>';
    const chip = ec ? '<span class="ext-chip" style="background:' +
                     ec.color + '">' + ec.ext.toUpperCase() + "</span>" : "";
    const kind = item.is_dir ? _t("colKindDir") : (ec ? ec.ext.toUpperCase() + " " + _t("colKindFile") : _t("colKindFile"));

    li.innerHTML =
      '<div class="cell-name">' + icon +
      '<span class="fname"></span>' + chip + "</div>" +
      '<div class="cell-size">' + (item.is_dir ? "—" : item.size_h) + "</div>" +
      '<div class="cell-date">' + item.modified_h + "</div>" +
      '<div class="cell-kind">' + kind + "</div>";
    li.querySelector(".fname").textContent = item.name;

    li.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey) {
        selection.has(item.id) ? selection.delete(item.id)
                               : selection.add(item.id);
      } else if (e.shiftKey && selection.size) {
        const ids = items.map(x => x.id);
        const last = ids.indexOf([...selection].pop());
        const cur = ids.indexOf(item.id);
        ids.slice(Math.min(last, cur), Math.max(last, cur) + 1)
          .forEach(id => selection.add(id));
      } else {
        selection.clear();
        selection.add(item.id);
      }
      paintSelection();
    });
    li.addEventListener("dblclick", () => {
      if (item.is_dir) nav({ dir: item.id });
      else extractFiles([item.id]);
    });
    li.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (!selection.has(item.id)) {
        selection.clear();
        selection.add(item.id);
        paintSelection();
      }
      openRowMenu(e.clientX, e.clientY);
    });
    ul.appendChild(li);
  });

  $("#stCount").textContent = hasContainer ? _fmt(_t("items"), items.length) : "";
}

function paintSelection() {
  document.querySelectorAll(".row").forEach(li =>
    li.classList.toggle("selected", selection.has(li.dataset.id)));
}

/* ---------------- 导航 ---------------- */
async function nav(target) {
  try { await api("/api/nav", target); } catch { /* ignore */ }
}

/* ---------------- 提取 ---------------- */
function ensureOutDir() {
  const out = $("#outDir").value.trim();
  if (!out) {
    toast(_t("errOutput"), "err");
    $("#outDir").focus();
    return null;
  }
  return out;
}

async function extractFiles(ids) {
  const out = ensureOutDir();
  if (!out) return null;
  try {
    const r = await api("/api/extract", { ids, out });
    toast(_fmt(_t("tExtracted"), r.count, out), "ok");
    return r;
  } catch { return null; }
}

/* ---------------- 菜单 ---------------- */
let menuEl = null;
function closeMenu() {
  if (menuEl) { menuEl.remove(); menuEl = null; }
}
function openMenu(items, x, y) {
  closeMenu();
  menuEl = el("div", "menu glass glass--regular");
  menuEl.setAttribute("role", "menu");
  items.forEach(it => {
    if (it === "sep") { menuEl.appendChild(el("div", "menu-sep")); return; }
    const b = el("button", "menu-item" + (it.danger ? " menu-danger" : ""));
    if (it.icon) {
      const ic = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      ic.setAttribute("class", "ic");
      ic.innerHTML = '<use href="#' + it.icon + '"/>';
      b.appendChild(ic);
    }
    b.appendChild(el("span", null, it.label));
    if (it.key) b.appendChild(el("span", "mi-key", it.key));
    b.disabled = !!it.disabled;
    b.addEventListener("click", () => { closeMenu(); it.action(); });
    menuEl.appendChild(b);
  });
  document.body.appendChild(menuEl);
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = Math.min(x, innerWidth - r.width - 8) + "px";
  menuEl.style.top = Math.min(y, innerHeight - r.height - 8) + "px";
}

function openRowMenu(x, y) {
  const n = selection.size;
  openMenu([
    { label: _t("mExtractSel").replace("(%d)", "(" + n + ")"), icon: "i-download",
      action: () => extractFiles([...selection]) },
    { label: _t("mExtractAll"), icon: "i-arrow-upto",
      action: () => extractFiles(null) },
    "sep",
    { label: _t("mOpenFolder"), icon: "i-folder", disabled: n !== 1,
      action: () => {
        const item = state.items.find(i => i.id === [...selection][0]);
        if (item && item.is_dir) nav({ dir: item.id });
        else toast(_t("notFolder"), "err");
      } },
    "sep",
    { label: _t("mRefresh"), icon: "i-check", key: "F5", action: refreshState },
  ], x, y);
}

/* 生成 .passbox 传播包: 内嵌容器+密钥, 可在其它设备双击导入 */
async function doExportPassbox() {
  const name = (state.info && state.info.name) || "container.astbox";
  const stem = name.replace(/\.astbox$/i, "");
  const paths = await browsePick("save", {
    title: _t("mExportPack"),
    filetypes: [[_t("ftPassbox"), "*.passbox"]],
    defaultext: "passbox",
    initial: stem + ".passbox",
  });
  if (!paths || !paths[0]) return;
  let out = paths[0];
  if (!/\.passbox$/i.test(out)) out += ".passbox";
  const pw = prompt(_t("packPassHint"), "");
  if (pw === null) return;
  try {
    const r = await api("/api/export_passbox", { out, passphrase: pw });
    toast(_t("passGenOk").replace("%s", r.out || out), "ok");
  } catch { /* toast 已提示 */ }
}

function openMoreMenu(x, y) {
  const unlocked = state.phase === "unlocked";
  openMenu([
    { label: _t("shOpen") + "…", icon: "i-box-open", key: "Ctrl+O",
      action: openChoose },
    { label: _t("shPack") + "…", icon: "i-wand", action: openPackSheet },
    { label: _t("shGen") + "…", icon: "i-sparkle", action: makeDemo },
    "sep",
    { label: _t("shAddFile") + "…", icon: "i-plus", disabled: !unlocked,
      action: () => openAddSheet(false) },
    { label: _t("shAddFolder") + "…", icon: "i-folder-plus",
      disabled: !unlocked, action: () => openAddSheet(true) },
    { label: _t("mExtractAll"), icon: "i-arrow-upto", disabled: !unlocked,
      action: () => extractFiles(null) },
    { label: _t("shVerify"), icon: "i-shield", disabled: !unlocked,
      action: doVerify },
    { label: _t("mExportPack") + "…", icon: "i-box-open",
      disabled: !unlocked, action: doExportPassbox },
    "sep",
    { label: _t("shSelftest"), icon: "i-gear", action: doSelftest },
    { label: state.phase === "unlocked" ? _t("mLock") : _t("mAbout"),
      icon: state.phase === "unlocked" ? "i-lock" : "i-box-open",
      danger: state.phase === "unlocked",
      action: state.phase === "unlocked" ? doLock : showAbout },
  ], x, y);
}

/* ---------------- Sheet ---------------- */
let sheetDismissable = true;
function openSheet(html, opts = {}) {
  sheetDismissable = opts.dismissable !== false;
  const sheet = $("#sheet");
  sheet.innerHTML = html;
  $("#scrim").hidden = false;
  requestAnimationFrame(() => {
    const focusable = sheet.querySelector("input, textarea");
    if (focusable && !focusable.disabled) focusable.focus();
  });
  return sheet;
}
function closeSheet() {
  const sheet = $("#sheet");
  if ($("#scrim").hidden) return;
  sheet.classList.add("out");
  setTimeout(() => {
    $("#scrim").hidden = true;
    sheet.classList.remove("out");
    sheet.innerHTML = "";
  }, 200);
}

function fieldRow(labelText, inputHtml, note) {
  return '<div class="field"><label>' + labelText + "</label>" + inputHtml +
         (note ? '<div class="field-note">' + note + "</div>" : "") + "</div>";
}

/* 原生"浏览…"对话框：调用服务器端 Windows 文件对话框 */
const ASTBOX_FT = () => [[_t("ftAstbox"), "*.astbox"], [_t("ftAll"), "*.*"]];
async function browsePick(mode, opts = {}) {
  try {
    const r = await api("/api/browse", {
      mode, title: opts.title || "",
      filetypes: opts.filetypes || [],
      initial: opts.initial || "",
      defaultext: opts.defaultext || "",
    }, { silent: true });
    return r.paths || [];
  } catch (e) {
    toast(e.message || _t("errBrowse"), "err");
    return null;   // 失败时前端回退为手动编辑
  }
}

/* 路径输入行：输入框 + 浏览按钮 */
function pathRow(id, placeholder, btnId) {
  return '<div class="path-row">' +
    '<input class="text-input mono" id="' + id + '" type="text" ' +
    'spellcheck="false" placeholder="' + placeholder + '">' +
    '<button type="button" class="btn btn-glass btn-mini" id="' + btnId +
    '">' + _t("btnBrowse") + '</button></div>';
}

/* 打开容器：选择方式菜单 */
function openChoose(x, y) {
  const r = $("#btnOpen").getBoundingClientRect();
  openMenu([
    { label: _t("openBrowse"), icon: "i-box-open",
      action: () => $("#filePick").click() },
    { label: _t("openPath"), icon: "i-copy", action: openPathSheet },
  ], x !== undefined ? x : r.left, y !== undefined ? y : r.bottom + 6);
}

function openPathSheet() {
  const sheet = openSheet(
    "<h2>" + _t("shOpen") + "</h2>" +
    '<p class="sheet-sub">' + _t("shOpenSub") + '</p>' +
    fieldRow(_t("lblFilePath"), pathRow("pOpenPath", "C:\\path\\to\\file.astbox",
                                 "pOpenBrowse")) +
    '<div class="sheet-actions">' +
    '<button class="btn btn-glass" id="pCancel">' + _t("btnCancel") + '</button>' +
    '<button class="btn btn-primary" id="pOk">' + _t("btnOpen") + '</button></div>');
  sheet.querySelector("#pOpenBrowse").addEventListener("click", async () => {
    const paths = await browsePick("file",
      { title: _t("dlgOpenFile"), filetypes: ASTBOX_FT(),
        initial: sheet.querySelector("#pOpenPath").value.trim() });
    if (paths && paths.length) sheet.querySelector("#pOpenPath").value = paths[0];
  });
  const go = async () => {
    const p = sheet.querySelector("#pOpenPath").value.trim();
    if (!p) return;
    try { await api("/api/open", { path: p }); closeSheet(); }
    catch { /* ignore */ }
  };
  sheet.querySelector("#pOk").addEventListener("click", go);
  sheet.querySelector("#pCancel").addEventListener("click", closeSheet);
  sheet.querySelector("#pOpenPath").addEventListener("keydown", e => {
    if (e.key === "Enter") go();
    e.stopPropagation();
  });
}

/* 封装向导 */
const DIGITS_NOTE_6 = () => _t("digitsNote6");
const DIGITS_NOTE_8 = () => _t("digitsNote8");
function openPackSheet() {
  const sheet = openSheet(
    "<h2>" + _t("shPack") + "</h2>" +
    '<p class="sheet-sub">' + _t("shPackSub") + '</p>' +
    fieldRow(_t("lblSource"),
      pathRow("pSrc", "C:\\path\\to\\folder", "pSrcBrowse")) +
    fieldRow(_t("lblTarget"),
      pathRow("pDst", "C:\\path\\to\\output.astbox", "pDstBrowse")) +
    fieldRow(_t("lblDigits"),
      '<div class="seg" id="pDigits"><button data-v="6" class="on">6 ' + _t("digitsShort") + '</button>' +
      '<button data-v="8">8 ' + _t("digitsShort") + '</button></div>' +
      '<div class="field-note" id="digitsNote">' + DIGITS_NOTE_6() + "</div>") +
    fieldRow(_t("lblB32"),
      '<input class="text-input mono" id="pB32" type="text" spellcheck="false" ' +
      'placeholder="' + _t("lblB32Hint") + '">') +
    fieldRow(_t("lblKdf"),
      '<div class="seg" id="pProfile"><button data-v="high" class="on">' + _t("lblKdfHigh") + '</button>' +
      '<button data-v="constrained">' + _t("lblKdfLow") + '</button></div>',
      _t("lblKdfNote")) +
    '<div class="sheet-actions">' +
    '<button class="btn btn-glass" id="pCancel">' + _t("btnCancel") + '</button>' +
    '<button class="btn btn-primary" id="pOk">' + _t("btnStart") + '</button></div>');

  sheet.querySelectorAll(".seg").forEach(seg => {
    seg.addEventListener("click", e => {
      const b = e.target.closest("button");
      if (!b) return;
      seg.querySelectorAll("button").forEach(x => x.classList.remove("on"));
      b.classList.add("on");
      if (seg.id === "pDigits") {
        const eight = +b.dataset.v === 8;
        const note = sheet.querySelector("#digitsNote");
        note.textContent = eight ? DIGITS_NOTE_8() : DIGITS_NOTE_6();
        note.classList.toggle("field-warn", eight);
      }
    });
  });
  const digitsSel = () => +sheet.querySelector("#pDigits .on").dataset.v;
  sheet.querySelector("#pSrcBrowse").addEventListener("click", async () => {
    const paths = await browsePick("dir",
      { title: _t("dlgPackDir"),
        initial: sheet.querySelector("#pSrc").value.trim() });
    if (paths && paths.length) {
      sheet.querySelector("#pSrc").value = paths[0];
      sheet.querySelector("#pSrc").dispatchEvent(new Event("change"));
    }
  });
  sheet.querySelector("#pDstBrowse").addEventListener("click", async () => {
    const cur = sheet.querySelector("#pDst").value.trim();
    const paths = await browsePick("save",
      { title: _t("dlgSaveAs"), filetypes: ASTBOX_FT(), defaultext: ".astbox",
        initial: cur });
    if (paths && paths.length) {
      let p = paths[0];
      if (!/\.astbox$/i.test(p)) p += ".astbox";
      sheet.querySelector("#pDst").value = p;
    }
  });
  sheet.querySelector("#pSrc").addEventListener("change", () => {
    const src = sheet.querySelector("#pSrc").value.trim();
    if (src && !sheet.querySelector("#pDst").value.trim()) {
      sheet.querySelector("#pDst").value =
        src.replace(/[\\/]+$/, "") + ".astbox";
    }
  });
  sheet.querySelector("#pCancel").addEventListener("click", closeSheet);
  sheet.querySelector("#pOk").addEventListener("click", async () => {
    const body = {
      src: sheet.querySelector("#pSrc").value.trim(),
      dst: sheet.querySelector("#pDst").value.trim(),
      digits: digitsSel(),
      b32: sheet.querySelector("#pB32").value.trim(),
      profile: sheet.querySelector("#pProfile .on").dataset.v,
    };
    if (!body.dst) { toast(_t("errSpecify"), "err"); return; }
    if (!body.src && state.phase !== "unlocked") {
      toast(_t("openOrSpecify"), "err");
      return;
    }
    const btn = sheet.querySelector("#pOk");
    btn.disabled = true;
    btn.textContent = _t("packing");
    try {
      const r = await api("/api/pack", body, { silent: true });
      showPackResult(r.pack);
    } catch (err) {
      toast(err.message, "err");
      btn.disabled = false;
      btn.textContent = _t("btnStart");
    }
  });
}

function showPackResult(pack) {
  const qr = state.qr_ok && pack.matrix ? qrSvg(pack.matrix) : "";
  const digitsWarn = pack.digits === 8
    ? '<div class="warnline"><svg class="ic" style="margin-top:2px"><use href="#i-warning"/></svg>' +
      "<span>" + _t("digitsNote8") + "</span></div>"
    : "";
  const sheet = openSheet(
    '<div class="success-ring"><svg viewBox="0 0 16 16">' +
    '<path d="m3 8.6 3.2 3.2L13 4.6" fill="none" stroke="#fff" ' +
    'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>' +
    "</svg></div>" +
    "<h2>" + _t("packComplete") + "</h2>" +
    '<p class="sheet-sub">' + _t("packCompleteSub") + '</p>' +
    (qr ? '<div class="qr-wrap">' + qr + "</div>" : "") +
    '<div class="result-kv"><b>' + _t("file") + '</b><span></span></div>' +
    '<div class="result-kv"><b>VaultID</b><span>' + pack.vault_id + "</span></div>" +
    '<div class="result-kv"><b>Generation</b><span>' + pack.generation + "</span></div>" +
    '<div class="result-kv"><b>' + _t("lblEntries") + '</b><span>' + pack.entries + "</span></div>" +
    '<div class="copy-line"><span></span>' +
    '<button class="btn btn-ghost" id="pCopyKey" style="height:28px">' + _t("lblCopyKey") + '</button></div>' +
    digitsWarn +
    '<div class="warnline"><svg class="ic" style="margin-top:2px"><use href="#i-warning"/></svg>' +
    "<span>" + _t("lblWarn") + "</span></div>" +
    '<div class="sheet-actions"><button class="btn btn-primary" id="pDone">' + _t("btnDone") + '</button></div>');
  sheet.querySelector(".result-kv span").textContent = pack.dst;
  sheet.querySelector(".copy-line span").textContent = pack.b32;
  sheet.querySelector("#pCopyKey").addEventListener("click", () =>
    copyText(pack.b32, _t("tCopied")));
  sheet.querySelector("#pDone").addEventListener("click", closeSheet);
}

function qrSvg(matrix) {
  const n = matrix.length;
  let d = "";
  for (let y = 0; y < n; y++) {
    const row = matrix[y];
    let x = 0;
    while (x < n) {
      if (row[x]) {
        const x0 = x;
        while (x < n && row[x]) x++;
        d += "M" + x0 + " " + y + "h" + (x - x0) + "v1h-" + (x - x0) + "z";
      } else x++;
    }
  }
  return '<svg viewBox="0 0 ' + n + " " + n + '" shape-rendering="crispEdges">' +
         '<path d="' + d + '" fill="#111"/></svg>';
}

/* 添加文件 / 文件夹 */
function openAddSheet(foldersOnly) {
  if (state.phase !== "unlocked") { toast(_t("errUnlock"), "err"); return; }
  const sheet = openSheet(
    "<h2>" + (foldersOnly ? _t("addFolderTitle") : _t("addFilesTitle")) + "</h2>" +
    '<p class="sheet-sub">' + _t("addFilesSub") + (foldersOnly ? _t("recurseNote") : "") + '</p>' +
    '<div class="add-tools">' +
    '<button class="btn btn-glass btn-mini" id="pBrowseFiles">' + _t("browseFiles") + '</button>' +
    '<button class="btn btn-glass btn-mini" id="pBrowseFolders">' + _t("browseFolders") + '</button>' +
    "</div>" +
    fieldRow(_t("pathList"), '<textarea id="pPaths" rows="5" spellcheck="false" ' +
      'placeholder="C:\\path\\a.txt&#10;C:\\path\\folder"></textarea>') +
    '<div class="field-note">' + _t("pathListNote") + '</div>' +
    '<div class="sheet-actions">' +
    '<button class="btn btn-glass" id="pCancel">' + _t("btnCancel") + '</button>' +
    '<button class="btn btn-primary" id="pOk">' + _t("btnAdd") + '</button></div>');
  const ta = sheet.querySelector("#pPaths");
  const appendLines = (paths) => {
    if (!paths || !paths.length) return;
    const cur = ta.value.trim();
    ta.value = (cur ? cur + "\n" : "") + paths.join("\n");
  };
  sheet.querySelector("#pBrowseFiles").addEventListener("click", async () => {
    appendLines(await browsePick("files",
      { title: _t("dlgAddFiles2") }));
  });
  sheet.querySelector("#pBrowseFolders").addEventListener("click", async () => {
    appendLines(await browsePick("dir",
      { title: _t("dlgAddFolder2") }));
  });
  sheet.querySelector("#pCancel").addEventListener("click", closeSheet);
  sheet.querySelector("#pOk").addEventListener("click", async () => {
    const paths = ta.value.split("\n").map(s => s.trim()).filter(Boolean);
    if (!paths.length) { toast(_t("atLeastOnePath"), "err"); return; }
    try {
      const r = await api("/api/add", { paths });
      toast(_fmt(_t("addedFiles"), r.count, state.info.generation), "ok");
      closeSheet();
    } catch { /* ignore */ }
  });
}

/* 生成 .astbox 容器（内置示例内容，自选保存位置） */
async function makeDemo() {
  const home = state.home || "";
  const sheet = openSheet(
    "<h2>" + _t("shGen") + "</h2>" +
    '<p class="sheet-sub">' + _t("shGenSub") + '</p>' +
    fieldRow(_t("lblSave"),
      pathRow("pDst", "C:\\path\\to\\astbox-demo.astbox", "pDstBrowse")) +
    fieldRow(_t("lblDigits"),
      '<div class="seg" id="gDigits"><button data-v="6" class="on">6 ' + _t("digitsShort") + '</button>' +
      '<button data-v="8">8 ' + _t("digitsShort") + '</button></div>' +
      '<div class="field-note" id="gDigitsNote">' + DIGITS_NOTE_6() + "</div>") +
    fieldRow(_t("lblKdf"),
      '<div class="seg" id="gProfile"><button data-v="high" class="on">' + _t("lblKdfHigh") + '</button>' +
      '<button data-v="constrained">' + _t("lblKdfLow") + '</button></div>') +
    '<div class="sheet-actions">' +
    '<button class="btn btn-glass" id="pCancel">' + _t("btnCancel") + '</button>' +
    '<button class="btn btn-primary" id="pOk">' + _t("btnGen") + '</button></div>');
  sheet.querySelector("#gDigits").addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    sheet.querySelectorAll("#gDigits button").forEach(x => x.classList.remove("on"));
    b.classList.add("on");
    const note = sheet.querySelector("#gDigitsNote");
    note.textContent = +b.dataset.v === 8 ? DIGITS_NOTE_8() : DIGITS_NOTE_6();
    note.classList.toggle("field-warn", +b.dataset.v === 8);
  });
  sheet.querySelector("#gProfile").addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    sheet.querySelectorAll("#gProfile button").forEach(x => x.classList.remove("on"));
    b.classList.add("on");
  });
  sheet.querySelector("#pDst").value =
    (home ? home + "\\Desktop\\" : "") + "astbox-demo.astbox";
  sheet.querySelector("#pDstBrowse").addEventListener("click", async () => {
    const paths = await browsePick("save",
      { title: _t("shGen") + " - " + _t("lblSave"), filetypes: ASTBOX_FT,
        defaultext: ".astbox",
        initial: sheet.querySelector("#pDst").value.trim() });
    if (paths && paths.length) {
      let p = paths[0];
      if (!/\.astbox$/i.test(p)) p += ".astbox";
      sheet.querySelector("#pDst").value = p;
    }
  });
  sheet.querySelector("#pCancel").addEventListener("click", closeSheet);
  const go = async () => {
    const dst = sheet.querySelector("#pDst").value.trim();
    if (!dst) { toast(_t("specifySave"), "err"); return; }
    const btn = sheet.querySelector("#pOk");
    btn.disabled = true;
    btn.textContent = _t("generating");
    try {
      const r = await api("/api/demo", {
        dst,
        digits: +sheet.querySelector("#gDigits .on").dataset.v,
        profile: sheet.querySelector("#gProfile .on").dataset.v,
      }, { silent: true });
      showGenerateResult(r.demo);
    } catch (err) {
      toast(err.message, "err");
      btn.disabled = false;
      btn.textContent = _t("generateShort");
    }
  };
  sheet.querySelector("#pOk").addEventListener("click", go);
  sheet.querySelector("#pDst").addEventListener("keydown", e => {
    if (e.key === "Enter") go();
    e.stopPropagation();
  });
}

function showGenerateResult(d) {
  const qr = state.qr_ok && d.matrix ? qrSvg(d.matrix) : "";
  const digitsWarn = d.digits === 8
    ? '<div class="warnline"><svg class="ic" style="margin-top:2px"><use href="#i-warning"/></svg>' +
      "<span>" + _t("digitsNote8") + "</span></div>"
    : "";
  const sheet = openSheet(
    '<div class="success-ring"><svg viewBox="0 0 16 16">' +
    '<path d="m3 8.6 3.2 3.2L13 4.6" fill="none" stroke="#fff" ' +
    'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>' +
    "</svg></div>" +
    "<h2>" + _t("genCreated") + "</h2>" +
    '<p class="sheet-sub">' + _t("genCreatedSub") + '</p>' +
    (qr ? '<div class="qr-wrap">' + qr + "</div>" : "") +
    '<div class="result-kv"><b>' + _t("file") + '</b><span></span></div>' +
    '<div class="copy-line"><span></span>' +
    '<button class="btn btn-ghost" id="dCopy" style="height:28px">' + _t("lblCopyKey") + '</button></div>' +
    digitsWarn +
    '<div class="warnline"><svg class="ic" style="margin-top:2px"><use href="#i-warning"/></svg>' +
    "<span>" + _t("lblWarn") + "</span></div>" +
    '<div class="sheet-actions">' +
    '<button class="btn btn-primary" id="pDone">' + _t("btnUnlock") + '</button></div>');
  sheet.querySelector(".result-kv span").textContent = d.dst;
  sheet.querySelector(".copy-line span").textContent = d.b32;
  sheet.querySelector("#dCopy").addEventListener("click", () =>
    copyText(d.b32, _t("tCopied")));
  sheet.querySelector("#pDone").addEventListener("click", () => {
    closeSheet();
    setTimeout(otpFocus, 260);
  });
}

/* 验证 / 自检 / 关于 */
async function doVerify() {
  try {
    const r = await api("/api/verify", {});
    toast(r.message || _t("shVerify"), "ok");
  } catch { /* ignore */ }
}

async function doSelftest() {
  try {
    const r = await api("/api/selftest");
    const sheet = openSheet(
      "<h2>" + _t("shSelftest") + "</h2>" +
      '<p class="sheet-sub">' + _t("selftestBody") + '</p>' +
      r.lines.map(() =>
        '<div class="result-kv"><svg class="ic" style="color:var(--green);flex:none">' +
        '<use href="#i-check"/></svg><span style="font-family:var(--font-ui)"></span></div>')
        .join("") +
      '<div class="sheet-actions"><button class="btn btn-primary" id="pDone">' + _t("btnOk") + '</button></div>');
    sheet.querySelectorAll(".result-kv span")
      .forEach((spn, i) => { spn.textContent = r.lines[i] || ""; });
    sheet.querySelector("#pDone").addEventListener("click", closeSheet);
    toast(_t("selftestPass"), "ok");
  } catch { /* ignore */ }
}

function showAbout() {
  const sheet = openSheet(
    '<div class="success-ring" style="background:linear-gradient(180deg,#3d93ff,#065fe4)">' +
    '<svg viewBox="0 0 64 64"><rect x="10" y="20" width="44" height="32" rx="9" fill="#fff" opacity=".95"/>' +
    '<path d="M18 22 L26 10 h12 l8 12 z" fill="#fff" opacity=".7"/></svg></div>' +
    "<h2>" + _t("shAbout") + "</h2>" +
    '<p class="sheet-sub" style="text-align:center"><b>V3.1.4</b><br>' +
    _t("aboutBody") + '</p>' +
    '<div class="sheet-actions"><button class="btn btn-primary" id="pDone">' + _t("btnOk") + '</button></div>');
  sheet.querySelector("#pDone").addEventListener("click", closeSheet);
}

async function doLock() {
  try { await api("/api/lock", {}); } catch { /* ignore */ }
}

/* ---------------- Toast / 剪贴板 ---------------- */
function toast(msg, type = "") {
  const t = el("div", "toast " + type);
  const icon = type === "err" ? "i-warning" : type === "ok" ? "i-check" : "i-box-open";
  t.innerHTML = '<svg class="ic"><use href="#' + icon + '"/></svg><span></span>';
  t.querySelector("span").textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => {
    t.classList.add("leaving");
    setTimeout(() => t.remove(), 260);
  }, 3400);
}

function copyText(text, okMsg) {
  navigator.clipboard.writeText(text)
    .then(() => toast(okMsg || _t("copied"), "ok"))
    .catch(() => {
      const ta = el("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      toast(okMsg || _t("copied"), "ok");
    });
}

/* ---------------- 主题 ---------------- */
function applyTheme() {
  document.documentElement.dataset.theme = themeMode;
  const dark = themeMode === "dark" ||
    (themeMode === "auto" &&
     matchMedia("(prefers-color-scheme: dark)").matches);
  $("#themeIcon").firstElementChild
    .setAttribute("href", dark ? "#i-sun" : "#i-moon");
  $("#btnTheme").title =
    _fmt(_t("themeToggle"),
      { auto: _t("themeAuto"), light: _t("themeLight"), dark: _t("themeDark") }[themeMode]);
}

/* ---------------- 窗口红绿灯（Mac 业务逻辑映射） ---------------- */
let quitting = false;
async function doQuitApp() {
  if (quitting) return;
  quitting = true;
  try { await api("/api/shutdown", {}, { silent: true }); } catch { /* ignore */ }
  // 留 350ms 给服务端应答，然后关窗口
  setTimeout(() => {
    window.close();
    setTimeout(showQuitVeil, 500);
  }, 350);
}

function showQuitVeil() {
  if (document.querySelector(".quit-veil")) return;
  document.body.appendChild(el("div", "quit-veil",
    "<strong>" + _t("quitTitle") + "</strong>" +
    "<span>" + _t("quitSub") + "</span>"));
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    document.documentElement.requestFullscreen().catch(() => {});
  }
}

/* ---------------- 刷新 ---------------- */
async function refreshState() {
  try { await api("/api/state"); } catch { /* ignore */ }
}

/* ---------------- 事件绑定 ---------------- */
function bind() {
  $("#tlClose").addEventListener("click", doQuitApp);
  $("#tlZoom").addEventListener("click", toggleFullscreen);
  $("#btnBack").addEventListener("click", () => api("/api/back", {}));
  $("#btnFwd").addEventListener("click", () => api("/api/forward", {}));
  $("#btnUp").addEventListener("click", () => api("/api/up", {}));
  /* 语言下拉菜单: 按钮下方弹出, 各项以自身语言显示;
   当前项 ✓ 标记 —— 再次点击仅关闭菜单(不重选) */
function openLangMenu() {
  const b = $("#btnLang");
  const r = b.getBoundingClientRect();
  openMenu(_LANGS.map(l => ({
    label: (l === _lang ? "✓ " : "") + _LANG_MENU[l],
    action: () => { if (l === _lang) { closeMenu(); return; } _setLang(l); },
  })), r.left, r.bottom + 6);
}
$("#btnLang").addEventListener("click", () => {
  if (menuEl) { closeMenu(); return; }   // 菜单已开 -> 按钮即关闭开关
  openLangMenu();
});

  $("#btnOpen").addEventListener("click", (e) => openChoose(e.clientX, e.clientY));
  $("#btnPack").addEventListener("click", openPackSheet);
  $("#btnAdd").addEventListener("click", () => openAddSheet(false));
  $("#btnExtractSel").addEventListener("click", () => {
    if (!selection.size) { toast(_t("errNoSel"), "err"); return; }
    extractFiles([...selection].filter(id => {
      const it = state.items.find(x => x.id === id);
      return it && !it.is_dir;
    }));
  });
  $("#btnVerify").addEventListener("click", doVerify);
  $("#btnMore").addEventListener("click", (e) =>
    openMoreMenu(e.clientX, e.clientY));
  $("#btnTheme").addEventListener("click", () => {
    themeMode = { auto: "light", light: "dark", dark: "auto" }[themeMode];
    localStorage.setItem("astbox-theme", themeMode);
    applyTheme();
  });
  $("#btnUnlockTop").addEventListener("click", () => {
    $("#unlockCard").scrollIntoView({ block: "nearest", behavior: "smooth" });
    otpFocus();
  });

  $("#btnUnlockSide").addEventListener("click", doUnlock);
  $("#btnLock").addEventListener("click", doLock);
  $("#btnCalcTotp").addEventListener("click", async () => {
    if (state.phase !== "locked") return;
    const b32 = prompt(_t("b32Prompt"));
    if (!b32) return;
    try {
      const r = await api("/api/totp", { b32: b32.trim(), digits: otpDigits });
      if (otpDigits > 6) {
        const box = $("#otpBoxes input");
        box.value = r.code;
        box.dispatchEvent(new Event("input"));
      } else {
        const boxes = $("#otpBoxes").children;
        [...r.code].forEach((ch, i) => {
          if (boxes[i]) { boxes[i].value = ch; boxes[i].classList.add("filled"); }
        });
      }
      toast(_fmt(_t("totpComputed"), otpDigits, r.code));
      maybeAutoUnlock();
    } catch { /* ignore */ }
  });

  $("#opOpen").addEventListener("click", () => openChoose());
  $("#opPack").addEventListener("click", openPackSheet);
  $("#opDemo").addEventListener("click", makeDemo);
  $("#opAddFiles").addEventListener("click", () => openAddSheet(false));
  $("#opAddFolder").addEventListener("click", () => openAddSheet(true));
  $("#opExtractAll").addEventListener("click", () => extractFiles(null));
  $("#opVerify").addEventListener("click", doVerify);
  $("#opSelftest").addEventListener("click", doSelftest);
  $("#qRoot").addEventListener("click", () => nav({ dir: "root" }));

  let outTimer = null;
  $("#outDir").addEventListener("change", () => {
    clearTimeout(outTimer);
    outTimer = setTimeout(() =>
      api("/api/outdir", { path: $("#outDir").value.trim() }, { silent: true })
        .catch(() => {}), 250);
  });
  $("#outBrowse").addEventListener("click", async () => {
    const paths = await browsePick("dir",
      { title: _t("dlgPickOutDir"), initial: $("#outDir").value.trim() });
    if (paths && paths.length) {
      $("#outDir").value = paths[0];
      $("#outDir").dispatchEvent(new Event("change"));
    }
  });

  $("#heroOpen").addEventListener("click", () => $("#filePick").click());
  $("#heroDemo").addEventListener("click", makeDemo);

  $("#listHead").addEventListener("click", (e) => {
    const h = e.target.closest(".sortable");
    if (!h) return;
    const key = h.dataset.sort;
    if (sortKey === key) sortDir *= -1;
    else { sortKey = key; sortDir = 1; }
    renderRows();
  });

  $("#filePick").addEventListener("change", async () => {
    const f = $("#filePick").files[0];
    $("#filePick").value = "";
    if (!f) return;
    if (f.size > MAX_UPLOAD) {
      toast(_t("errFileSize"), "err");
      return;
    }
    try {
      await api("/api/open_upload", f, {
        headers: { "X-Filename": encodeURIComponent(f.name) },
      });
      toast(_t("parsedUnlock"));
    } catch { /* ignore */ }
  });

  /* 全局键盘 */
  document.addEventListener("keydown", (e) => {
    const inField = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (e.key === "Escape") { closeMenu(); closeSheet(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
      e.preventDefault();
      openChoose();
      return;
    }
    if (e.key === "F5") { e.preventDefault(); refreshState(); return; }
    if (inField) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const items = sortedItems();
      if (!items.length) return;
      const ids = items.map(x => x.id);
      let idx = selection.size ? ids.indexOf([...selection].pop()) : -1;
      idx = e.key === "ArrowDown" ? Math.min(idx + 1, ids.length - 1)
                                  : Math.max(idx - 1, 0);
      selection.clear();
      selection.add(ids[idx]);
      paintSelection();
      const row = document.querySelector('.row[data-id="' + ids[idx] + '"]');
      if (row) row.scrollIntoView({ block: "nearest" });
    }
    if (e.key === "Enter" && selection.size) {
      const item = state.items.find(i => i.id === [...selection][0]);
      if (item) item.is_dir ? nav({ dir: item.id }) : extractFiles([item.id]);
    }
  });

  /* 点击空白关闭菜单 */
  document.addEventListener("pointerdown", (e) => {
    if (menuEl && !menuEl.contains(e.target) &&
        !e.target.closest("#btnMore,#btnLang")) closeMenu();
  });
  $("#scrim").addEventListener("pointerdown", (e) => {
    if (e.target === $("#scrim") && sheetDismissable) closeSheet();
  });

  /* 拖放打开 */
  let dragDepth = 0;
  document.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragDepth++;
    $("#dropVeil").hidden = false;
  });
  document.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) $("#dropVeil").hidden = true;
  });
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", async (e) => {
    e.preventDefault();
    dragDepth = 0;
    $("#dropVeil").hidden = true;
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    if (f.size > MAX_UPLOAD) {
      toast(_t("errFileSize"), "err");
      return;
    }
    try {
      await api("/api/open_upload", f, {
        headers: { "X-Filename": encodeURIComponent(f.name) },
      });
      toast(_t("parsedUnlock"));
    } catch { /* ignore */ }
  });

  /* 系统主题变化时刷新 auto 模式图标 */
  matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", applyTheme);
}

/* ---------------- 应用窗口锁定（便携 Chromium / --app 通道） ---------------- */
function applyKioskLockdown() {
  if (new URLSearchParams(location.search).get("ui") !== "app") return;
  // 屏蔽右键菜单（列表行上的自定义菜单由其自身监听器处理，不受影响）
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  // 屏蔽 F12 与 DevTools 快捷键（capture 阶段优先拦截）
  window.addEventListener("keydown", (e) => {
    if (e.key === "F12") { e.preventDefault(); e.stopPropagation(); return; }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey
        && ["I", "J", "C", "i", "j", "c"].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
}

/* ---------------- 启动 ---------------- */
applyTheme();
applyKioskLockdown();
bind();
refreshState();
