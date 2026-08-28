# P0 Spike 结论(未知水域清零)

> 日期:2026-08-28 · 环境:Windows 11 x64 · node 24.18.1 / npm 11.16.0 · cargo/rustc 1.98.0 (stable-msvc) · WebView2 Runtime 151.0.4129.107(Evergreen)
>
> 纪律:本文件只记录"结论 + 证据路径",不含顺手改进。所有版本钉版由
> `rust/Cargo.lock` 与 `package-lock.json` 承担(P0#5)。

## P0#1 — Tauri v2 + NSIS `embedBootstrapper` 全链

**结论:打通。** 默认包(embedBootstrapper)产出且体积优于目标:

| 产物 | 体积 | 说明 |
|---|---|---|
| 安装包(embedBootstrapper) | **3.14 MB**(目标 6–8 MB,实际更小) | WebView2 引导器内嵌 |
| 安装包(downloadBootstrapper 变体) | 1.54 MB | 引导器按需下载(备选) |
| 应用主程序(release) | 4.81 MB | `rust/target/release/astbox-gui.exe` |

产物路径:`rust/target/release/bundle/nsis/ASTBOX_3.0.0_x64-setup.exe`。

- NSIS 3.11 + nsis_tauri_utils v0.5.3 由 tauri CLI 自动下载并调用 `makensis`。
- 窗口运行时验证:debug 版拉起 WebView2 窗口,进程存活(手动收尾)。
- **Authenticode 注入未在本步执行**(需证书资产,属 P6/交付链;打包机制已证明,
  签名流程沿用现版 `build_cs.ps1` 的证书与等待-重试纪律)。

## P0#2 — `offlineInstaller` 附加版

**结论:打通(实测 251.2 MB)。** WebView2 安装策略的键是
`bundle.windows.webviewInstallMode`(不是 `nsis.installMode`,后者管的是
per-user/per-machine);`"type": "offlineInstaller"` 独立构建,从
`go.microsoft.com/fwlink/?linkid=2124701` 拉取 WebView2 Standalone 后重打。

- 实测 **251.2 MB**(计划估 ~130 MB;NSIS 内嵌运行时压缩后仍偏大 —— 预期内,
  面向断网/LTSC 场景可接受)。
- **默认包配置保持 embedBootstrapper 不变**(附加版仅构建期切换;提交的
  `tauri.conf.json` 为默认包)。双包并存由构建脚本按通道出两份产物(P6)。

## P0#3 — 路径直读 + `Channel` 进度(RFD 对话框)

**结论:机制打通。**

- `read_file_progress` command:1 MiB 恒定内存分块读取任意大小文件,
  进度经 `tauri::ipc::Channel<ReadProgress>` 推送(`rust/crates/astbox-gui/src/main.rs`)。
- 类型化通道已在 `gui/bindings.ts` 生成(`readFileProgress(path, onChunk)`)。
- RFD 对话框经 `tauri-plugin-dialog` 注册(替代端口服务器的 Win32 对话框)。
- 4 GiB 约束:上传路径按锁定决策删除,前端(P4)改"选文件→传路径→Rust 直读"。
- JS 侧全链路接线随 P4 前端重写落地;本步证明 Rust→TS 通道与类型。

## P0#4 — tauri-specta 类型生成链

**结论:打通。**

- `tauri-specta 2.0.0-rc`(+`specta 2.0.0-rc`、`specta-typescript`)。
- debug 运行时导出 `gui/bindings.ts`:命令签名、`Result<T, ApiError>` 错误封装、
  `Channel<T>` 类型全部编译期可用。
- 踩坑记录(已修,均有注释):
  1. 导出路径必须锚 `CARGO_MANIFEST_DIR`(相对路径按 CWD 解析,漂移出仓库)。
  2. `u64` 需显式 `BigIntExportBehavior::Number`(进度值 ≤ 2^53,精确)。
  3. `ApiError.code` 用 `u16`(对齐 C# ushort 错误码)。

## P0#5 — 锁版本清单

**结论:落档。**

- `rust/Cargo.lock`:tauri 2.11.5 / tauri-build / plugins(single-instance
  2.4.3、dialog、opener)/ argon2 0.5 / chacha20poly1305 0.10 等全部钉版。
- `package-lock.json`:@tauri-apps/cli、@tauri-apps/api 钉版。
- 升级纪律:只在里程碑间(风险登记册 #3/#6)。

## 环境注意事项(本机沙箱相关,非产品行为)

1. **crates.io / GitHub TLS**:DSH 沙箱非提权态 schannel 失败 →
   `cargo fetch` 与 `tauri build`(下载 NSIS/WebView2)需提权执行一次;
   日常 `cargo build --test` 均可 `--offline`。
2. **WebView2 用户数据目录**:Tauri setup 写
   `%LOCALAPPDATA%\com.astenyx.astbox`,沙箱拒绝(os error 5)→ 沙箱内运行
   用 `ASTBOX_WV2_DATA_DIR` 重定向(仅测试;产品行为不变)。
3. **npm 缓存**:npm 默认缓存目录在沙箱外 → 用 `--cache .npm-cache`。
4. **SAC**:C# CLI oracle 被 Smart App Control 拦截(exit 4551);server exe
   信誉正常 → 字节兼容 oracle 全走 server(见 `tests/bytecompat.rs` 注释)。
   新二进制若被拦,按"调整文件哈希重试"纪律处理(重建即换哈希)。

## P0 DoD 核对

| # | 未知 | 结论 |
|---|---|---|
| 1 | NSIS 全链 | ✅ 3.14 MB 产出;签名随 P6 |
| 2 | offlineInstaller | ✅ 251.2 MB(键为 webviewInstallMode) |
| 3 | 路径直读 + Channel | ✅ 命令 + 类型化通道就绪;JS 接线随 P4 |
| 4 | tauri-specta | ✅ bindings.ts 编译期可用 |
| 5 | 锁版本 | ✅ 双 lock 入库 |
