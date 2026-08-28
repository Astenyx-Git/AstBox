# TS + Tauri 移植全流程规划

> 状态:规划(未开工)。决策已锁定:**Rust 仅桌面单形态**(无 server bin,4 GiB 上传走"Rust 侧路径直读");安装器双版本——**默认小包(embedBootstrapper)** + **offlineInstaller 附加版**(+WebView2 离线运行时,不影响默认包)。Tauri **v2**,锁小版本。
>
> 相关文档:关联治理 / S2 迁移已验证语义见 `docs/exp.md`(P5/P6/P7 直接引用)。

## 总览

单人 8–10 周;P1 与 P4 可并行,压缩至 6–7 周。

```
P0 spike ──▶ P1 core ──▶ P2 CLI ──▶ P3 壳+IPC ──▶ P4 TS 前端 ──▶ P5 系统集成 ──▶ P6 安装器 ──▶ P7 验收 ──▶ P8 交付
  3-5天      2-3周        3-4天       1周          1.5-2周        1-1.5周         1周           1周        2-3天
```

## 落位与资产继承

```
rust/
├── crates/
│   ├── astbox-core/       # 密码学/CBOR/容器(唯一事实源, 从 C# 逐行翻译)
│   └── astbox-cli/        # clap CLI(命令面与现版对齐)
└── desktop/               # Tauri v2 应用(src-tauri 惯例)
frontend/                  # TS 前端(从 gui/app.js 模块化重写)
installer/                 # 现有链改造: build_cs.ps1 → tauri build 双产物
docs/exp.md                # 关联治理/S2 已验证语义(Tauri 移植直接引用)
```

**零改动继承资产**:`gui/` i18n 字典(179×3 键)、互操作 fixture、`installer/VERSION`(版本单一事实源)、规范文档 §4.7 双轨规则、签名证书与 `ASTBOX_SIGN_*` 流程、`scripts/` 驱动脚本。

## P0 — Spike(3–5 天)【未知水域清零】

| # | 验证项 | 通过标准 |
|---|---|---|
| 1 | Tauri v2 + NSIS `embedBootstrapper` 全链(含 Authenticode 注入) | 已签安装包,干净无 WebView2 机上安装即用 |
| 2 | `offlineInstaller` 附加版独立打包 | 双包并存;默认包体积仍 ~6–8 MB |
| 3 | rfd 对话框 + 4 GiB 文件路径直读 + `Channel` 进度回推 | 前端实时进度,内存恒定 |
| 4 | tauri-specta 类型生成链 | TS 侧 command 类型编译期可用 |
| 5 | 锁版本清单(`Cargo.lock` / `package-lock.json` 入库) | 全依赖钉版落档 |

**DoD:五个未知全部有书面结论。**

## P1 — 核心 `astbox-core`(2–3 周)

- **蓝本策略**:C# `Astbox.Core` 逐行翻译(`Constants/Errors/CborDet/Crypto/Container/Creator/Modifier/Extractor/PassboxFile/QrUtil/BinWriter`),不做重构——翻译保真优先。
- 依赖:`argon2` / `chacha20poly1305`(XChaCha)/ `hkdf` / `hmac` / `sha2` / `zeroize` / `qrcode`。
- 安全语义:`zeroize` 覆盖 VaultKey/凭据/派生密钥路径;失败一律 fail-closed;凭据错误统一 `ASTBOX_E_AUTHENTICATION_FAILED`。
- **DoD:双向字节兼容证明**——封包/解包/修改/传播包四路径,C# 产物 ↔ Rust 产物字节一致;篡改用例全拒;36 项语义等价转 `cargo test`。

## P2 — CLI `astbox-cli`(3–4 天,可与 P1 后半并行)

- clap 子命令对齐:`selftest / info / unlock / extract / create / add / verify / --import-passbox`。
- 文本输出不改(脚本兼容);`selftest` 内置向量 = P1 fixture 的 CLI 出口。

## P3 — Tauri 壳 + IPC 层(1 周)

- 20 个 `/api/*` 端点语义 → Tauri commands(`state / open / nav / unlock / totp / extract / pack / add / verify / selftest / outdir / browse / export_passbox / shutdown …`),serde 结构体 + `Result<T, ApiError{code,message}>`。
- tauri-specta 生成 TS 绑定,P4 直接 import(契约从运行时测试升级为编译期保障)。
- 插件:`single-instance`(替代端口级联)、`deep-link`(ms-settings 回跳)、`dialog`/rfd、`opener`。
- `gui/` 静态文件入 bundle(P4 完成前先 serve 现版过渡)。

## P4 — TS 前端(1.5–2 周,与 P1 并行)

