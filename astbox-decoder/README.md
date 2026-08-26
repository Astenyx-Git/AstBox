# ASTBOX V3.0.0 桌面端解码器 / 封装器

依据工作目录中的 4 份 ASTBOX v1.0 规范文档（`ASTBOX-v1.0-01-Core-Format.txt`、
`02-Key-Crypto.txt`、`03-Data-Container.txt`、`04-Lifecycle-Security.txt`）实现的
`.astbox` 加密容器工具：**Windows 资源管理器风格图形界面（tkinter）+ 命令行（CLI）**，
纯 Python，跨平台（Windows / macOS / Linux）。

## 功能

- **解析**：读取并严格校验容器结构（Header / Key Slot / Metadata / Data / Footer），
  无需凭据即可查看 VaultID、Generation、凭据槽位（TOTP、KDF profile）等。
- **解锁**：以 **TOTP 为唯一打开凭据**（6/8 位、30 秒周期、SHA-1）；
  自动按规范验证 HeaderMAC、SlotMAC、FooterMAC、Metadata/Data Digest、
  元数据 AEAD 与目录树。含密码槽（CredentialType 0x0001）的容器按设计
  不存在，一律以 `ASTBOX_E_UNSUPPORTED_CREDENTIAL` 拒绝。
- **浏览（资源管理器风格）**：工具栏 + 后退/前进/上级导航 + 地址栏（可直接输入路径）、
  多列文件列表（名称/大小/修改时间/类型，目录优先排序）、双击进入目录、
  右键上下文菜单、状态栏。
- **提取**：选中文件或全部文件解密导出到本地目录；逐记录认证后才返回明文。
- **封装**：把整个文件夹打包成 `.astbox`（或新建空容器）——**TOTP 为唯一打开凭据**，
  自动生成 Base32 密钥并**弹出二维码**（otpauth URI）供验证器 App 扫描导入；
  也可手动指定自己的 Base32 密钥。
- **添加文件**：向已解锁容器添加文件/文件夹（按规范执行 Generation+1 事务修改，
  全部数据记录以新 Generation 与全新 nonce 重新加密，原子替换提交）。
- **TOTP**：解锁时输入验证码（程序按 RFC 6238 校验；容器本身不存
  TOTP 密钥，规范要求密钥在外部保管）。
- **传播包 (.passbox)**：已解锁状态下从"更多操作"生成——单个文件内嵌
  容器本体与 Base32 密钥，拷到其它设备后**双击即完成导入并注册本机
  凭据**，随后照常输码解锁。支持口令封装（默认）与免口令快速包；
  包内含整体 SHA-256 防篡改校验。传播包等价于容器钥匙，请妥善保管。
- **验证**：Level-5 全容器验证（认证每个 Data Record）；密码学自检
  （RFC 5869 / RFC 6238 / draft-irtf-cfrg-xchacha-03 官方测试向量）。
- **演示**：一键生成带演示内容的 TOTP-only 容器，并弹出二维码供导入验证器。
- **双语界面**：图形界面支持简体中文 / 英语切换（右上角语言按钮），所有文案
  均通过本地字典动态渲染，切换即时生效，语言偏好持久化到 `localStorage`。

## 快速开始（Windows）

1. 安装 Python 3.10+（含 tkinter，官方 python.org 安装包默认自带）。
2. 双击 **`run_gui.bat`** 启动图形界面（首次运行会自动安装依赖）。
   命令行使用：双击 **`run_cli.bat`** 或：

   ```bat
   python bootstrap_deps.py        :: 首次运行：安装依赖（pip 优先，失败自动走离线 wheel 下载）
   python astbox_gui.py            :: 启动图形界面
   ```

依赖：`argon2-cffi`（Argon2id）、`pynacl`（XChaCha20-Poly1305）、`cffi`、
`qrcode` + `pypng`（二维码）。也可以手动安装：`pip install -r requirements.txt`。

## 图形界面用法

1. **打开**：工具栏「打开…」（或「生成演示容器并打开」，随后弹出二维码供扫描）。
2. **解锁**：在"TOTP"栏输入验证器当前显示的验证码，点「解锁」（Argon2id 高配置
   约需 1~2 秒）；也可点「Base32 计算…」输入 Base32 密钥自动填码。
