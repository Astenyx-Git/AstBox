// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: Apache-2.0
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
  document.title = _lang === "en"
    ? "ASTBOX Container Manager · V3.0.0" : "ASTBOX 容器管理器 · V3.0.0";
}

/* 动态已渲染片段刷新（语言切换时） */
function _refreshI18n() {
  _applyStatic();
  const hintEl = document.querySelector(".addr-hint");
  if (hintEl) hintEl.textContent = _t("addrEdit");
  if (typeof applyTheme === "function") applyTheme();   // 同步 btnTheme tooltip
  if (typeof renderAll === "function") renderAll();
}

/* 语言切换入口 */
function _switchLang() {
  _lang = (_lang === "zh") ? "en" : "zh";
  localStorage.setItem(_LANG_KEY, _lang);
  document.documentElement.lang = _lang;
  _refreshI18n();
}

/* 启动：脚本位于 body 尾部，DOM 已就绪，直接执行 */
if (localStorage.getItem(_LANG_KEY) === "en") _lang = "en";
document.documentElement.lang = _lang;
_applyStatic();

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
      throw new Error((data && data.error) || (_t("errReq").replace("(%d)", " (" + res.status + ")")));
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
    '<p class="sheet-sub" style="text-align:center"><b>V3.0.0</b><br>' +
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
  $("#btnLang").addEventListener("click", () => { _switchLang(); });

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
        !e.target.closest("#btnMore")) closeMenu();
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