| 项 | 处置 |
|---|---|
| 蓝本 | `gui/app.js` ~1.9k 行 TS 模块化:`{state, i18n, api, ui/{menu,sheet,toast,otp}, views/*}` |
| i18n | 179×3 字典与引擎原样平移(纯数据);`_t/_fmt/_applyStatic` 五属性扫描不变;语言按钮(当前代码 + 下拉)照搬 |
| API 层 | `fetch("/api/…")` → `invoke()`;错误通道 `code+message` 与现 toast 行为对齐 |
| 4 GiB | 上传路径删除 → "选文件→传路径→Rust 直读 + Channel 进度"(P0#3 结论) |
| 拖放 | Tauri drag-drop 事件替换浏览器 DnD |
| 验收 | 视觉/交互 1:1 对齐现有截图基线;`vitest` 冒烟(i18n 完整性复用 audit 思路) |

**纪律:不做"顺手改进"。**

## P5 — 系统集成(1–1.5 周)

| 项 | 方案 | 经验引用 |
|---|---|---|
| DPAPI secrets.bin | `windows` crate FFI `CryptProtectData/Unprotect`;文件格式逐字节照抄(`ASTBOX1\0` + blob + JSON vid)→ 与 C# 版密钥库互通 | exp.md §S2-3 |
| 关联治理 | `winreg` 全量平移:ProgId/Capabilities/RegisteredApplications、确权检测、悬空 UserChoice 自愈、深链 | exp.md §关联 |
| S2′ 迁移 | Rust 首跑检测旧 Inno/MSI 版 → 静默卸载 + 密钥库接管(翻译现 CustomAction 语义) | exp.md §S2 |
| 图标 | `app.ico` 嵌 tauri.conf;关联 DefaultIcon 指向安装的 `astbox.ico`(双图标分离) | exp.md §关联-契约 |

## P6 — 安装器换代(1 周)

| 产物 | 构成 |
|---|---|
| 默认包(NSIS) | `embedBootstrapper`,~6–8 MB,Authenticode 签名 |
| offlineInstaller 附加版 | +WebView2 Standalone(~130 MB),独立文件名,面向断网/LTSC;不碰默认包 |

- `installer/VERSION` 继续为唯一版本源,构建脚本注入 `tauri.conf.json`(替换 `#define` 机制)。
- NSIS 卸载段:关联清理 / 密钥库保留策略与现版对齐。
- `build_cs.ps1` 改造:ISCC/WiX → `tauri build` + 双产物签名;`manifest.json` channels 更新(`slim/chromium/msi` → `nsis/offline`)。

## P7 — 验收(1 周)

- 三方字节兼容终验(C#/Python/Rust 互开 demo 容器)。
- GUI 行为清单逐项过(状态机/Sheet/Toast/OTP/拖放/三语切换/主题)。
- 安装矩阵:有 WebView2 机装默认包 / 无 WebView2 机装 offline 包 / 旧版共存→S2′ 迁移 / 卸载残留检查。
- 关联矩阵:悬空自愈 / 深链确权 / 图标缓存刷新三件套(SHCNE_ASSOCCHANGED + iconcache 重建 + Explorer 重启)。
- SAC/SmartScreen playbook 沿用(新哈希等待-重试纪律)。

## P8 — 交付(2–3 天)

- dist 双通道 + manifest 更新;README 四节同步(构建/产物/WebView2 兜底);规范 §4.6 登记新实现行;旧 C# 链**归档不删**(双轨惯例,应急回退)。

## 风险登记册

| # | 风险 | 缓解 |
|---|---|---|
| 1 | CBOR 严格语义翻译遗漏 | P1 DoD = fixture 100%;拒绝用例逐条对照 |
| 2 | offlineInstaller 签名/体积失控 | P0#2 提前实测 |
| 3 | Tauri v2 生态 API 漂移 | P0#5 锁版本;升级只在里程碑间 |
| 4 | S2′ 迁移边界(多形态历史共存) | P7 安装矩阵全跑;旧链保留应急回退 |
| 5 | TS 重写行为漂移 | 截图基线 + 交互清单;禁止顺手改进 |
| 6 | WebView2 Evergreen 更新引入回归 | P0#5 锁可接受版本带;重大升级走验收后放量 |

## 关键决策记录(已锁定)

1. Rust 仅桌面单形态(4 GiB 走路径直读)——server 双形态方案搁置。
2. 默认小包(embedBootstrapper)+ offlineInstaller 附加版。
3. C# 逐行翻译不做重构;重构窗口在验收后。
4. fixture / 规范 / VERSION / 签名流程四资产延续。
5. gui 字典平移、壳重写;不做"顺手改进"。
