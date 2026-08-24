@echo off
setlocal EnableExtensions
chcp 65001 >nul
set "DEST=%LOCALAPPDATA%\Programs\Astbox"
echo Stopping ASTBOX service...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='pythonw.exe'\" | Where-Object { $_.CommandLine -like '*astbox_server*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1
timeout /t 1 /nobreak >nul
reg delete "HKCU\Software\Classes\.astbox" /f >nul 2>&1
reg delete "HKCU\Software\Classes\.passbox" /f >nul 2>&1
reg delete "HKCU\Software\Classes\Astbox.Passbox" /f >nul 2>&1
reg delete "HKCU\Software\Classes\Astbox.Container" /f >nul 2>&1
reg delete "HKCU\Software\Astbox" /f >nul 2>&1
reg delete "HKCU\Software\RegisteredApplications" /v "ASTBOX Container Manager" /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\{8F4A2C63-9D1E-4B57-A6F3-2E5C7A90D411}_is1" /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\{8F4A2C63-9D1E-4B57-A6F3-2E5C7A90D411}" /f >nul 2>&1
del "%USERPROFILE%\Desktop\ASTBOX.lnk" >nul 2>&1
rmdir /s /q "%DEST%"
echo [OK] ASTBOX removed (.astbox association unregistered).
pause
