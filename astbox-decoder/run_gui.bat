@echo off
rem ASTBOX v1.0 Decoder - Liquid Glass Web UI launcher (default)
rem Classic tkinter UI: run_gui_classic.bat
chcp 65001 >nul
cd /d "%~dp0"

set "LAUNCHER=pythonw"
where pythonw >nul 2>nul
if errorlevel 1 set "LAUNCHER=python"
where %LAUNCHER% >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 Python，请安装 Python 3.10+ 并加入 PATH 后重试。
    pause
    exit /b 1
)

if not exist "deps\argon2" (
    echo [首次运行] 正在安装依赖（argon2-cffi / pynacl / cffi）...
    python bootstrap_deps.py
    if errorlevel 1 (
        echo.
        echo 依赖安装失败，请检查网络后重试。
        pause
        exit /b 1
    )
)

del /q server_error.log >nul 2>&1
start "" %LAUNCHER% astbox_server.py
ping -n 3 127.0.0.1 >nul
if exist server_error.log (
    echo [!] 检测到启动错误，日志内容：
    type server_error.log
    echo.
    pause
)
exit /b 0