3. **浏览**：双击目录进入；「▲ 上级」「◀ ▶」后退/前进；地址栏输入 `/docs/notes` 直达；
   F5 刷新。
4. **提取**：选中文件 →「提取选中」，或「全部提取」；输出目录可随时指定。
5. **封装文件夹为 .astbox**：工具栏「封装文件夹…」→ 选源文件夹、目标文件、
   选 TOTP 位数（6/8），可手动指定 Base32 密钥（留空自动生成）→「开始封装」；
   完成后**弹出二维码**，用验证器 App 扫描导入，即可用它解锁容器。
6. **添加文件**：解锁后在当前目录点「添加文件…」/「添加文件夹…」。
7. **语言切换**：右上角「🌐」按钮可在简体中文 / 英语之间切换，所有界面文案
   即时更新，语言偏好自动保存到浏览器本地存储。

## 命令行用法

```bash
# 密码学自测（含 RFC 5869 / RFC 6238 / draft-irtf-cfrg-xchacha-03 官方测试向量）
python astbox_cli.py selftest

# 查看容器结构（无需凭据）
python astbox_cli.py info demo.astbox

# 解锁并列出内容（TOTP 为唯一打开凭据）
python astbox_cli.py unlock demo.astbox --totp 123456

# 全部提取并做 Level-5 验证
python astbox_cli.py extract demo.astbox --totp 123456 --out outdir --verify

# 提取单个文件
python astbox_cli.py extract demo.astbox --totp 123456 --out outdir --path docs/guide.md

# 生成演示容器（TOTP-only，指定 RFC 测试密钥并输出二维码 PNG）
python astbox_cli.py create demo.astbox --demo --totp-secret JBSWY3DPEHPK3PXP --qr demo.png

# 从目录导入文件生成 TOTP-only 容器（指定密钥，打印 otpauth URI）
python astbox_cli.py create packed.astbox --seed-dir ./mydir --totp-secret JBSWY3DPEHPK3PXP

# 只给 --qr：自动生成 TOTP 密钥并保存二维码
python astbox_cli.py create packed.astbox --seed-dir ./mydir --qr packed-qr.png

# 向容器添加文件（Generation 事务式修改，默认原地写回）
python astbox_cli.py add packed.astbox --totp 123456 --from-dir ./more-files
```

## 项目结构

```
astbox-decoder/
├── astbox/
│   ├── constants.py    # 协议常量、域分离标签、KDF profile
│   ├── errors.py       # 规范定义的 UINT16 错误码与 AstboxError
│   ├── cbor_det.py     # 确定性 CBOR（RFC 8949 严格解码/编码）
│   ├── crypto.py       # Argon2id / HKDF-SHA-256 / XChaCha20-Poly1305 /
│   │                   #   TOTP / HMAC；纯 Python AEAD 回退实现
│   ├── container.py    # Header/KeySlot/Footer 解析、解锁、元数据校验、数据索引
│   ├── create.py       # 容器生成器（封装文件夹/测试容器，同时自验证解码器）
│   ├── modify.py       # 向已解锁容器添加文件（Generation 事务式修改）
│   ├── extract.py      # 安全导出到本地目录
│   └── qrutil.py       # TOTP otpauth URI / 二维码（tk Canvas 渲染 + PNG 输出）
├── astbox_cli.py       # 命令行入口（info/unlock/extract/create/add/selftest）
├── astbox_gui.py       # Windows 资源管理器风格图形界面
├── bootstrap_deps.py   # 依赖引导（pip 优先 + 手动 wheel 下载回退）
├── requirements.txt
├── run_gui.bat / run_cli.bat
└── tests/
    ├── test_roundtrip.py   # 端到端回环：创建→解锁→提取→添加文件→篡改检测
    └── test_gui_smoke.py   # GUI 冒烟：解析→解锁→导航→提取→封装→添加→锁定
```

## 实现要点（对照规范）

- 全大端整数；Header 128B / KeySlot 192B / Footer 112B 逐字段校验，
  所有偏移满足 `KeySlotOffset=128`、`MetadataOffset=128+192×N`、
  `DataOffset=+MetadataLength`、`FooterOffset=+DataLength`、`FileSize=FooterOffset+112`，
  全部带 UINT64 溢出检查。
