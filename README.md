# Astbox (中文 / English / 日本語)

Repository: Astenyx-Git/AstBox  
License: Apache License 2.0

## 中文

### 项目简介
AstBox 实现了 ASTBOX v1.0 容器格式的工具集合。仓库包含 Python 实现、静态 GUI 资源与用于生成 Windows 安装包的脚本。根目录含多份格式与安全规范文档 `ASTBOX-v1.0-*.txt`。

### 功能
- CLI: `astbox-decoder/astbox_cli.py`，命令包括 `selftest`、`info`、`unlock`、`extract`、`create`、`add`。
- Python 包: `astbox-decoder/astbox/`，包含 container、create、crypto、extract、modify、qrutil 等模块。
- 静态 GUI: `astbox-decoder/gui/`，包含 `index.html`、`app.js`、`app.css`、`icon.png`，以及 `astbox-decoder/astbox_server.py` 与运行脚本 `run_gui.*`。
- Windows 打包: `installer/` 包含 `astbox.iss`、`installer/build.py` 与 `assets`。

### 技术栈
- Python
- HTML / JavaScript / CSS
- 依赖见 `astbox-decoder/requirements.txt`：argon2-cffi, pynacl, cffi, qrcode, pypng
- 许可证: Apache-2.0，详见根目录 LICENSE

### 快速安装与运行
```bash
git clone https://github.com/Astenyx-Git/AstBox.git
cd AstBox
python3 -m pip install -r astbox-decoder/requirements.txt
```
查看 CLI 帮助
```bash
python3 astbox-decoder/astbox_cli.py --help
```
常用示例
```bash
python3 astbox-decoder/astbox_cli.py info path/to/container.astbox
python3 astbox-decoder/astbox_cli.py unlock path/to/container.astbox --totp 123456 --list
python3 astbox-decoder/astbox_cli.py extract path/to/container.astbox --out ./extracted --totp 123456
python3 astbox-decoder/astbox_cli.py create demo.astbox --demo
python3 astbox-decoder/astbox_cli.py create my.astbox --qr myqr.png
python3 astbox-decoder/astbox_cli.py add my.astbox --from-dir ./to_add --totp 123456 --out new.astbox
```
Windows 运行脚本
```
astbox-decoder\run_cli.bat
astbox-decoder\run_gui.bat
```
或
```powershell
python astbox-decoder/run_gui.pyw
```

### 构建安装器
```bash
python installer/build.py
```
说明: 生成最终安装包通常需要在 Windows 上使用 Inno Setup 编译 `installer/astbox.iss`。

### 其他
- 测试目录: `astbox-decoder/tests/`，当前未检测到可运行的测试用例。
- 建议维护者补充: 推荐的 Python 次版本、`astbox_server.py` 的 API 文档、CI/CD 配置。

---

## English

### Overview
AstBox implements the ASTBOX v1.0 container tools. The repository includes a Python implementation, static GUI assets, and scripts and resources to build a Windows installer. The repository root contains format and security specification files `ASTBOX-v1.0-*.txt`.

### Features
- CLI: `astbox-decoder/astbox_cli.py`, commands include `selftest`, `info`, `unlock`, `extract`, `create`, `add`.
- Python package: `astbox-decoder/astbox/`, includes modules such as container, create, crypto, extract, modify, qrutil.
- Static GUI: `astbox-decoder/gui/` with `index.html`, `app.js`, `app.css`, `icon.png`, plus `astbox-decoder/astbox_server.py` and run scripts `run_gui.*`.
- Windows packaging: `installer/` contains `astbox.iss`, `installer/build.py` and `assets`.

### Tech stack
- Python
- HTML / JavaScript / CSS
- Dependencies: see `astbox-decoder/requirements.txt` (argon2-cffi, pynacl, cffi, qrcode, pypng)
- License: Apache-2.0 (`LICENSE` in repo root)

