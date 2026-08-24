# -*- coding: utf-8 -*-
"""ASTBOX 无控制台启动入口。

双击此文件（Windows 将 .pyw 关联到 pythonw.exe）即可无命令行窗口启动
液态玻璃 Web UI。任何启动失败都会写入 server_error.log 并弹出对话框，
而不是静默消失。需要查看实时日志请改用 run_gui.bat。
"""
import os
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
if HERE not in sys.path:
    sys.path.insert(0, HERE)


def _fail(stage, exc):
    """记录崩溃日志并弹出错误对话框（pythonw 下没有控制台可看）。"""
    detail = "%s\n\n%s: %s" % (stage, type(exc).__name__, exc)
    tb = traceback.format_exc()
    try:
        with open(os.path.join(HERE, "server_error.log"), "a",
                  encoding="utf-8") as f:
            f.write("[%s] run_gui.pyw crash\n%s\n%s\n"
                    % (__import__("time").strftime("%Y-%m-%d %H:%M:%S"),
                       detail, tb))
    except Exception:
        pass
    try:
        import tkinter as tk
        from tkinter import messagebox
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        messagebox.showerror("ASTBOX 启动失败", detail, parent=root)
        root.destroy()
    except Exception:
        pass
    sys.exit(1)


try:
    import astbox_server
except Exception as exc:            # 依赖缺失/包损坏等
    _fail("无法加载 ASTBOX 服务模块", exc)

try:
    astbox_server.main()
except SystemExit:
    raise
except Exception as exc:            # 运行期致命错误
    _fail("ASTBOX 服务异常退出", exc)
