; ASTBOX 容器管理器 — Inno Setup 6 安装脚本(C#/.NET 10 NativeAOT 布局)
; 按用户安装(无需管理员)，注册 .astbox 关联与默认应用能力。
; 产物布局由 installer/build_cs.ps1 装配到 stage/Astbox。
;
; 编译开关:
;   /DAppVersionNum=2.0.1C#     版本号(build_cs.ps1 自动跟随 VERSION)
;   /DAppVersionLabel=V2.0.1C#  显示版本(含 C# 后缀)
;   /DNoDesktopIcon             跳过桌面快捷方式
;   /DNoIcons                   跳过全部快捷方式(自动化测试用)
;   /DChromiumBuild             内核版命名

#ifndef AppVersionNum
#define AppVersionNum "2.0.1C#"
#endif
#ifndef AppVersionLabel
#define AppVersionLabel "V2.0.1C#"
#endif

#define MyAppName "ASTBOX 容器管理器"
#define MyServerExe "astbox-server.exe"
#define MyCliExe "astbox-cli.exe"

#ifdef ChromiumBuild
#define MyChannelSuffix "-Chromium"
#define MyVerSuffix " (Chromium 内核版)"
#else
#define MyChannelSuffix ""
#define MyVerSuffix ""
#endif

[Setup]
AppId={{8F4A2C63-9D1E-4B57-A6F3-2E5C7A90D412}
AppName={#MyAppName}{#MyVerSuffix}
AppVersion={#AppVersionNum}
AppVerName=ASTBOX {#AppVersionLabel}{#MyVerSuffix}
AppPublisher=ASTBOX
DefaultDirName={localappdata}\Programs\Astbox
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
OutputDir=dist
OutputBaseFilename=AstboxSetup-{#AppVersionLabel}{#MyChannelSuffix}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ShowLanguageDialog=yes
SetupIconFile=assets\astbox.ico
UninstallDisplayIcon={app}\assets\astbox.ico

[Languages]
; 简体中文置首:系统语言未命中任何选项时的默认回退语言
Name: "chs"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "en";  MessagesFile: "compiler:Default.isl"
Name: "ja";  MessagesFile: "compiler:Languages\Japanese.isl"
Name: "ru";  MessagesFile: "compiler:Languages\Russian.isl"
Name: "ko";  MessagesFile: "compiler:Languages\Korean.isl"

[Files]
Source: "stage\Astbox\*"; DestDir: "{app}"; \
    Excludes: "*.pdb,NuGet.Config"; Flags: recursesubdirs ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\NOTICE"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
#ifndef NoIcons
#ifndef NoDesktopIcon
Name: "{userdesktop}\ASTBOX"; \
    Filename: "{app}\{#MyServerExe}"; \
    IconFilename: "{app}\assets\astbox.ico"; \
    Comment: "ASTBOX 容器管理器"
#endif
Name: "{userstartmenu}\Programs\ASTBOX 容器管理器\ASTBOX 容器管理器"; \
    Filename: "{app}\{#MyServerExe}"; \
    IconFilename: "{app}\assets\astbox.ico"
Name: "{userstartmenu}\Programs\ASTBOX 容器管理器\ASTBOX 命令行工具"; \
    Filename: "{app}\{#MyCliExe}"; \
    IconFilename: "{app}\assets\astbox.ico"
Name: "{userstartmenu}\Programs\ASTBOX 容器管理器\卸载 ASTBOX"; \
    Filename: "{uninstallexe}"; \
    Comment: "从本机移除 ASTBOX 容器管理器"
#endif

[InstallDelete]
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
    ValueData: """{app}\{#MyServerExe}"" ""%1"""
; --- 默认应用能力注册(设置页可见) ---
Root: HKCU; Subkey: "Software\Astbox\Capabilities"; \
    ValueType: string; ValueName: "ApplicationName"; \
    ValueData: "{#MyAppName}"
Root: HKCU; Subkey: "Software\Astbox\Capabilities"; \
    ValueType: string; ValueName: "ApplicationIcon"; \
    ValueData: "{app}\assets\astbox.ico"
Root: HKCU; Subkey: "Software\Astbox\Capabilities\FileAssociations"; \
    ValueType: string; ValueName: ".astbox"; \
    ValueData: "Astbox.Container"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\RegisteredApplications"; \
    ValueType: string; ValueName: "ASTBOX"; \
    ValueData: "Software\Astbox\Capabilities"; \
    Flags: uninsdeletevalue
; 清理旧版以中文名注册的条目(深链 registeredAppUser 需 ASCII 名)
Root: HKCU; Subkey: "Software\RegisteredApplications"; \
    ValueType: none; ValueName: "{#MyAppName}"; Flags: deletevalue
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
    ValueType: string; ValueData: "{app}\assets\passbox.ico"
Root: HKCU; Subkey: "Software\Classes\Astbox.Passbox\shell\open\command"; \
    ValueType: string; \
    ValueData: """{app}\{#MyServerExe}"" --import-passbox ""%1"""
Root: HKCU; Subkey: "Software\Astbox\Capabilities\FileAssociations"; \
    ValueType: string; ValueName: ".passbox"; \
    ValueData: "Astbox.Passbox"

[Run]
Filename: "ms-settings:defaultapps?registeredAppUser=ASTBOX"; \
    Description: "确权 .astbox / .passbox 默认打开方式（在系统设置中点选 ASTBOX）"; \
    Flags: shellexec postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\chromium-profile"

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  I: Integer;
  Ext, UcKey, Pid: String;
begin
  if CurStep = ssInstall then
  begin
    // (a) passbox 清障(原有): 让 HKCU Classes 的默认 ProgId 立即生效
    RegDeleteKeyIncludingSubkeys(HKEY_CURRENT_USER,
      'Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.passbox\UserChoice');
    // (b) 双扩展悬空 UserChoice 自愈: 指向已不存在的 ProgId 则移除残留键
    for I := 0 to 1 do
    begin
      if I = 0 then Ext := '.astbox' else Ext := '.passbox';
      UcKey := 'Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\' + Ext + '\UserChoice';
      Pid := '';
      if RegQueryStringValue(HKEY_CURRENT_USER, UcKey, 'ProgId', Pid) then
        if not RegKeyExists(HKEY_CURRENT_USER, 'Software\Classes\' + Pid) then
          RegDeleteKeyIncludingSubkeys(HKEY_CURRENT_USER, UcKey);
    end;
  end;
end;
