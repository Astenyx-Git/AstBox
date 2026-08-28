# Astbox Rust + TS(中文 / English / 日本語)

![License](https://img.shields.io/badge/License-MPL--2.0%20OR%20AGPL--3.0--only-blue)

Repository: Astenyx-Git/AstBox(branch `rust`)
License: MPL-2.0 OR AGPL-3.0-only(双重许可:一般使用/再分发依 MPL-2.0;云厂商、SaaS 提供商等网络服务形态的主体强制适用 AGPL-3.0-only 第 13 条 —— 详见 LICENSE)

## 许可(License / ライセンス)
- **一般使用**:MPL-2.0 —— 个人与组织可使用、修改、再分发(文件级弱著佐权)。
- **网络服务强制**:云厂商、SaaS 提供商、托管平台等以网络服务形态向第三方提供本软件或其修改版的主体,自动落入 **AGPL-3.0-only**(第 13 条:向交互用户公开修改版完整对应源码);此情形下 MPL 授予不适用。
- 全文:`LICENSE`(条款划分)、`LICENSE-MPL-2.0` / `LICENSE-AGPL-3.0`(逐字官方文本)、`NOTICE`(第三方组件)。安装器展示并随包分发同一套条款(独立 EULA:`installer/EULA.rtf`)。

### License (English)
- **General use**: MPL-2.0 — use, modify and redistribute freely (file-level weak copyleft).
- **Network services**: cloud vendors, SaaS providers and hosting platforms offering the software (or a modified version) as a network service fall under **AGPL-3.0-only** §13 (must make the complete corresponding source of the modified version available to interacting users); the MPL grant does not apply in that case.
- Texts: `LICENSE` (structure), `LICENSE-MPL-2.0` / `LICENSE-AGPL-3.0` (verbatim), `NOTICE` (third-party). The installer displays and ships the same terms as a standalone EULA (`installer/EULA.rtf`).

### ライセンス(日本語)
- **一般利用**: MPL-2.0 — 利用・改変・再配布可(ファイル単位の弱コピーレフト)。
- **ネットワークサービス**: クラウドベンダー・SaaS 提供事業者・ホスティングプラットフォームなど、本ソフトウェア(または改変版)をネットワークサービスとして第三者に提供する主体には **AGPL-3.0-only** §13 が適用(交互ユーザーへの完全な対応ソース提供義務)。この場合 MPL の許諾は適用されません。
- 本文: `LICENSE`(構造)、`LICENSE-MPL-2.0` / `LICENSE-AGPL-3.0`(逐字)、`NOTICE`(サードパーティ)。インストーラは同一条件の EULA(`installer/EULA.rtf`)を表示・同梱します。

## 中文

### 简介
AstBox 的 Rust + TypeScript 移植版:与 ASTBOX v1.0 规范及 C# 线产物**字节兼容**(封包 / 解包 / 修改 / 传播包四路径,以 C# 服务器 oracle 熵回放逐字节比对验证)。包含核心库 `astbox-core`、无窗口 CLI、**Tauri v2 桌面壳 + 三语 TS 前端**(zh / en / ja)、Windows 双通道 NSIS 安装器,以及密钥库(`ASTBOX1\0` + DPAPI)的跨版本零成本接管。

### 快速开始
```bash
git clone https://github.com/Astenyx-Git/AstBox.git
cd AstBox
git checkout rust
```
```powershell
# 依赖:Rust stable、Node 20+;首次构建 cargo 会自动拉取依赖
npm install
cargo test --manifest-path rust/Cargo.toml        # 原生测试(25)+ oracle 字节兼容(3)
node scripts/extract-i18n.mjs                     # i18n 字典逐字提取(gui/app.js → TS)
node scripts/build-frontend.mjs                   # esbuild 打包 → dist-web
cargo build --manifest-path rust/Cargo.toml -p astbox-gui   # 桌面壳调试版
```
```powershell
rust\target\debug\astbox-gui.exe          # 桌面壳(启动即写关联契约 + 自愈)
rust\target\release\astbox-cli.exe --help # CLI(info / unlock / extract / create / add / verify / selftest)
```
安装后双击 `.astbox` 直接打开容器;双击 `.passbox` 导入传播包(密钥免重录)。

### 构建安装器
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File installer\build_rs.ps1            # 默认包 + offline 包
powershell -NoProfile -ExecutionPolicy Bypass -File installer\build_rs.ps1 -SkipOffline  # 仅默认包
```
版本取自 `installer/VERSION`(唯一版本源,自动注入 `tauri.conf.json`);产物写入 `installer/dist/` 并生成 `manifest.json`(channels:`nsis` / `offline`)。可选 Authenticode 签名:设置 `ASTBOX_SIGN_PFX`、`ASTBOX_SIGN_PW`(及 `ASTBOX_SIGN_TS`)。首装时应用首跑静默迁移检测到的旧版(S2 无缝迁移:密钥库保留、关联自动切换、悬空自愈)。

### 备注
- **WebView2 兜底**:默认包为 `embedBootstrapper`(在线引导,体积小);断网 / LTSC 场景用 offline 包(`offlineInstaller`,内嵌 WebView2 Standalone)。
- **关联治理**(spec §5):RegisteredApplications 值名恒为 ASCII `"ASTBOX"`;悬空 UserChoice 启动自愈;被接管时每版本一次确权弹窗 + 深链。图标双轨:应用本体 `app.ico`,文件关联 `astbox.ico` / `passbox.ico`。
- **SAC / SmartScreen**:新构建哈希首次运行可能被拦("应用程序控制策略 4551"),按「新哈希-等待-重试」纪律处理;正式分发以签名解决。
- 本分支与 `C#` 分支独立演进(双轨惯例,应急回退),互不合并;规范 §4.6 按实现行登记。

---

## English

### Overview
The Rust + TypeScript port of AstBox: **byte-compatible** with the ASTBOX v1.0 specification and the C# line (pack / unpack / modify / passbox flows verified by C#-oracle entropy replay, compared byte-for-byte). Includes the `astbox-core` library, a windowless CLI, a **Tauri v2 desktop shell + trilingual TS frontend** (zh / en / ja), a dual-channel NSIS installer for Windows, and cross-version zero-cost takeover of the secrets store (`ASTBOX1\0` + DPAPI).

### Quick start
```bash
git clone https://github.com/Astenyx-Git/AstBox.git
cd AstBox
git checkout rust
```
```powershell
# Prerequisites: Rust stable, Node 20+; cargo fetches dependencies on first build
npm install
cargo test --manifest-path rust/Cargo.toml        # native tests (25) + oracle byte-compat (3)
node scripts/extract-i18n.mjs                     # verbatim i18n extraction (gui/app.js -> TS)
node scripts/build-frontend.mjs                   # esbuild bundle -> dist-web
cargo build --manifest-path rust/Cargo.toml -p astbox-gui   # desktop shell (debug)
```
```powershell
rust\target\debug\astbox-gui.exe          # desktop shell (writes the association contract + self-heals at startup)
rust\target\release\astbox-cli.exe --help # CLI (info / unlock / extract / create / add / verify / selftest)
```
Once installed, double-clicking `.astbox` opens the container; double-clicking `.passbox` imports a propagation package (no re-enrollment).

### Build installer
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File installer\build_rs.ps1            # default + offline packages
powershell -NoProfile -ExecutionPolicy Bypass -File installer\build_rs.ps1 -SkipOffline  # default only
```
The version comes from `installer/VERSION` (the single version source, injected into `tauri.conf.json`); artifacts land in `installer/dist/` with a `manifest.json` (channels: `nsis` / `offline`). Optional Authenticode signing: set `ASTBOX_SIGN_PFX`, `ASTBOX_SIGN_PW` (and `ASTBOX_SIGN_TS`). On first run the app silently migrates a detected legacy install (seamless S2: secrets kept, associations follow, dangling keys self-heal).

### Notes
- **WebView2 fallback**: the default package uses `embedBootstrapper` (online bootstrapper, small); for offline / LTSC use the offline package (`offlineInstaller`, WebView2 Standalone embedded).
- **Association governance** (spec §5): the RegisteredApplications value name is always the ASCII string `"ASTBOX"`; dangling UserChoice keys self-heal at startup; foreign take-overs trigger a once-per-epoch confirmation prompt with a deep link. Dual icon track: `app.ico` for the app itself, `astbox.ico` / `passbox.ico` for file associations only.
- **SAC / SmartScreen**: a freshly built hash may be blocked on first run ("Application Control policy", error 4551) — follow the new-hash / wait / retry discipline; signed artifacts are the distribution remedy.
- This branch evolves independently from the `C#` branch (dual-track convention for emergency rollback); no cross-merges. Implementation lines are registered per line in spec §4.6.

---

## 日本語

### 概要
AstBox の Rust + TypeScript 移植版:ASTBOX v1.0 仕様および C# 線の成果物と**バイト互換**(パック / アンパック / 変更 / 伝播パッケージの四経路を C# サーバー oracle によるエントロピー再生で逐バイト検証)。`astbox-core` ライブラリ、ウィンドウなし CLI、**Tauri v2 デスクトップシェル + 三言語 TS フロントエンド**(zh / en / ja)、Windows 向け NSIS 二チャンネルインストーラ、シークレットストア(`ASTBOX1\0` + DPAPI)のバージョン横断ゼロコスト引き継ぎを含みます。

### クイックスタート
```bash
git clone https://github.com/Astenyx-Git/AstBox.git
cd AstBox
git checkout rust
```
```powershell
# 前提:Rust stable、Node 20+;初回ビルド時に cargo が依存を取得します
npm install
cargo test --manifest-path rust/Cargo.toml        # ネイティブテスト(25)+ oracle バイト互換(3)
node scripts/extract-i18n.mjs                     # i18n 辞書の逐字抽出(gui/app.js -> TS)
node scripts/build-frontend.mjs                   # esbuild バンドル -> dist-web
cargo build --manifest-path rust/Cargo.toml -p astbox-gui   # デスクトップシェル(デバッグ)
```
```powershell
rust\target\debug\astbox-gui.exe          # デスクトップシェル(起動時に関連付け契約を書き込み自己修復)
rust\target\release\astbox-cli.exe --help # CLI(info / unlock / extract / create / add / verify / selftest)
```
インストール後、`.astbox` をダブルクリックするとコンテナが開き、`.passbox` をダブルクリックすると伝播パッケージを取り込みます(再登録不要)。

### インストーラ作成
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File installer\build_rs.ps1            # 既定 + offline パッケージ
powershell -NoProfile -ExecutionPolicy Bypass -File installer\build_rs.ps1 -SkipOffline  # 既定のみ
```
バージョンは `installer/VERSION`(唯一のバージョンソース、`tauri.conf.json` へ自動注入)。成果物は `installer/dist/` に `manifest.json`(channels: `nsis` / `offline`)と共に生成されます。オプションの Authenticode 署名:`ASTBOX_SIGN_PFX`、`ASTBOX_SIGN_PW`(および `ASTBOX_SIGN_TS`)を設定。初回起動時に旧版を検出するとサイレント移行します(S2 シームレス移行:シークレット保持、関連付けは自動切替、 dangling キーは自己修復)。

### 備考
- **WebView2 フォールバック**:既定パッケージは `embedBootstrapper`(オンラインブートストラッパー、小型)。オフライン / LTSC 向けには offline パッケージ(`offlineInstaller`、WebView2 Standalone 内蔵)を使用します。
- **関連付けガバナンス**(仕様 §5):RegisteredApplications の値名は常に ASCII `"ASTBOX"`。dangling な UserChoice は起動時に自己修復、他プログラムの引き継ぎにはエポックごと 1 回の確認ダイアログとディープリンク。アイコン二役分割:アプリ本体は `app.ico`、ファイル関連付けは `astbox.ico` / `passbox.ico` のみ。
- **SAC / SmartScreen**:新規ビルドのハッシュが初回実行時にブロックされることがあります(「アプリケーション制御ポリシー」エラー 4551)—— 新ハッシュ・待機・再試行の規律に従い、正式配布は署名で解決します。
- 本ブランチは `C#` ブランチと独立して進化します(双系統運用、緊急時のロールバック用)。実装行は仕様 §4.6 に行ごとに登録されます。
