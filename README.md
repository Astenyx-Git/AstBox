# AstBox / ASTBOX v1.0

简洁版：下文按中文 / English / 日本語 三种语言并列展示同等内容（以仓库中实际存在的文件为准）。

---

## 中文（简洁）

### 项目简介
AstBox 实现了 ASTBOX v1.0 容器格式的工具集合。仓库包含 Python 实现、静态 GUI 资源与用于生成 Windows 安装包的脚本。根目录含多份格式与安全规范文档（`ASTBOX-v1.0-*.txt`）。

### 功能（已实现）
- CLI：`astbox-decoder/astbox_cli.py`（子命令：`selftest`、`info`、`unlock`、`extract`、`create`、`add`）。
- Python 包：`astbox-decoder/astbox/`（包含 container/create/crypto/extract/modify/qrutil 等模块）。
- 静态 GUI：`astbox-decoder/gui/`（`index.html`、`app.js`、`app.css`、`icon.png`），以及 `astbox-decoder/astbox_server.py` 与运行脚本（`run_gui.*`）。
- Windows 打包：`installer/` 包含 `astbox.iss`、`installer/build.py` 与 `assets/`。

### 技术栈
- Python（主要实现）
- HTML / JS / CSS（静态 GUI）
- 依赖见 `astbox-decoder/requirements.txt`：argon2-cffi, pynacl, cffi, qrcode, pypng
- 许可证：Apache‑2.0（仓库 `LICENSE`）

### 快速安装与运行（来自仓库脚本）
```bash
git clone https://github.com/Astenyx-Git/AstBox.git
cd AstBox
python3 -m pip install -r astbox-decoder/requirements.txt
```
查看 CLI 帮助：
```bash
python3 astbox-decoder/astbox_cli.py --help
```
常用示例（均基于仓库实际脚本）：
```bash
python3 astbox-decoder/astbox_cli.py info path/to/container.astbox
python3 astbox-decoder/astbox_cli.py unlock path/to/container.astbox --totp 123456 --list
python3 astbox-decoder/astbox_cli.py extract path/to/container.astbox --out ./extracted --totp 123456
python3 astbox-decoder/astbox_cli.py create demo.astbox --demo
python3 astbox-decoder/astbox_cli.py create my.astbox --qr myqr.png
python3 astbox-decoder/astbox_cli.py add my.astbox --from-dir ./to_add --totp 123456 --out new.astbox
```
Windows 运行脚本（仓库存在）：
```
astbox-decoder\run_cli.bat
astbox-decoder\run_gui.bat
```
GUI 也可用：
```powershell
python astbox-decoder/run_gui.pyw
```

### 构建安装器（仓库脚本）
```bash
python installer/build.py
```
（生成最终安装包通常需要在 Windows 环境使用 Inno Setup 编译 `installer/astbox.iss`；Inno Setup 不在仓库内）

### 其他
- 测试目录：`astbox-decoder/tests/`（存在，但当前快照未见可运行测试用例）。
- 需维护者补充：推荐的 Python 精确次版本、`astbox_server.py` API 文档、CI/CD 配置（仓库中未包含）。

---

## English (Concise)

### Overview
AstBox implements the ASTBOX v1.0 container tools. The repository includes a Python implementation, static GUI assets, and scripts/resources for building a Windows installer. The repository root contains format and security specification files (`ASTBOX-v1.0-*.txt`).

### Implemented features
- CLI: `astbox-decoder/astbox_cli.py` (commands: `selftest`, `info`, `unlock`, `extract`, `create`, `add`).
- Python package: `astbox-decoder/astbox/` (modules such as container, create, crypto, extract, modify, qrutil).
- Static GUI: `astbox-decoder/gui/` (`index.html`, `app.js`, `app.css`, `icon.png`) plus `astbox-decoder/astbox_server.py` and run scripts (`run_gui.*`).
- Windows packaging: `installer/` includes `astbox.iss`, `installer/build.py` and `assets/`.

### Tech stack
- Python
- HTML / JavaScript / CSS (static GUI)
- Dependencies: see `astbox-decoder/requirements.txt` (argon2-cffi, pynacl, cffi, qrcode, pypng)
- License: Apache‑2.0 (`LICENSE` in repo root)