- 凭据处理：**新封装容器**的 KDF 凭据为 Base32 密钥的解码字节（高熵、
  稳定，任意时间/设备凭密钥即可解锁）；解锁时可改输 6/8 位验证码，
  由程序按 RFC 6238 校验（需本机注册表持有该容器密钥）。
  Argon2id 输入为 `CredentialType‖CredentialParameters‖"ASTBOX-KDF-v1"‖凭据`。
  （兼容注：早期构建曾以"封装时刻验证码"作为凭据，此类旧容器仅在
  封装时间 ±150 秒内可解锁，且该窗口已过，无法追溯恢复。）
- 密钥层次：VaultKey → HKDF-SHA-256（盐 `"ASTBOX-HKDF-SALT-v1"‖VaultID`）
  派生出 HeaderKey / MetadataKey / DataKey / SlotMACKey / FooterKey。
- 认证：HeaderMAC / SlotMAC / FooterMAC 均为 HMAC-SHA-256 截断 16 字节，
  带固定域标签；XChaCha20-Poly1305 关联数据严格按规范拼接。
- 元数据：确定性 CBOR 严格解码（拒绝非最小整数、重复键、乱序键、浮点、tag、
  不定长），顶层键 1..5、条目键 1..9 逐一校验；目录树无环、兄弟名唯一。
- 数据：分块 ≤ 1 MiB；DataStart/DataLength、ChunkIndex 连续性、
  块长与 Size 之和、区域完全覆盖均校验；导出前每记录认证。
- 修改（添加文件）：Generation 恰好 +1；元数据用全新 MetadataNonce 重加密；
  因 Data 记录的关联数据绑定 Generation（规范 §43），所有数据记录都以
  新 Generation 与全新 DataNonce 重新加密，整区按 FileID 重排；
  Footer/HeaderMAC 重算；临时文件 + 原子替换提交（规范 §79-83）。
- 常量时间比较（`hmac.compare_digest`）；失败一律 fail-closed，
  凭据错误对外统一报告 `ASTBOX_E_AUTHENTICATION_FAILED`。

## 安全说明

- 程序提供读（解锁/浏览/提取）与写（封装/添加文件）两种操作；
  `create`/`add` 按规范生成或修改容器。**TOTP 为唯一打开凭据**
  （规范推荐配置：6 位 / 30 秒 / SHA-1）；含密码槽（0x0001）的容器
  按设计不存在，解析时以 `ASTBOX_E_UNSUPPORTED_CREDENTIAL` 拒绝。
- TOTP 验证码只有 6/8 位空间；**新封装容器**的 KDF 凭据是 Base32 密钥
  解码字节（≥160 位随机），离线枚举不再可行，安全性显著优于旧版。
  但密钥本身一旦泄露，容器即失守——请妥善保管验证器与密钥记录。
- 封装时生成的 TOTP Base32 密钥只在二维码弹窗中显示一次，请立即
  用验证器扫描导入并另存备份（截图/密码管理器）；丢失后该凭据
  将无法再使用（含跨设备打开能力）。
- 程序不会在任何日志或界面中显示 VaultKey / 解密密钥。
- 对损坏或篡改的容器一律拒绝，不尝试启发式修复（规范 §51-52）。

## 测试

```bash
python tests/test_roundtrip.py    # 密码学自测 + 创建/解锁/提取/添加文件/篡改检测回环
python tests/test_gui_smoke.py    # GUI 全流程冒烟（导航/提取/封装向导/添加文件）
```

## 签名验证

Windows 安装器与便携包内的 `Astbox.cer` 是发布签名公钥
（`CN=Astbox`，自签名）。导入受信任根后系统会显示已验证发布者：

```bat
certutil -user -addstore Root Astbox.cer    :: 导入(当前用户)
certutil -user -delstore Root Astbox        :: 随时撤销
```

安装器完成页也提供同样的可选勾选项。注意：
- 证书只证明"文件出自本仓库且未被篡改"，不影响 SmartScreen
  对新文件的信誉度判断；
- `.pfx` 私钥永不随包分发。

## 许可证

本项目以 [Apache License 2.0](../LICENSE) 发布。
Copyright 2026 Astenyx-Git —— 第三方组件归属见根目录 NOTICE。
