# P7 验收记录 — Rust + TS 线(Tauri v2)

> 依据 docs/tauri-port-plan.md P7 与 docs/exp.md 已验证语义清单。
> 每项标注:自动测试 / 实机冒烟 / 待人工(签名产物)。

## 1. 字节兼容(三方)

| 项 | 方式 | 结果 |
|---|---|---|
| 容器封包(创建) | C# 服务器 oracle 熵回放 → 逐字节比对 | ✅ cargo test bytecompat 3/3 |
| 容器修改(添加) | 同上(生成代际 ==1 断言,含上游忠实缺陷保留) | ✅ |
| 传播包 | 同上(含中文文件名 `中文&demo'.astbox`) | ✅ |
| 原生测试套件 | fixture 36 项语义转 cargo test | ✅ 25/25(lib)+ 3/3(bytecompat) |
| python 参考 | fixture 契约即 python 版产物语义(C# 线同源沿用) | ✅(经 fixture 间接) |
| 密钥库 | secrets.bin 字节布局(ASTBOX1\0 + DPAPI(CurrentUser) + JSON vid) | ✅ 单测;C# 互开留人工项 |

## 2. GUI 行为清单

| 项 | 状态 | 证据 |
|---|---|---|
| 状态机(empty/locked/unlocked) | ✅ | session.rs 单测 + 迁移自 C# 状态字段逐字段 |
| i18n 179 键 ×3 → 184×3(+导入) | ✅ | vitest audit 9/9(键集对齐/回退链/_fmt/ja _srv) |
| Sheet/Toast/OTP/菜单/主题 | ✅ 1:1 平移 | tsc 0 错;DOM 逻辑与 app.js 逐函数对照 |
| 拖放打开 | ✅ | Tauri drag-drop 事件 → open(path)(锁定决策) |
| 文件选择 | ✅ | dialog 插件 browsePick(路径语义,无上传) |
| 全部按钮/键盘绑定 | ✅ | main.ts bind() 平移;交互手测列 P7 人工项 |

## 3. 安装矩阵

| 场景 | 结果 |
|---|---|
| 静默安装 /S(per-user,免管理员) | ✅ exit 0;exe + 3 ico 落位 |
| 安装版启动 → 契约自愈指向安装路径 | ✅(幂等重写实证) |
| 卸载 → 关联键清理 + secrets.bin 保留 | ✅(NSIS 钩子 + 实证) |
| offline 包(251.76 MB, WebView2 standalone) | ✅ 产出;装机验证待签名产物人工项 |
| S2′ 检测/静默卸载/密钥库接管 | ✅ 代码就绪(spec §6.2 精确旗标);全矩阵待人工 |

## 4. 关联矩阵(spec §5.4)

| 场景 | 结果 |
|---|---|
| clean machine | ✅ 静默通过(心跳写,无副作用) |
| dangling UserChoice | ✅ 自愈删除(测试) |
| foreign live + 非交互 | ✅ 记录,foreign 键保留,无弹窗无标记(测试) |
| foreign live + 交互 | ✅ epoch 限频弹窗 + 深链(测试 + 首跑接线) |
| 图标缓存刷新三件套 | 📋 人工修障规程(C# 链同样未自动化 —— exp.md §1.3-#6 即修障结论,逐字沿用) |

## 5. SAC/SmartScreen

- 构建脚本 / release exe / NSIS 安装包三轮 4551,均按「新哈希-等待-重试」通过。
- **签名实测(2026-08-28)**:库内 `CN=Astbox` 自签证书(私钥在 CurrentUser\My,
  PFX 备份于 `Desktop\sign\Astbox\`)→ 双产物 `Get-AuthenticodeSignature` 均
  **Valid + DigiCert RFC3161 时间戳**;但 SAC 仍拦截(4551)—— 自签证书无
  受信 CA 链,SAC 只认信誉积累或受信链。签名价值在内部分发(目标机导入
  `Astbox.cer` 进 Trusted Root/Trusted People 后可校验来源);SAC 侧仍靠
  「等待-重试」攒信誉,或换 CA 签发证书。
- build_rs.ps1:新增 `ASTBOX_SIGN_CN`(库内签名模式);签名启用时默认带
  TSA(`ASTBOX_SIGN_TS=''` 可关闭)。

## 6. 遗留人工项(签名产物/真机)

1. C# 互开 secrets.bin(跨线 DPAPI CurrentUser 互通)。
2. 无 WebView2 机装 offline 包;有 WebView2 机装默认包(引导器在线拉取)。
3. 旧 Inno/MSI 共存 → S2′ 迁移全矩阵;卸载残骸检查。
4. GUI 交互清单手测(三语切换/主题/拖放/OTP 粘贴)。
5. 图标缓存三件套演练。
