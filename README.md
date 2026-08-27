# Astbox C# (中文 / English / 日本語)

Repository: Astenyx-Git/AstBox (branch `C#`)  
License: Apache License 2.0

## 中文

### 简介
AstBox 的 C#/.NET 10(NativeAOT)重写版:与 ASTBOX v1.0 规范及早期 Python 版产物**字节兼容**,移除了 Python 运行时。包含核心库、单文件 AOT 命令行、无窗口本地服务(托管**三语 Web GUI**:工具栏按钮显示当前语言代码,点击下拉切换 zh / en / ja)、原生自测试套件与 Windows 安装包构建器。

### 快速开始
```bash
git clone https://github.com/Astenyx-Git/AstBox.git
cd AstBox
git checkout C#
dotnet publish src/Astbox.Cli/Astbox.Cli.csproj -c Release -r win-x64 -o .cli-publish
dotnet publish src/Astbox.Server/Astbox.Server.csproj -c Release -r win-x64 -o .server-publish
dotnet publish src/Astbox.TestsRunner/Astbox.TestsRunner.csproj -c Release -r win-x64 -o .tests-publish
```
```powershell
.tests-publish\astbox-tests.exe           # 原生自测试套件
.server-publish\astbox-server.exe         # 默认端口 11920,自动打开浏览器(--port N --no-browser 可指定)
.cli-publish\astbox-cli.exe --help        # CLI 帮助(info / unlock / extract / create / add / verify / selftest)
```
安装后双击 `.astbox` 直接打开容器;双击 `.passbox` 导入传播包。

### 构建安装器
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File installer\build_cs.ps1          # 精简版 + Chromium 内核版
powershell -NoProfile -ExecutionPolicy Bypass -File installer\build_cs.ps1 -Msi     # 追加 Chromium 内核版 MSI
```
依赖 Inno Setup(ISCC);MSI 通道需 WiX(`dotnet tool install -g wix --version 6.0.2`)。版本取自 `installer/VERSION`(自动追加 `C#` 后缀),产物写入 `installer/dist/` 并生成 `manifest.json`。可选 Authenticode 签名:设置 `ASTBOX_SIGN_PFX`、`ASTBOX_SIGN_PW`(及 `ASTBOX_SIGN_TS`)。MSI 首次安装会静默卸载检测到的旧 Inno 版(S2 无缝迁移,关联自动切换)。

### 备注
- 构建链零 Python:安装器入口为 `installer/build_cs.ps1`,历史脚本归档于 `scripts/legacy/`。
- 本分支与 `main`(Python 参考实现)独立演进,互不合并。

---

## English

### Overview
The C#/.NET 10 (NativeAOT) rewrite of AstBox: **byte-compatible** with the ASTBOX v1.0 specification and the earlier Python artifacts, with the Python runtime removed. Includes the core library, a single-file AOT CLI, a windowless local service hosting a **trilingual web GUI** (toolbar button shows the current language code; click to pick zh / en / ja), a native self-test suite, and a Windows installer builder.

### Quick start
```bash
git clone https://github.com/Astenyx-Git/AstBox.git
cd AstBox
git checkout C#
dotnet publish src/Astbox.Cli/Astbox.Cli.csproj -c Release -r win-x64 -o .cli-publish
dotnet publish src/Astbox.Server/Astbox.Server.csproj -c Release -r win-x64 -o .server-publish
dotnet publish src/Astbox.TestsRunner/Astbox.TestsRunner.csproj -c Release -r win-x64 -o .tests-publish
```
```powershell
.tests-publish\astbox-tests.exe           # native self-test suite
.server-publish\astbox-server.exe         # default port 11920, opens the browser (--port N --no-browser to override)
.cli-publish\astbox-cli.exe --help        # CLI help (info / unlock / extract / create / add / verify / selftest)
```
Once installed, double-clicking `.astbox` opens the container; double-clicking `.passbox` imports a propagation package.

### Build installer
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File installer\build_cs.ps1          # Slim + Chromium channels
powershell -NoProfile -ExecutionPolicy Bypass -File installer\build_cs.ps1 -Msi     # additionally the Chromium MSI
```
Requires Inno Setup (ISCC); the MSI channel needs WiX (`dotnet tool install -g wix --version 6.0.2`). The version comes from `installer/VERSION` (a `C#` suffix is appended); artifacts land in `installer/dist/` with a `manifest.json`. Optional Authenticode signing: set `ASTBOX_SIGN_PFX`, `ASTBOX_SIGN_PW` (and `ASTBOX_SIGN_TS`). On first setup the MSI silently uninstalls a detected legacy Inno install (seamless S2 migration; file associations follow automatically).

### Notes
- The build chain is Python-free: the installer entry point is `installer/build_cs.ps1`; historical scripts are archived under `scripts/legacy/`.
- This branch evolves independently from `main` (the Python reference); no cross-merges.

---

## 日本語

### 概要
AstBox の C#/.NET 10(NativeAOT)による書き直し:ASTBOX v1.0 仕様および旧 Python 実装の成果物と**バイト互換**を保ち、Python ランタイムを廃しています。コアライブラリ、単一ファイル AOT の CLI、**三言語 Web GUI**(ツールバーのボタンに現在の言語コードを表示、クリックで zh / en / ja を選択)をホストするウィンドウなしローカルサービス、ネイティブ自己テストスイート、Windows インストーラ作成ツールを含みます。

### クイックスタート
```bash
git clone https://github.com/Astenyx-Git/AstBox.git
cd AstBox
git checkout C#
dotnet publish src/Astbox.Cli/Astbox.Cli.csproj -c Release -r win-x64 -o .cli-publish
dotnet publish src/Astbox.Server/Astbox.Server.csproj -c Release -r win-x64 -o .server-publish
dotnet publish src/Astbox.TestsRunner/Astbox.TestsRunner.csproj -c Release -r win-x64 -o .tests-publish
```
```powershell
.tests-publish\astbox-tests.exe           # ネイティブ自己テストスイート
.server-publish\astbox-server.exe         # 既定ポート 11920、ブラウザを自動起動(--port N --no-browser で変更可)
.cli-publish\astbox-cli.exe --help        # CLI ヘルプ(info / unlock / extract / create / add / verify / selftest)
```
インストール後、`.astbox` のダブルクリックでコンテナを開き、`.passbox` のダブルクリックで伝播パッケージを取り込みます。

### インストーラのビルド
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File installer\build_cs.ps1          # Slim 版 + Chromium 同梱版
powershell -NoProfile -ExecutionPolicy Bypass -File installer\build_cs.ps1 -Msi     # 加えて Chromium 同梱 MSI
```
Inno Setup(ISCC)が必要です。MSI チャネルには WiX(`dotnet tool install -g wix --version 6.0.2`)も必要です。バージョンは `installer/VERSION` から取得し(`C#` 接尾辞を自動付与)、成果物は `installer/dist/` に `manifest.json` とともに出力されます。オプションの Authenticode 署名:`ASTBOX_SIGN_PFX`、`ASTBOX_SIGN_PW`(および `ASTBOX_SIGN_TS`)を設定します。MSI は初回セットアップ時に旧 Inno 版を検出すると**サイレントでアンインストール**します(S2 シームレス移行、関連付けも自動切替)。

### 備考
- ビルドチェーンに Python は不要:インストーラの入口は `installer/build_cs.ps1`。過去のスクリプトは `scripts/legacy/` に保管。
- 本ブランチは `main`(Python リファレンス)とは独立して進化し、相互マージは行いません。

---
