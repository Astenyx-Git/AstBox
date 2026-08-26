# Astbox C# (中文 / English / 日本語)

Repository: Astenyx-Git/AstBox (branch `C#`)  
License: Apache License 2.0

## 中文

### 项目简介
本分支是 AstBox 的 C#/.NET 10(NativeAOT)重写版:与 ASTBOX v1.0 规范及早期 Python 版产物**字节兼容**,移除了 Python 运行时。仓库包含四个 .NET 工程、原样复用的静态 GUI、Windows 安装包构建器,以及根目录的格式与安全规范文档 `ASTBOX-v1.0-*.txt`。

### 功能
- `src/Astbox.Core`:核心库,模块与旧版一一对应 —— `Constants` / `Errors` / `CborDet` / `Crypto` / `Container` / `Creator` / `Modifier` / `Extractor` / `PassboxFile` / `QrUtil` / `BinWriter`。
- `src/Astbox.Cli`:单文件 AOT 命令行 `astbox-cli.exe`,命令包括 `selftest`、`info`、`unlock`、`extract`、`create`、`add`、`verify`。
- `src/Astbox.Server`:无窗口(WinExe)本地服务 `astbox-server.exe`,托管 `gui/` 前端与本地 HTTP API;支持 `.astbox` / `.passbox` 文件关联(含 `--import-passbox` 导入:校验→落盘→注册→删除传播包)。
- `src/Astbox.TestsRunner`:原生自测试套件(36 项,含 CBOR 拒绝用例与互操作向量)。
- Windows 打包:`installer/` 含 `build_cs.py`、`astbox-cs.iss`、`VERSION` 与 `assets`(签名证书可选导入)。

### 技术栈
- C# / .NET 10(NativeAOT 发布)
- 依赖:NSec(libsodium)、Konscious.Security.Cryptography.Argon2、QRCoder、System.Security.Cryptography.ProtectedData
- 测试:xUnit(互操作源码套件)+ 原生 TestsRunner
- 前端:HTML / JavaScript / CSS(`gui/`,与旧版共用)
- 许可证:Apache-2.0,详见根目录 LICENSE

### 快速安装与运行
```bash
git clone https://github.com/Astenyx-Git/AstBox.git
cd AstBox
git checkout C#
dotnet publish src/Astbox.Cli/Astbox.Cli.csproj -c Release -r win-x64 -o .cli-publish
dotnet publish src/Astbox.Server/Astbox.Server.csproj -c Release -r win-x64 -o .server-publish
dotnet publish src/Astbox.TestsRunner/Astbox.TestsRunner.csproj -c Release -r win-x64 -o .tests-publish
```
运行原生测试套件
```powershell
.tests-publish\astbox-tests.exe
```
CLI 帮助与常用示例
```powershell
.cli-publish\astbox-cli.exe --help
.cli-publish\astbox-cli.exe info path\to\container.astbox
.cli-publish\astbox-cli.exe unlock path\to\container.astbox --totp 123456 --list
.cli-publish\astbox-cli.exe extract path\to\container.astbox --out .\extracted --totp 123456
.cli-publish\astbox-cli.exe create demo.astbox --demo
.cli-publish\astbox-cli.exe create my.astbox --qr myqr.png
.cli-publish\astbox-cli.exe add my.astbox --from-dir .\to_add --totp 123456 --out new.astbox
```
启动本地图形界面
```powershell
.server-publish\astbox-server.exe            # 默认端口 11920,自动打开浏览器
.server-publish\astbox-server.exe --port 21524 --no-browser
```
安装后双击 `.astbox` 直接打开容器;双击 `.passbox` 导入传播包(内嵌容器落盘至包同目录,成功后自动删除该包)。

### 构建安装器
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File installer\build_cs.ps1               # 同时产出 精简版 + Chromium 内核版
powershell -NoProfile -ExecutionPolicy Bypass -File installer\build_cs.ps1 -NoChromium   # 仅精简版
```
说明:需在 Windows 上安装 Inno Setup(ISCC)。版本号取自 `installer/VERSION`,标签自动追加 `C#` 后缀;产物写入 `installer/dist/` 并生成 `manifest.json`(channels:slim / chromium)。可选代码签名:设置环境变量 `ASTBOX_SIGN_PFX`、`ASTBOX_SIGN_PW`(及时间戳 `ASTBOX_SIGN_TS`)后,负载与安装包将逐一 Authenticode 签名。

### 其他
- 构建链零 Python:安装器入口为 `installer/build_cs.ps1`;历史开发脚本已归档至 `scripts/legacy/`(非构建必需)。
- 传播包加固(csha 容器摘要强制校验、导入成功即硬删除)见规范文档 `ASTBOX-v1.0-04-Lifecycle-Security.txt` §4。
- 本分支与 `main`(Python 参考实现)保持独立演进,互不合并。

