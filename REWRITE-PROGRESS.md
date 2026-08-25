# C#/.NET 10 重写进度(跨轮续接用)

目标:见 session goal(goal-7159cfb8)。**不推送 git;默认分支 C#。**

## 布局

```
src/Astbox.Core           net10.0 库(NSec + Konscious.Argon2 + QRCoder)
src/Astbox.Cli            net10.0 AOT exe(asm: astbox-cli)—— Program.cs 待写
src/Astbox.Server         net10.0-windows AOT exe(SDK Web,asm: astbox-server,
                          gui/ 由 csproj 从 astbox-decoder/gui 复制为静态资源)——待写
src/Astbox.TestsRunner    自包含 NativeAOT 测试运行器(astbox-tests.exe)
tests/Astbox.Core.Tests   xUnit(供未来无 SAC 的 CI 使用;本机不可运行,见下)
scripts/ref_probe.py      参考实现中间值探针(排障用)
.aot-smoke                工具链冒烟
```

## 状态(全部完成 ✅)

> 工作区已移除 python 实现(astbox-decoder/):源码受 git 跟踪,需要时从
> https://github.com/Astenyx-Git/AstBox.git 临时克隆(脚本支持 ASTBOX_REF
> 环境变量指向克隆位置)。`gui/` 与 `chromium/`(417MB 内核,不入库)已迁至
> 工作区根目录。python 构建器(installer/build.py、astbox.iss、缓存与旧
> 产物)一并删除;版本源改为 `installer/VERSION`(当前 V2.0.1)。
> `installer/build_cs.py` 默认产出双安装包(精简 + 内核),签名逻辑同原版。

- [x] 脚手架 csproj(5 个)
- [x] Core 全模块移植(Constants/Errors/CborDet/Crypto/Container/Creator/
      Modifier/Extractor/PassboxFile/QrUtil/BinWriter)
- [x] fixtures(demo.astbox + manifest)+ 互操作测试
- [x] **原生测试运行器 36/36 全绿(exit 0)**(xUnit 因 SAC 本机不可运行,
      同断言集以 NativeAOT runner 承载;xUnit 源码保留供 CI)
- [x] **CLI**(.cli-publish\astbox-cli.exe,3.5MB):help/selftest/info/
      unlock--list/extract/create/add 全实测;C# create 的容器由 Python
      参考实现解锁 + verify_full 通过(scripts/cs_roundtrip.py)
- [x] **Server**(src/Astbox.Server/Program.cs ~2600 行,.server-publish\
      astbox-server.exe 16MB):20+ /api/* + 静态 gui 兜底路由;独立实测
      state/index/selftest/open/unlock(DPAPI 记录+实时码)/totp/demo/
      extract/verify 全 200;secrets.bin 与 Python ctypes 双向互认;
      chromium --app 开窗、位置参数开容器、--port/--no-browser/
      --import-passbox 契约逐项实测。子代理终审 **21/21 端点自测通过**,
      gui/app.js 23 处 api() 调用点字段逐一吻合;错误契约四种文案格式
      精确镜像。唯一待人工项:/api/browse 真实弹窗无法无头验证
      (代码逐行对照移植,装机后点一次"浏览…"即可确认)
- [x] **安装器**:installer/build_cs.py + astbox-cs.iss(/DNoDesktopIcon、
      /DNoIcons 测试开关);AstboxSetup-V3.0.0.exe(7.9MB)静默安装
      exit 0,安装后 CLI 自检通过、注册表关联正确、卸载干净

## 已知偏差(忠实移植上游或无影响)

- PS5.1 HEAD→404(Python 版 501;浏览器不用 HEAD)
- /api/add 用解锁验证码自检新代:secret 字节槽必失败 —— Python 参考同构
  同错(modify.py/container.py 上游行为)
- >4GiB 上传由 Kestrel 先拒;argparse 非法 --ui 宽松忽略(vs exit2)
- 测试副作用:用户自己的两个 pythonw 服务(端口 11920)未受影响,但一次
  误连经 **Python 版**服务向真实 %LOCALAPPDATA%\ASTBOX\secrets.bin 注册过
  一个测试容器密钥记录(.tmp-build 容器文件已删),可手动清理该条目

## 关键设计决定与环境备忘(重要!)

1. **Smart App Control = On**:本机禁止加载本地编译的托管 DLL/DLL 式程序集
   (0x800711C7)。因此:
   - 测试以 `src/Astbox.TestsRunner`(PublishAot 单文件原生 exe)运行;
     xUnit 项目保留但 `dotnet test` 在本机不可用。
   - 新编译的原生 exe 偶发被 SAC 云端信誉拦截 → 重试或等待;崩溃过的二进制
     更易被拉黑(务必保持测试进程零崩溃)。
2. **NSec 的 AEAD 在本机不可靠**:`SecureMemoryHandle` 受保护内存导致加密输出
   错误(A15D21A7… vs 正确 BD6D179D…)。已改为**直接 P/Invoke libsodium**
   (`crypto_aead_xchacha20poly1305_ietf_encrypt`)。
3. **libsodium 的 AEAD decrypt 导出在本机 NativeAOT 下必崩**(0xC0000005,
   encrypt/stream 均正常)。解密改为:**crypto_stream_xchacha20_xor 取原始密钥流
   (含 counter=0 块)+ 托管 Poly1305 验签**。布局:otk=raw[0..32],
   ct-keystream=raw[64..](counter0 后 32B 弃用!勿再用偏移 32)。
4. **Argon2id 双路径**:ASTBOX 槽盐 32B 且可能 p>1,而 NSec/libsodium 强制
   16B 盐+p=1。主路径 = Konscious.Security.Cryptography.Argon2 1.3.1(纯托管,
   MemorySize 单位 KiB);16B 盐+p=1 时走 NSec 快速路径;Selftest 双向交叉验证。
5. **InvariantGlobalization 禁止**:NFC 归一化(CBOR 规范文本)在不变模式下
   静默失效,破坏字节兼容。所有面向 ASTBOX 的工程不得启用。
6. LibraryImport 要求外层类 partial(Crypto 已标)且 AllowUnsafeBlocks=true。
7. dotnet restore/publish 需提权(NuGet TLS);python 3.14 + deps/ 可直接跑参考实现。

## Python → C# 映射

constants→Constants, errors→E/AstboxError(含 OriginalCode 透传),
cbor_det→CborDet, crypto→Crypto, container→Container 系列, create→Creator,
modify→Modifier, extract→Extractor, passbox→PassboxFile, qrutil→QrUtil,
astbox_cli→Astbox.Cli, astbox_server→Astbox.Server(minimal API,端点契约不变)。
