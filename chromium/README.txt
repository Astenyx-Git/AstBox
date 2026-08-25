便携 Chromium（最高优先级 UI 通道）
====================================

把便携版 Chromium 解压到本目录（astbox-decoder\chromium\），
程序启动时会优先使用它以独立应用窗口打开界面。

目录布局（任选其一，自动识别）：
    chromium\chrome.exe
    chromium\Chrome-bin\chrome.exe
    chromium\App\chrome.exe
    chromium\App\Chrome-bin\chrome.exe
    chromium\bin\chrome.exe

也可直接放多层子目录，程序会在 3 层深度内自动搜索 chrome.exe。

说明：
- 内核使用独立的用户数据目录 ..\chromium-profile\，不影响系统浏览器。
- 应用窗口模式下已禁用 F12/DevTools 快捷键与右键菜单（页面内自定义
  右键菜单不受影响）；普通浏览器打开时不受此限制。
- 启动后若内核崩溃或 8 秒内未出现窗口，将自动回退到 Edge 应用窗口
  （随后依次是 Chrome 应用窗口；两者皆无则记录 server_error.log）。
- 删除本目录即可停用该通道。
