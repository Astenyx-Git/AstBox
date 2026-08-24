@echo off
rem ASTBOX v1.0 解码器 - 命令行入口
chcp 65001 >nul
cd /d "%~dp0"

if not exist "deps\argon2" (
    echo [首次运行] 正在安装依赖...
    python bootstrap_deps.py
    if errorlevel 1 (
        echo 依赖安装失败，请参见 README.md。
        pause
        exit /b 1
    )
)

python astbox_cli.py %*
exit /b %errorlevel%
