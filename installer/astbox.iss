; ASTBOX 容器管理器 — Inno Setup 6 安装脚本
; 按用户安装(无需管理员)，注册 .astbox 关联与默认应用能力，
; 安装完成页引导用户在系统设置中确认为默认打开方式。

#define MyAppName "ASTBOX 容器管理器"
#define MyAppVersion "2.0.0"
#define MyAppVerName "ASTBOX V2.0.0"
#define MyAppExeName "pythonw.exe"

; 编译变体: ISCC /DChromiumBuild  →  输出含内核版安装包
#ifdef ChromiumBuild
#define MyOutputName "AstboxSetup-V2.0.0-Chromium"
#define MyVerSuffix " (Chromium 内核版)"
#else
#define MyOutputName "AstboxSetup-V2.0.0"
#define MyVerSuffix ""
#endif

[Setup]
AppId={{8F4A2C63-9D1E-4B57-A6F3-2E5C7A90D411}
AppName={#MyAppName}{#MyVerSuffix}
AppVersion={#MyAppVersion}
AppVerName={#MyAppVerName}{#MyVerSuffix}
AppPublisher=ASTBOX
DefaultDirName={localappdata}\Programs\Astbox
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
OutputDir=dist
OutputBaseFilename={#MyOutputName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
SetupIconFile=assets\astbox.ico
UninstallDisplayIcon={app}\app\assets\astbox.ico

[Files]
Source: "stage\Astbox\*"; DestDir: "{app}"; \
    Flags: recursesubdirs ignoreversion

[Icons]
Name: "{userdesktop}\ASTBOX"; \
    Filename: "{app}\runtime\{#MyAppExeName}"; \
    Parameters: """{app}\app\astbox_server.py"""; \
    IconFilename: "{app}\app\assets\astbox.ico"; \
    Comment: "ASTBOX 容器管理器"
Name: "{userstartmenu}\Programs\ASTBOX 容器管理器\ASTBOX 容器管理器"; \
    Filename: "{app}\runtime\{#MyAppExeName}"; \
    Parameters: """{app}\app\astbox_server.py"""; \
    IconFilename: "{app}\app\assets\astbox.ico"
Name: "{userstartmenu}\Programs\ASTBOX 容器管理器\卸载 ASTBOX"; \
    Filename: "{uninstallexe}"; \
    Comment: "从本机移除 ASTBOX 容器管理器"

[InstallDelete]
; 清理早期版本散落在开始菜单根的游离快捷方式
Type: files; Name: "{userstartmenu}\ASTBOX 容器管理器.lnk"
Type: files; Name: "{userstartmenu}\Programs\ASTBOX 容器管理器.lnk"

[Registry]
; --- .astbox -> ProgId (HKCU，按用户生效) ---
Root: HKCU; Subkey: "Software\Classes\.astbox"; \
    ValueType: string; ValueData: "Astbox.Container"; \
    Flags: createvalueifdoesntexist uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\.astbox\OpenWithProgids"; \
    ValueType: string; ValueName: "Astbox.Container"; ValueData: ""; \
    Flags: createvalueifdoesntexist uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Astbox.Container"; \
    ValueType: string; ValueData: "ASTBOX 容器"; \
    Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Astbox.Container\DefaultIcon"; \
    ValueType: expandsz; ValueData: "%SystemRoot%\system32\zipfldr.dll"
Root: HKCU; Subkey: "Software\Classes\Astbox.Container\shell\open\command"; \
    ValueType: string; \
    ValueData: """{app}\runtime\{#MyAppExeName}"" ""{app}\app\astbox_server.py"" ""%1"""
; --- 默认应用能力注册(设置页可见) ---
Root: HKCU; Subkey: "Software\Astbox\Capabilities"; \
    ValueType: string; ValueName: "ApplicationName"; \
    ValueData: "{#MyAppName}"
Root: HKCU; Subkey: "Software\Astbox\Capabilities"; \
    ValueType: string; ValueName: "ApplicationIcon"; \
    ValueData: "{app}\app\assets\astbox.ico"
Root: HKCU; Subkey: "Software\Astbox\Capabilities\FileAssociations"; \
    ValueType: string; ValueName: ".astbox"; \
    ValueData: "Astbox.Container"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\RegisteredApplications"; \
    ValueType: string; ValueName: "{#MyAppName}"; \
    ValueData: "Software\Astbox\Capabilities"; \
    Flags: uninsdeletevalue
; --- .passbox -> ProgId (传播包, 双击导入) ---
Root: HKCU; Subkey: "Software\Classes\.passbox"; \
    ValueType: string; ValueData: "Astbox.Passbox"; \
    Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\.passbox\OpenWithProgids"; \
    ValueType: string; ValueName: "Astbox.Passbox"; ValueData: ""; \
    Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Astbox.Passbox"; \
    ValueType: string; ValueData: "ASTBOX 传播包"; \
    Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Astbox.Passbox\DefaultIcon"; \
    ValueType: string; ValueData: "{app}\app\assets\passbox.ico"
Root: HKCU; Subkey: "Software\Classes\Astbox.Passbox\shell\open\command"; \
    ValueType: string; \
    ValueData: """{app}\runtime\{#MyAppExeName}"" ""{app}\app\astbox_server.py"" --import-passbox ""%1"""
Root: HKCU; Subkey: "Software\Astbox\Capabilities\FileAssociations"; \
    ValueType: string; ValueName: ".passbox"; \
    ValueData: "Astbox.Passbox"

[Run]
Filename: "ms-settings:defaultapps"; \
    Description: "设为 .astbox 默认打开方式（在系统设置中确认）"; \
    Flags: shellexec postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\chromium-profile"

[Code]
// 清理早期 cmd 安装流遗留的裸 GUID 卸载键(指向不存在的 uninstall.cmd)
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then
  begin
    RegDeleteKeyIncludingSubkeys(HKEY_CURRENT_USER,
      'Software\Microsoft\Windows\CurrentVersion\Uninstall\{8F4A2C63-9D1E-4B57-A6F3-2E5C7A90D411}');
    // 重置用户级选择, 让 HKCU Classes 的默认 ProgId 生效为默认打开方式
    RegDeleteKeyIncludingSubkeys(HKEY_CURRENT_USER,
      'Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.passbox\UserChoice');
  end;
end;