### Quick install & run
```bash
git clone https://github.com/Astenyx-Git/AstBox.git
cd AstBox
python3 -m pip install -r astbox-decoder/requirements.txt
```
View CLI help
```bash
python3 astbox-decoder/astbox_cli.py --help
```
Common examples
```bash
python3 astbox-decoder/astbox_cli.py info path/to/container.astbox
python3 astbox-decoder/astbox_cli.py unlock path/to/container.astbox --totp 123456 --list
python3 astbox-decoder/astbox_cli.py extract path/to/container.astbox --out ./extracted --totp 123456
python3 astbox-decoder/astbox_cli.py create demo.astbox --demo
python3 astbox-decoder/astbox_cli.py create my.astbox --qr myqr.png
python3 astbox-decoder/astbox_cli.py add my.astbox --from-dir ./to_add --totp 123456 --out new.astbox
```
Windows run scripts
```
astbox-decoder\run_cli.bat
astbox-decoder\run_gui.bat
```
or
```powershell
python astbox-decoder/run_gui.pyw
```

### Build installer
```bash
python installer/build.py
```
Note: producing the final installer normally requires Inno Setup on Windows to compile `installer/astbox.iss`.

### Notes
- Tests: `astbox-decoder/tests/` exists but no runnable tests were detected in the current snapshot.
- Items to confirm by maintainers: exact supported Python minor version, API docs for `astbox_server.py`, CI/CD configuration.

---

## 日本語

### 概要
AstBox は ASTBOX v1.0 コンテナ用ツールの実装です。リポジトリには Python 実装、静的 GUI 資産、および Windows インストーラ作成用のスクリプトとリソースが含まれます。ルートには仕様文書 `ASTBOX-v1.0-*.txt` があります。

### 機能
- CLI: `astbox-decoder/astbox_cli.py`、コマンドは `selftest`、`info`、`unlock`、`extract`、`create`、`add`。
- Python パッケージ: `astbox-decoder/astbox/`、container、create、crypto、extract、modify、qrutil 等のモジュールを含む。
- 静的 GUI: `astbox-decoder/gui/`（`index.html`, `app.js`, `app.css`, `icon.png`）と `astbox-decoder/astbox_server.py`、実行スクリプト `run_gui.*`。
- Windows パッケージ: `installer/` に `astbox.iss`、`installer/build.py`、`assets` を含む。

### 技術スタック
- Python
- HTML / JavaScript / CSS
- 依存関係: `astbox-decoder/requirements.txt` を参照（argon2-cffi, pynacl, cffi, qrcode, pypng）
- ライセンス: Apache-2.0（リポジトリの LICENSE）

### 簡単な導入と実行
```bash
git clone https://github.com/Astenyx-Git/AstBox.git
cd AstBox
python3 -m pip install -r astbox-decoder/requirements.txt
```
CLI ヘルプ
```bash
python3 astbox-decoder/astbox_cli.py --help
```
例
```bash
python3 astbox-decoder/astbox_cli.py info path/to/container.astbox
python3 astbox-decoder/astbox_cli.py unlock path/to/container.astbox --totp 123456 --list
python3 astbox-decoder/astbox_cli.py extract path/to/container.astbox --out ./extracted --totp 123456
python3 astbox-decoder/astbox_cli.py create demo.astbox --demo
python3 astbox-decoder/astbox_cli.py create my.astbox --qr myqr.png
python3 astbox-decoder/astbox_cli.py add my.astbox --from-dir ./to_add --totp 123456 --out new.astbox
```
Windows 実行スクリプト
```
astbox-decoder\run_cli.bat
astbox-decoder\run_gui.bat
```
または
```powershell
python astbox-decoder/run_gui.pyw
```

### インストーラのビルド
```bash
python installer/build.py
```
注: 最終的なインストーラ作成には Windows の Inno Setup が必要な場合があります。

### 備考
- テスト: `astbox-decoder/tests/` は存在するが、現スナップショットでは実行可能なテストは検出されていない。
- メンテナが確認すべき項目: サポートする Python の正確なバージョン、`astbox_server.py` の API ドキュメント、CI/CD 設定。

---
