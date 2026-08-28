# 已验证语义清单:关联治理 / S2 迁移(经验资产)

> 用途:语言/安装器载体无关的**已验证正确语义**。Tauri(NSIS/Rust 首跑)移植时逐条翻译,禁止重新探索。
> 出处:C# 分支实践(spec §5/§6;提交 `20cd001`、`9a80467`、`b809a0a` 等)+ 修障记录。

## 一、关联治理(spec §5)

### 1.1 注册契约(三通道对齐:iss / wxs / 活动机器)

全部 HKCU per-user,**免管理员**。

| 注册项 | 值 |
|---|---|
| `Software\Classes\.astbox` | `Astbox.Container`(+ `OpenWithProgids` 并行声明,不独占)|
| `Software\Classes\Astbox.Container` | 名称 `ASTBOX 容器`;`shell\open\command` = `"<server>" "%1"` |
| `Software\Classes\.passbox` | `Astbox.Passbox`;command = `"<server>" --import-passbox "%1"` |
| `Software\Classes\Astbox.Container\DefaultIcon` | `astbox.ico,0`(**文件美术**,非应用图标)|
| `Software\Classes\Astbox.Passbox\DefaultIcon` | `passbox.ico,0` |
| `Software\Astbox\Capabilities` | ApplicationName / ApplicationIcon(`app.ico`)/ FileAssociations |
| `Software\RegisteredApplications` | 值名/值 **ASCII `"ASTBOX"`**(见坑 #1)→ 指向 Capabilities |

### 1.2 图标双轨

- **应用本体** `app.ico`:exe 嵌入(ApplicationIcon)、快捷方式、ARP、Capabilities ApplicationIcon。
- **文件关联** `astbox.ico` / `passbox.ico`:仅 DefaultIcon。
- 两轨独立维护;换源图用 `installer/assets/make_ico.ps1`(PNG → 7 帧 16–256 DIB ICO)。

### 1.3 已验证的坑(每条 = 修障结论)

| # | 坑 | 结论 |
|---|---|---|
| 1 | RegisteredApplications 值含本地化字符时设置页枚举异常 | 值一律 **ASCII `"ASTBOX"`**;显示名放 Capabilities.ApplicationName |
| 2 | 旧实现残骸键(如 DefaultIcon → `zipfldr.dll` 占位)| 安装前**逐键 diff 三通道契约**;发现占位即纠正 |
| 3 | MSI 通道注册值缺失(iss 有 wxs 无)| 双通道契约 diff 为**构建前检查**;此坑曾发生于 DefaultIcon |
| 4 | UserChoice 指向已卸载程序 + ProcId 悬空 → 双击静默失败 | 启动时**双向错配检测**(注册表 vs 实际能力)→ 清悬空 → 深链引导 |
| 5 | UserChoice 不可程序化直写 | Windows 10 2020+ 有 hash 校验;**只能清悬空 + 深链 `ms-settings:defaultapps?registeredAppUser=ASTBOX` 引导手动确权** |
| 6 | 图标改后 Explorer 仍显示旧图 | 缓存三件套:`SHCNE_ASSOCCHANGED` 广播 → 删 `iconcache_*.db` → **重启 Explorer**;桌面快捷方式有独立缓存层,需单独刷新/重建 |
| 7 | GUI 无法直测最终显示图标 | 用 Explorer 同款解析器验证:`SHGetFileInfo` 提取 hIcon 非零即链路通(GDI+ `Icon` 类在本机不可靠,勿作探针)|

## 二、S2 无缝迁移(spec §6)

### 2.1 语义(Inno ↔ MSI 换装不丢用户状态)

| # | 语义 | 要点 |
|---|---|---|
| 1 | per-user 安装 + 独立目录 | MSI → `Programs\AstboxMSI`,与 EXE 版目录不冲突,可共存后再迁移 |
| 2 | 首装静默卸载旧版 | MSI deferred CustomAction(Type-50,`Property+ExeCommand` + `CustomActionData`)调 PowerShell;脚本 base64 `-EncodedCommand` 内嵌(绕引号/转义)|
| 3 | **密钥库零成本接管** | `secrets.bin` 格式跨版本稳定:`ASTBOX1\0`(8B magic)+ DPAPI(CurrentUser)blob + JSON(vid)。CurrentUser 作用域 → 同用户迁移免重录 TOTP 凭据。**任何新实现必须原样读写此格式** |
| 4 | 关联自动切换 | 新实现写同名 ProgId 键自然覆盖;无需专门迁移,前提 = 契约一致(§1.1)|
| 5 | 卸载残骸处理 | Inno `unins000.dat` 只读残留 → 清属性后删(错误 5 场景);安装后校验旧目录清理完整 |

### 2.2 验收矩阵(已跑通,新实现直接复用)

1. 无旧版 → 新装(关联/图标/密钥库建立)。
2. 先 EXE 后 MSI(或反向)→ 共存 + S2 迁移;密钥库接管零重录;关联落新实现。
3. 重装/修复(同通道)。
4. 卸载 → 关联清理、密钥库保留策略按约定;残骸检查。
5. 迁移后首轮启动:确权检测/悬空自愈/深链引导各路径。

## 三、移植映射(Tauri 载体)

| 语义 | C# 载体(现状) | Tauri 载体(目标)|
|---|---|---|
| §1.1 契约写入 | iss `[Registry]` / wxs `RegistryValue` | NSIS 段 或 Rust 首跑 `winreg`(二选一,推荐后者:单点实现)|
| §1.2 图标 | make_ico.ps1 产物 | 资产复用,零改动 |
| §1.3-#4/#5 自愈+确权 | Server 启动逻辑(C#)| Rust 首跑/启动逻辑(逐语义翻译)|
| §2.1-#2 静默卸载 | MSI CustomAction(PowerShell)| NSIS 卸载检测段 + Rust 首跑兜底 |
| §2.1-#3 密钥库 | DPAPI FFI(ProtectedData 包)| `windows` crate FFI,**格式字节不变** |
| §2.2 矩阵 | 人工/脚本 | 直接作为 P7 用例 |

> 纪律:翻译时以本清单为准逐条勾销;任何"顺手改进"需先登记再动工。
