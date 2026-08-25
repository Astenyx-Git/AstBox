@echo off
setlocal EnableExtensions
chcp 65001 >nul
set "DEST=%LOCALAPPDATA%\Programs\Astbox"
set "SRC=%~dp0Astbox"
echo ============================================
echo   ASTBOX - install to %DEST%
echo ============================================
robocopy "%SRC%" "%DEST%" /MIR /NFL /NDL /NJH /NJS >nul
if errorlevel 8 (
  echo [ERROR] copy failed.
  pause
  exit /b 1
)
copy /y "%~dp0uninstall.cmd" "%DEST%\uninstall.cmd" >nul
reg add "HKCU\Software\Classes\.astbox" /ve /d "Astbox.Container" /f >nul
reg add "HKCU\Software\Classes\.astbox\OpenWithProgids" /v "Astbox.Container" /d "" /f >nul
reg add "HKCU\Software\Classes\Astbox.Container" /ve /d "ASTBOX Container" /f >nul
reg add "HKCU\Software\Classes\Astbox.Container\DefaultIcon" /ve /t REG_EXPAND_SZ /d "%%SystemRoot%%\system32\zipfldr.dll" /f >nul
reg add "HKCU\Software\Classes\Astbox.Container\shell\open\command" /ve /d "\"%DEST%\runtime\pythonw.exe\" \"%DEST%\app\astbox_server.py\" \"%%1\"" /f >nul
reg add "HKCU\Software\Classes\.passbox" /ve /d "Astbox.Passbox" /f >nul
reg add "HKCU\Software\Classes\.passbox\OpenWithProgids" /v "Astbox.Passbox" /d "" /f >nul
reg add "HKCU\Software\Classes\Astbox.Passbox" /ve /d "ASTBOX 传播包" /f >nul
reg add "HKCU\Software\Classes\Astbox.Passbox\DefaultIcon" /ve /t REG_EXPAND_SZ /d "%DEST%\app\assets\passbox.ico" /f >nul
reg add "HKCU\Software\Classes\Astbox.Passbox\shell\open\command" /ve /d "\"%DEST%\runtime\pythonw.exe\" \"%DEST%\app\astbox_server.py\" --import-passbox \"%%1\"" /f >nul
reg add "HKCU\Software\Astbox\Capabilities\FileAssociations" /v ".passbox" /d "Astbox.Passbox" /f >nul
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.passbox\UserChoice" /f >nul 2>&1
reg add "HKCU\Software\Astbox\Capabilities" /v ApplicationName /d "ASTBOX Container Manager" /f >nul
reg add "HKCU\Software\Astbox\Capabilities" /v ApplicationIcon /d "%DEST%\app\assets\astbox.ico" /f >nul
reg add "HKCU\Software\Astbox\Capabilities\FileAssociations" /v ".astbox" /d "Astbox.Container" /f >nul
reg add "HKCU\Software\RegisteredApplications" /v "ASTBOX Container Manager" /d "Software\Astbox\Capabilities" /f >nul
set "ARP=HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\{8F4A2C63-9D1E-4B57-A6F3-2E5C7A90D411}_is1"
reg add "%ARP%" /v DisplayName /d "ASTBOX V2.0.1" /f >nul
reg add "%ARP%" /v DisplayVersion /d "2.0.1" /f >nul
reg add "%ARP%" /v DisplayIcon /d "%DEST%\app\assets\astbox.ico" /f >nul
reg add "%ARP%" /v UninstallString /d "cmd /c \"%DEST%\uninstall.cmd\"" /f >nul
reg add "%ARP%" /v NoModify /t REG_DWORD /d 1 /f >nul
reg add "%ARP%" /v NoRepair /t REG_DWORD /d 1 /f >nul
powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $lnk = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\ASTBOX.lnk'); $lnk.TargetPath = '%DEST%\runtime\pythonw.exe'; $lnk.Arguments = '"%DEST%\app\astbox_server.py"'; $lnk.IconLocation = '%DEST%\app\assets\astbox.ico'; $lnk.Save()" >nul 2>&1
echo [OK] installed, .astbox registered.
echo Opening Windows default-apps settings: choose ASTBOX for .astbox
start ms-settings:defaultapps
exit /b 0