---

## English

### Overview
This branch is the C#/.NET 10 (NativeAOT) rewrite of AstBox: **byte-compatible** with the ASTBOX v1.0 specification and artifacts produced by the earlier Python implementation, with the Python runtime removed. The repository hosts four .NET projects, the static GUI reused unchanged, a Windows installer builder, and the format/security specifications `ASTBOX-v1.0-*.txt` at the root.

### Features
- `src/Astbox.Core`: core library whose modules map one-to-one to the legacy ones — `Constants` / `Errors` / `CborDet` / `Crypto` / `Container` / `Creator` / `Modifier` / `Extractor` / `PassboxFile` / `QrUtil` / `BinWriter`.
- `src/Astbox.Cli`: single-file AOT command line `astbox-cli.exe`; commands include `selftest`, `info`, `unlock`, `extract`, `create`, `add`, `verify`.
- `src/Astbox.Server`: windowless (WinExe) local service `astbox-server.exe` hosting the `gui/` front end and a local HTTP API; handles `.astbox` / `.passbox` file associations (including `--import-passbox`: verify → materialize → register → consume pack).
- `src/Astbox.TestsRunner`: native self-test suite (36 checks, including CBOR rejection cases and interop vectors).
- Windows packaging: `installer/` contains `build_cs.py`, `astbox-cs.iss`, `VERSION`, and `assets` (optional signing certificate).

### Tech stack
- C# / .NET 10 (NativeAOT publishing)
- Dependencies: NSec (libsodium), Konscious.Security.Cryptography.Argon2, QRCoder, System.Security.Cryptography.ProtectedData
- Testing: xUnit (interop source suite) + the native TestsRunner
- Front end: HTML / JavaScript / CSS (`gui/`, shared with the legacy line)
- License: Apache-2.0 (`LICENSE` in repo root)

### Quick install & run
```bash
git clone https://github.com/Astenyx-Git/AstBox.git
cd AstBox
git checkout C#
dotnet publish src/Astbox.Cli/Astbox.Cli.csproj -c Release -r win-x64 -o .cli-publish
dotnet publish src/Astbox.Server/Astbox.Server.csproj -c Release -r win-x64 -o .server-publish
dotnet publish src/Astbox.TestsRunner/Astbox.TestsRunner.csproj -c Release -r win-x64 -o .tests-publish
```
Run the native test suite
```powershell
.tests-publish\astbox-tests.exe
```
CLI help and common examples
```powershell
.cli-publish\astbox-cli.exe --help
.cli-publish\astbox-cli.exe info path\to\container.astbox
.cli-publish\astbox-cli.exe unlock path\to\container.astbox --totp 123456 --list
.cli-publish\astbox-cli.exe extract path\to\container.astbox --out .\extracted --totp 123456
.cli-publish\astbox-cli.exe create demo.astbox --demo
.cli-publish\astbox-cli.exe create my.astbox --qr myqr.png
.cli-publish\astbox-cli.exe add my.astbox --from-dir .\to_add --totp 123456 --out new.astbox
```
Launch the local GUI
```powershell
.server-publish\astbox-server.exe            # default port 11920, opens the browser
.server-publish\astbox-server.exe --port 21524 --no-browser
```
Once installed, double-clicking `.astbox` opens the container directly; double-clicking `.passbox` imports a propagation package (the embedded container is materialized next to the pack, and the pack is consumed on success).

### Build installer
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File installer\build_cs.ps1               # builds both Slim and Chromium-bundled channels
powershell -NoProfile -ExecutionPolicy Bypass -File installer\build_cs.ps1 -NoChromium   # Slim only
```
Note: Inno Setup (ISCC) on Windows is required. The version comes from `installer/VERSION` and gets a `C#` suffix automatically; artifacts land in `installer/dist/` together with `manifest.json` (channels: slim / chromium). Optional Authenticode signing: set environment variables `ASTBOX_SIGN_PFX`, `ASTBOX_SIGN_PW` (and optionally `ASTBOX_SIGN_TS`); payload binaries and setup EXEs are then signed individually.

### Notes
- The build chain is Python-free: the installer entry point is `installer/build_cs.ps1`; historical dev scripts are archived under `scripts/legacy/` (not required for building).
- Propagation-package hardening (mandatory `csha` container digest; consume-on-success deletion) is specified in `ASTBOX-v1.0-04-Lifecycle-Security.txt` §4.
- This branch evolves independently from `main` (the Python reference); no cross-merges.

---

## 日本語

### 概要
このブランチは AstBox の C#/.NET 10(NativeAOT)による書き直しです。ASTBOX v1.0 仕様および旧 Python 実装が生成した成果物と**バイト互換**を保ち、Python ランタイムを廃しています。リポジトリには 4 つの .NET プロジェクト、そのまま再利用する静的 GUI、Windows インストーラ作成ツール、そしてルートの仕様文書 `ASTBOX-v1.0-*.txt` が含まれます。