### Quick install & run (commands come from the repository)
```bash
git clone https://github.com/Astenyx-Git/AstBox.git
cd AstBox
python3 -m pip install -r astbox-decoder/requirements.txt
```
View CLI help:
```bash
python3 astbox-decoder/astbox_cli.py --help
```
Common examples (from actual scripts):
```bash
python3 astbox-decoder/astbox_cli.py info path/to/container.astbox
python3 astbox-decoder/astbox_cli.py unlock path/to/container.astbox --totp 123456 --list
python3 astbox-decoder/astbox_cli.py extract path/to/container.astbox --out ./extracted --totp 123456
python3 astbox-decoder/astbox_cli.py create demo.astbox --demo
python3 astbox-decoder/astbox_cli.py create my.astbox --qr myqr.png
python3 astbox-decoder/astbox_cli.py add my.astbox --from-dir ./to_add --totp 123456 --out new.astbox
```
Windows run scripts available in repo:
```
astbox-decoder\run_cli.bat
astbox-decoder\run_gui.bat
```
Or run GUI script:
```powershell
python astbox-decoder/run_gui.pyw
```

### Build installer (repository script)
```bash
python installer/build.py
```
(Note: producing the final installer normally requires Inno Setup on Windows to compile `installer/astbox.iss`.)

### Notes
- Tests: `astbox-decoder/tests/` exists but no runnable tests were detected in the current snapshot.
- Items to confirm by maintainers: exact supported Python minor version, API docs for `astbox_server.py`, CI/CD configuration.

---

## 日本語（簡潔）

### 概要
AstBox は ASTBOX v1.0 コンテナ用ツール群の実装です。リポジトリには Python 実装、静的 GUI 資産、および Windows インストーラ作成用のスクリプトとリソースが含まれます。ルートにはフォーマットとセキュリティ仕様の文書（`ASTBOX-v1.0-*.txt`）があります。

### 実装済み機能
- CLI: `astbox-decoder/astbox_cli.py`（コマンド：`selftest`、`info`、`unlock`、`extract`、`create`、`add`）。
- Python パッケージ: `astbox-decoder/astbox/`（container、create、crypto、extract、modify、qrutil 等のモジュール）。
- 静的 GUI: `astbox-decoder/gui/`（`index.html`, `app.js`, `app.css`, `icon.png`）および `astbox-decoder/astbox_server.py`、実行用スクリプト（`run_gui.*`）。
- Windows パッケージング: `installer/`（`astbox.iss`, `installer/build.py`, `assets/`）。

### 技術スタック
- Python
- HTML / JavaScript / CSS（静的 GUI）
- 依存関係: `astbox-decoder/requirements.txt` を参照（argon2-cffi, pynacl, cffi, qrcode, pypng）
- ライセンス: Apache‑2.0（ルートの `LICENSE`）

### 簡単な導入と実行（リポジトリ内のコマンド）
```bash
git clone https://github.com/Astenyx-Git/AstBox.git
cd AstBox
python3 -m pip install -r astbox-decoder/requirements.txt
```
CLI ヘルプ：
```bash
python3 astbox-decoder/astbox_cli.py --help
```
よく使う例：
```bash
python3 astbox-decoder/astbox_cli.py info path/to/container.astbox
python3 astbox-decoder/astbox_cli.py unlock path/to/container.astbox --totp 123456 --list
python3 astbox-decoder/astbox_cli.py extract path/to/container.astbox --out ./extracted --totp 123456
python3 astbox-decoder/astbox_cli.py create demo.astbox --demo
python3 astbox-decoder/astbox_cli.py create my.astbox --qr myqr.png
python3 astbox-decoder/astbox_cli.py add my.astbox --from-dir ./to_add --totp 123456 --out new.astbox
```
Windows 実行スクリプト（リポジトリに存在）：
```
astbox-decoder\run_cli.bat
astbox-decoder\run_gui.bat
```
GUI 実行（スクリプト）:
```powershell
python astbox-decoder/run_gui.pyw
```

### インストーラのビルド（リポジトリのスクリプト）
```bash
python installer/build.py
```
（最終的なインストーラ作成には Windows 上の Inno Setup が必要な場合があります）

### 備考
- テスト：`astbox-decoder/tests/` は存在しますが、現時点のスナップショットでは実行可能なテストは検出されていません。
- メンテナが確認すべき項目：サポートする Python のマイナー版、`astbox_server.py` の API ドキュメント、CI/CD 設定。

---

*本ファイルは仓库中实际存在的文件和脚本为依据编写。如需进一步本地化或添加详细 API/CI 文档，请指定要解析的脚本或文件。*
