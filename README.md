# AstBox

Repository: Astenyx-Git/AstBox  
License: Apache License 2.0

## 项目简介
AstBox 实现了 ASTBOX v1.0 容器格式的工具集合。仓库包含用于解析、创建、修改与解密 ASTBOX 容器的 Python 实现、静态 GUI 资源，以及用于生成 Windows 安装包的脚本与资源。根目录包含若干关于 ASTBOX 格式与安全性的规范文档（`ASTBOX-v1.0-*.txt`）。

> 本 README 的所有内容均基于仓库中实际存在的文件与脚本。

## 功能
- 命令行工具（`astbox-decoder/astbox_cli.py`）：
  - `selftest`：运行加密自检
  - `info FILE`：显示容器结构信息
  - `unlock FILE [--totp] [--list] [--verify]`：解锁容器并查看内容
  - `extract FILE --out DIR [--totp] [--path] [--verify]`：提取容器文件
  - `create FILE [--totp-code|--totp-secret|--qr] [--totp-digits] [--seed-dir] [--demo] [--profile]`：创建（TOTP-only）容器并可生成 TOTP secret/QR
  - `add FILE --from-dir DIR [--totp] [--out NEW]`：将目录文件加入容器（generation 事务）
- Python 包实现（`astbox-decoder/astbox/`）：包含 `container.py`、`create.py`、`crypto.py`、`extract.py`、`modify.py`、`qrutil.py` 等模块。
- 静态 GUI：`astbox-decoder/gui/`（`index.html`, `app.js`, `app.css`, `icon.png`），并包含 `astbox-decoder/astbox_server.py` 与运行脚本 `run_gui.pyw` / `run_gui.bat` 用于本地运行。
- Windows 安装器：`installer/` 包含 Inno Setup 脚本 `astbox.iss`、构建脚本 `installer/build.py`、以及图标/证书资源。

## 技术栈
- 主要语言：Python
- 前端（GUI）：HTML / JavaScript / CSS（静态）
- Python 依赖（见 `astbox-decoder/requirements.txt`）：
  - argon2-cffi
  - pynacl
  - cffi
  - qrcode
  - pypng
- 打包：Inno Setup 脚本（`.iss`）

## 项目结构（关键项）
- astbox-decoder/
  - `astbox_cli.py` — 命令行入口
  - `astbox_server.py` — 本地服务脚本（用于 GUI）
  - `requirements.txt` — Python 依赖
  - `run_cli.bat`, `run_gui.bat`, `run_gui.pyw` — 运行脚本
  - `gui/` — 静态前端资源
  - `astbox/` — Python 包实现（核心模块）
  - `tests/` — 测试目录（存在，当前快照未见可执行测试用例）
  - `README.md` — 子模块说明（存在）
- installer/
  - `build.py` — 构建脚本
  - `astbox.iss` — Inno Setup 脚本
  - `assets/` — 图标/证书等
- 根目录
  - `ASTBOX-v1.0-01-Core-Format.txt` 等格式/规范文档
  - `LICENSE`、`NOTICE`

## 环境要求
- Python 3（仓库脚本以 `python3` 为目标）
- 需要安装 `astbox-decoder/requirements.txt` 中列出的依赖
- 若要构建 Windows 安装包：需在 Windows 环境准备 Inno Setup（仓库不包含 Inno Setup 本体）

> 子目录 `astbox-decoder/README.md` 中有对 Python 3.x（包括 3.10）的说明，根仓库未明确指定精确次版本。若需强制版本，请在仓库中补充。

## 安装
```bash
git clone https://github.com/Astenyx-Git/AstBox.git
cd AstBox

# 安装 Python 依赖
python3 -m pip install -r astbox-decoder/requirements.txt
```

## 配置
- CLI 工具通过命令行参数或交互式输入接收凭据（`--totp`, `--totp-secret`, `--totp-code` 等）。
- 仓库中未提供 `.env` 或统一配置文件样例。`installer/build.py` 与 `astbox_server.py` 可能有额外参数，请直接查看这些脚本以获取详细配置方式。

## 运行
- 查看 CLI 帮助：
```bash
python3 astbox-decoder/astbox_cli.py --help
```

- 常用示例：
```bash
# 显示容器信息
python3 astbox-decoder/astbox_cli.py info path/to/container.astbox

# 解锁并列出内容
python3 astbox-decoder/astbox_cli.py unlock path/to/container.astbox --totp 123456 --list

# 提取文件
python3 astbox-decoder/astbox_cli.py extract path/to/container.astbox --out ./extracted --totp 123456

# 创建示例容器
python3 astbox-decoder/astbox_cli.py create demo.astbox --demo

# 创建并保存 QR
python3 astbox-decoder/astbox_cli.py create my.astbox --qr myqr.png

# 添加目录到容器
python3 astbox-decoder/astbox_cli.py add my.astbox --from-dir ./to_add --totp 123456 --out new.astbox
```

- Windows 运行脚本（仓库中存在）：
```
astbox-decoder\run_cli.bat
astbox-decoder\run_gui.bat
```
或
```powershell
python astbox-decoder/run_gui.pyw
```

## 构建 / 打包
- 使用仓库内的构建脚本（示例）：
```bash
python installer/build.py
```
- 生成最终 Windows 安装包通常还需 Inno Setup 编译器来处理 `installer/astbox.iss`。详见 `installer/build.py`。

## 使用说明（要点）
- `create` 若未提供 secret/code，会生成 TOTP secret 并输出 Base32 与 otpauth URI；可使用 `--qr` 保存二维码 PNG。
- `unlock` / `extract` / `add` 可使用 `--totp` 提供当前 TOTP code，或交互式输入。
- `create --demo` 会嵌入示例文件集（实现见 `astbox_cli.py` 内 `_demo_files()`）。

## 开发
- 在 `astbox-decoder/astbox/` 进行代码修改和实现扩展。
- 开发流程示例：
  1. 建立并激活 Python 虚拟环境
  2. 安装依赖：`python3 -m pip install -r astbox-decoder/requirements.txt`
  3. 运行/调试 CLI：`python3 astbox-decoder/astbox_cli.py ...`
  4. 编辑 GUI：`astbox-decoder/gui/` 并用 `astbox_server.py` 联调

## 测试
- 存在 `astbox-decoder/tests/` 目录，但当前快照中未见可执行测试用例或 CI 配置。
- 若添加测试，建议使用 pytest 或 unittest，并在 CI 中配置测试步骤（仓库当前未包含 CI 配置）。

## 部署
- 仓库未包含 Docker、云部署或 CI/CD 配置（当前快照中未检测到）。
- Windows 安装器打包为唯一明确的“部署/分发”路径（见 `installer/`）。

## 贡献
- 未发现 CONTRIBUTING.md，建议通用流程：
  - 提交 Issue 描述问题或建议
  - Fork -> 分支开发 -> 提交 Pull Request
  - 如有改动请补充或更新测试（放在 `astbox-decoder/tests/`）

**重要**：请勿将真实私钥、Token、密码或其它敏感信息提交到仓库。

## 许可
本项目使用 Apache License 2.0，详见仓库根目录 `LICENSE` 文件。

## 待维护者补充（可选）
- 建议的/受支持的具体 Python 次版本
- `astbox_server.py` 的 API 文档（若需公开 API）
- CI/CD（测试/构建/发布）配置与说明