### 機能
- `src/Astbox.Core`:コアライブラリ。モジュールは旧版と 1 対 1 に対応 —— `Constants` / `Errors` / `CborDet` / `Crypto` / `Container` / `Creator` / `Modifier` / `Extractor` / `PassboxFile` / `QrUtil` / `BinWriter`。
- `src/Astbox.Cli`:単一ファイル AOT の CLI `astbox-cli.exe`。コマンドは `selftest`、`info`、`unlock`、`extract`、`create`、`add`、`verify`。
- `src/Astbox.Server`:ウィンドウなし(WinExe)のローカルサービス `astbox-server.exe`。`gui/` フロントエンドとローカル HTTP API を提供し、`.astbox` / `.passbox` の関連付けに対応(`--import-passbox`:検証 → 展開 → 登録 → パック削除)。
- `src/Astbox.TestsRunner`:ネイティブ自己テストスイート(36 項目。CBOR 拒否ケースや相互運用ベクトルを含む)。
- Windows パッケージ:`installer/` に `build_cs.py`、`astbox-cs.iss`、`VERSION`、`assets`(署名証明書は任意)。

### 技術スタック
- C# / .NET 10(NativeAOT 公開)
- 依存関係:NSec(libsodium)、Konscious.Security.Cryptography.Argon2、QRCoder、System.Security.Cryptography.ProtectedData
- テスト:xUnit(相互運用ソーススイート)+ ネイティブ TestsRunner
- フロントエンド:HTML / JavaScript / CSS(`gui/`、旧版と共有)
- ライセンス:Apache-2.0(リポジトリの LICENSE)

### 簡単な導入と実行
```bash
git clone https://github.com/Astenyx-Git/AstBox.git
cd AstBox
git checkout C#
dotnet publish src/Astbox.Cli/Astbox.Cli.csproj -c Release -r win-x64 -o .cli-publish
dotnet publish src/Astbox.Server/Astbox.Server.csproj -c Release -r win-x64 -o .server-publish
dotnet publish src/Astbox.TestsRunner/Astbox.TestsRunner.csproj -c Release -r win-x64 -o .tests-publish
```
ネイティブテストスイートの実行
```powershell
.tests-publish\astbox-tests.exe
```
CLI ヘルプと主な例
```powershell
.cli-publish\astbox-cli.exe --help
.cli-publish\astbox-cli.exe info path\to\container.astbox
.cli-publish\astbox-cli.exe unlock path\to\container.astbox --totp 123456 --list
.cli-publish\astbox-cli.exe extract path\to\container.astbox --out .\extracted --totp 123456
.cli-publish\astbox-cli.exe create demo.astbox --demo
.cli-publish\astbox-cli.exe create my.astbox --qr myqr.png
.cli-publish\astbox-cli.exe add my.astbox --from-dir .\to_add --totp 123456 --out new.astbox
```
ローカル GUI の起動
```powershell
.server-publish\astbox-server.exe            # 既定ポート 11920、ブラウザを自動起動
.server-publish\astbox-server.exe --port 21524 --no-browser
```
インストール後、`.astbox` のダブルクリックでコンテナを直接開き、`.passbox` のダブルクリックで伝播パッケージを取り込みます(埋め込まれたコンテナはパックと同じフォルダーに展開され、成功後パックは自動削除)。

### インストーラのビルド
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File installer\build_cs.ps1               # Slim 版 + Chromium 同梱版の両方を生成
powershell -NoProfile -ExecutionPolicy Bypass -File installer\build_cs.ps1 -NoChromium   # Slim 版のみ
```
注:Windows 上の Inno Setup(ISCC)が必要です。バージョンは `installer/VERSION` から取得し、自動的に `C#` 接尾辞が付きます。成果物は `installer/dist/` に出力され、`manifest.json`(channels: slim / chromium)が生成されます。オプションの Authenticode 署名:環境変数 `ASTBOX_SIGN_PFX`、`ASTBOX_SIGN_PW`(および `ASTBOX_SIGN_TS`)を設定すると、ペイロードとセットアップ EXE が個別に署名されます。

### 備考
- ビルドチェーンに Python は不要です。インストーラの入口は `installer/build_cs.ps1`。過去の開発スクリプトは `scripts/legacy/` に保管(ビルドには不要)。
- 伝播パッケージの強化(csha コンテナダイジェストの強制検証、成功時のパック消費)は仕様書 `ASTBOX-v1.0-04-Lifecycle-Security.txt` §4 を参照。
- 本ブランチは `main`(Python リファレンス)とは独立して進化し、相互マージは行いません。

---
