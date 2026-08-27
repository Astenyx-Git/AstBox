# -*- coding: utf-8 -*-
# Copyright 2026 Astenyx-Git
# SPDX-License-Identifier: Apache-2.0
"""gen_wxs.py — 由 stage/Astbox 负载树生成 WiX v4 语法的 MSI 源文件。

参考 C# 分支 installer/wix/{AstboxChromium.wxs,gen_wxs.ps1}(7c0bfbb,2dcca4a):
  per-user(LocalAppData\\Programs\\AstboxMSI) + S2 无缝迁移
  (检测旧 Inno 版注册表项, 静默卸载后再装) + 文件关联/默认应用能力。
本移植差异:
  - 负载为本分支 Python 运行时树(app/runtime/chromium/...), 组件数远超 91,
    因此每次构建由本脚本全量收割生成(wxs 为构建产物, 已 gitignore);
  - 目录按 stage 真实层级**嵌套**声明; 组件统一置于 Feature 下并以
    Directory 属性指向目标(WiX 合法写法) —— 目标路径沿嵌套链解析,
    保证 auto-GUID 唯一且安装布局正确(平铺会让同名叶子目录相撞);
  - 排除 __pycache__ 与 *.pyc(可再生缓存, 无需入包);
  - S2 目标 AppId 为本分支 Inno 的 {8F4A2C63-...-2E5C7A90D411}, PS 迁移
    脚本在生成期注入 GUID 并 UTF-16LE 编码, 不硬编码 base64;
  - 启动命令形态与 astbox.iss 一致: pythonw.exe "app\\astbox_server.py";
  - 开始菜单组挂在 ProgramMenuFolder(分支版误挂在安装目录下, 此处修正);
  - Capabilities 图标用文件路径而非 Icon 引用(分支的 [#AppIco] 无法解析)。

用法: python installer/gen_wxs.py
输出: installer/wix/AstboxChromium.wxs
"""
import base64
import hashlib
import os
import posixpath
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
STAGE = os.path.join(HERE, "stage", "Astbox")
OUT_WXS = os.path.join(HERE, "wix", "AstboxChromium.wxs")

APP_VERSION = "V3.0.0"                      # 与 build.py 一致
MSI_VERSION = APP_VERSION.lstrip("V")       # MSI 需要 x.y[.z]
PRODUCT_NAME = "ASTBOX 容器管理器 %s (MSI)" % APP_VERSION
MANUFACTURER = "ASTBOX"
UPGRADE_CODE = "C8D9A4E2-5F17-4B3A-8E60-91D2C4B7A653"   # 本分支 MSI 产品线固定码
INNO_APPID = "{8F4A2C63-9D1E-4B57-A6F3-2E5C7A90D411}"   # 本分支 Inno AppId(astbox.iss)
INNO_KEY = INNO_APPID + "_is1"
MENU_GROUP = "ASTBOX 容器管理器"
LANG_ZH_CN = 2052
EXCLUDE_DIR = {"__pycache__"}
EXCLUDE_EXT = {".pyc"}

S2_PS_TEMPLATE = r"""
$k = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{GUID}_is1'
$p = Get-ItemProperty -LiteralPath $k -ErrorAction SilentlyContinue
if ($p) {{
  $exe = $null
  $c = $p.QuietUninstallString
  if (-not $c) {{ $c = $p.UninstallString }}
  if ($c) {{
    $t = $c.Trim()
    if ($t.StartsWith('"')) {{
      $j = $t.IndexOf('"', 1)
      if ($j -gt 1) {{ $exe = $t.Substring(1, $j - 1) }}
    }} else {{
      $sp = $t.IndexOf(' ')
      if ($sp -gt 0) {{ $exe = $t.Substring(0, $sp) }} else {{ $exe = $t }}
    }}
  }}
  if ($exe -and (Test-Path -LiteralPath $exe)) {{
    Start-Process -FilePath $exe -ArgumentList '/SILENT','/SUPPRESSMSGBOXES','/NORESTART' -PassThru -Wait | Out-Null
  }}
}}
exit 0
""".strip()


def b64_ps(script):
    """PowerShell -EncodedCommand 需要 UTF-16LE 的 base64。"""
    return base64.b64encode(script.encode("utf-16-le")).decode("ascii")


def dir_id(rel_dir):
    if not rel_dir:
        return "INSTALLFOLDER"
    return "D_" + hashlib.md5(rel_dir.lower().encode("utf-8")).hexdigest()[:10]


def comp_id(rel_file):
    return "C_" + hashlib.md5(rel_file.lower().encode("utf-8")).hexdigest()[:16]


def file_id(rel_file):
    return "F_" + hashlib.md5(rel_file.lower().encode("utf-8")).hexdigest()[:16]


def harvest(stage):
    """返回 (dirs, files)。dirs 含 '' 与全部中间目录; 排除缓存。"""
    dirs, files = {""}, []
    for base, sub, names in os.walk(stage):
        rel = os.path.relpath(base, stage).replace("\\", "/")
        rel = "" if rel == "." else rel
        sub[:] = [s for s in sub if s not in EXCLUDE_DIR]
        for n in names:
            if os.path.splitext(n)[1].lower() in EXCLUDE_EXT:
                continue
            files.append((rel + "/" + n if rel else n, os.path.join(base, n)))
        for s in sub:
            dirs.add((rel + "/" + s) if rel else s)
    return sorted(dirs), sorted(files, key=lambda t: t[0].lower())


def esc(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;")
             .replace(">", "&gt;").replace('"', "&quot;"))


def gen():
    if not os.path.isdir(STAGE):
        raise SystemExit("stage 不存在, 请先运行 build.py 的 staging 步骤: %s" % STAGE)
    dirs, files = harvest(STAGE)
    # LICENSE/NOTICE/Astbox.cer 已由 write_installer_scripts 放入 stage 根,
    # 无需(也不得)从仓库顶层补拷, 否则产生重复组件(WIX0369)。
    icon_src = os.path.join(STAGE, "app", "assets", "astbox-app.ico")
    if not os.path.isfile(icon_src):
        raise SystemExit("缺少应用图标: " + icon_src)

    pyw_rel = next((f for f, _ in files
                    if f.lower().endswith("runtime/pythonw.exe")), None)
    if not pyw_rel:
        raise SystemExit("stage 负载中缺少 runtime/pythonw.exe")

    # 嵌套目录树: node = {dirs:{leaf:node}, path:rel}
    root_node = {"dirs": {}, "path": ""}
    for d in dirs:
        if not d:
            continue
        node = root_node
        for part in d.split("/"):
            node = node["dirs"].setdefault(part, {"dirs": {}, "path": ""})
    for d in dirs:
        if not d:
            continue
        node = root_node
        for part in d.split("/"):
            node = node["dirs"][part]
        node["path"] = d
    for rel, _src in files:
        node = root_node
        for part in filter(None, posixpath.dirname(rel).split("/")):
            node = node["dirs"][part]
        node.setdefault("files", []).append(rel)

    files_map = {rel: src for rel, src in files}

    L = []
    a = L.append
    a('<?xml version="1.0" encoding="UTF-8"?>')
    a('<!-- 由 installer/gen_wxs.py 生成, 请勿手工编辑; 模板思想源自 C# 分支 7c0bfbb/2dcca4a -->')
    a('<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs">')
    a('  <Package Name="%s"' % esc(PRODUCT_NAME))
    a('           Manufacturer="%s"' % esc(MANUFACTURER))
    a('           Version="%s"' % MSI_VERSION)
    a('           UpgradeCode="%s"' % UPGRADE_CODE)
    a('           Scope="perUser"')
    a('           Compressed="yes"')
    a('           Language="%d"' % LANG_ZH_CN)
    a('           InstallerVersion="500">')
    a('    <SummaryInformation Description="ASTBOX 容器管理器(Chromium 内核版, MSI)" />')
    a('    <MajorUpgrade DowngradeErrorMessage="已安装更新版本的 ASTBOX, 无法降级。(错误 1)" />')
    a('    <MediaTemplate EmbedCab="yes" CompressionLevel="high" />')
    a('    <Icon Id="AppIco" SourceFile="%s" />' % esc(icon_src))
    a('    <Property Id="ARPPRODUCTICON" Value="AppIco" />')

    # ---- S2 无缝迁移: 探测旧 Inno 版(HKCU Uninstall\<appid>_is1) ----
    a('    <Property Id="INNO_QUIET">')
    a('      <RegistrySearch Type="raw" Id="RS_InnoQuiet" Root="HKCU"')
    a('          Key="Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\%s"' % esc(INNO_KEY))
    a('          Name="QuietUninstallString" />')
    a('    </Property>')
    a('    <Property Id="INNO_UNINST">')
    a('      <RegistrySearch Type="raw" Id="RS_InnoUninst" Root="HKCU"')
    a('          Key="Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\%s"' % esc(INNO_KEY))
    a('          Name="UninstallString" />')
    a('    </Property>')
    a('    <CustomAction Id="SetPsFull" Property="PS_FULL"')
    a('                  Value="[SystemFolder]WindowsPowerShell\\v1.0\\powershell.exe" />')
    a('    <CustomAction Id="SetS2Data" Property="S2InnoMigrate"')
    a('                  Value="[PS_FULL]" />')
    a('    <CustomAction Id="S2InnoMigrate" Execute="deferred" Impersonate="yes"')
    a('                  Property="PS_FULL"')
    a('                  ExeCommand="powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -EncodedCommand %s"' % b64_ps(S2_PS_TEMPLATE.replace("{GUID}", INNO_APPID.strip("{}"))))
    a('                  Return="check" />')
    a('    <InstallExecuteSequence>')
    a('      <Custom Action="SetPsFull" After="AppSearch" />')
    a('      <Custom Action="SetS2Data" After="SetPsFull" />')
    a('      <Custom Action="S2InnoMigrate" After="InstallFiles" Condition="INNO_QUIET OR INNO_UNINST" />')
    a('    </InstallExecuteSequence>')

    # ---- 目录树(真实嵌套) ----
    def emit_dirs(node, indent):
        for leaf, child in sorted(node["dirs"].items()):
            a('%s<Directory Id="%s" Name="%s">' % (indent, dir_id(child["path"]), esc(leaf)))
            emit_dirs(child, indent + "  ")
            a('%s</Directory>' % indent)

    a('    <StandardDirectory Id="LocalAppDataFolder">')
    a('      <Directory Id="PROGRAMS_LOC" Name="Programs">')
    a('        <Directory Id="INSTALLFOLDER" Name="AstboxMSI">')
    emit_dirs(root_node, "          ")
    a('        </Directory>')
    a('      </Directory>')
    a('    </StandardDirectory>')
    a('    <StandardDirectory Id="ProgramMenuFolder">')
    a('      <Directory Id="DIR_MENUGROUP" Name="%s" />' % esc(MENU_GROUP))
    a('    </StandardDirectory>')
    a('    <StandardDirectory Id="DesktopFolder" />')

    # ---- 组件: 统一置于 Feature, 以 Directory 属性指向嵌套目录 ----
    a('    <Feature Id="Main" Level="1">')
    a('      <Component Id="CMP_MENUGROUP" Directory="DIR_MENUGROUP">')
    a('        <RegistryValue Root="HKCU" Key="Software\\Astbox\\MSI" Name="startMenuGroup" Type="integer" Value="1" KeyPath="yes" />')
    a('        <RemoveFolder Directory="DIR_MENUGROUP" On="uninstall" />')
    a('      </Component>')

    def emit_comps(node, indent):
        for rel in node.get("files", []):
            a('%s<Component Id="%s" Directory="%s">'
              % (indent, comp_id(rel), dir_id(posixpath.dirname(rel))))
            a('%s  <File Id="%s" Name="%s" Source="%s" />'
              % (indent, file_id(rel), esc(os.path.basename(rel)),
                 esc(files_map[rel])))
            if rel == pyw_rel:
                a('%s  <Shortcut Id="SC_Desktop" Directory="DesktopFolder" Name="ASTBOX" Icon="AppIco" WorkingDirectory="INSTALLFOLDER" />' % indent)
                a('%s  <Shortcut Id="SC_StartMenu" Directory="DIR_MENUGROUP" Name="ASTBOX 容器管理器" Icon="AppIco" WorkingDirectory="INSTALLFOLDER" />' % indent)
            a('%s</Component>' % indent)
        for child in node["dirs"].values():
            emit_comps(child, indent)

    emit_comps(root_node, "      ")

    # ---- 文件关联 + 默认应用能力(与 astbox.iss [Registry] 等价的 MSI 版) ----
    pyw_file_ref = file_id(pyw_rel)
    a('      <Component Id="CMP_ASSOC" Directory="INSTALLFOLDER">')
    a('        <RegistryValue Root="HKCU" Key="Software\\Classes\\.astbox" Type="string" Value="Astbox.Container" KeyPath="yes" />')
    a('        <RegistryValue Root="HKCU" Key="Software\\Classes\\.astbox\\OpenWithProgids" Name="Astbox.Container" Type="string" Value="" />')
    a('        <RegistryValue Root="HKCU" Key="Software\\Classes\\Astbox.Container" Type="string" Value="ASTBOX 容器" />')
    a('        <RegistryValue Root="HKCU" Key="Software\\Classes\\Astbox.Container\\DefaultIcon" Type="string" Value="[INSTALLFOLDER]app\\assets\\astbox.ico,0" />')
    a('        <RegistryValue Root="HKCU" Key="Software\\Classes\\Astbox.Container\\shell\\open\\command" Type="string" Value="&quot;[#%s]&quot; &quot;[INSTALLFOLDER]app\\astbox_server.py&quot; &quot;%%1&quot;" />' % pyw_file_ref)
    a('        <RegistryValue Root="HKCU" Key="Software\\Classes\\.passbox" Type="string" Value="Astbox.Passbox" />')
    a('        <RegistryValue Root="HKCU" Key="Software\\Classes\\.passbox\\OpenWithProgids" Name="Astbox.Passbox" Type="string" Value="" />')
    a('        <RegistryValue Root="HKCU" Key="Software\\Classes\\Astbox.Passbox" Type="string" Value="ASTBOX 传播包" />')
    a('        <RegistryValue Root="HKCU" Key="Software\\Classes\\Astbox.Passbox\\DefaultIcon" Type="string" Value="[INSTALLFOLDER]app\\assets\\passbox.ico" />')
    a('        <RegistryValue Root="HKCU" Key="Software\\Classes\\Astbox.Passbox\\shell\\open\\command" Type="string" Value="&quot;[#%s]&quot; &quot;[INSTALLFOLDER]app\\astbox_server.py&quot; --import-passbox &quot;%%1&quot;" />' % pyw_file_ref)
    a('        <RegistryValue Root="HKCU" Key="Software\\Astbox\\Capabilities" Name="ApplicationName" Type="string" Value="ASTBOX 容器管理器" />')
    a('        <RegistryValue Root="HKCU" Key="Software\\Astbox\\Capabilities" Name="ApplicationIcon" Type="string" Value="[INSTALLFOLDER]app\\assets\\astbox.ico" />')
    a('        <RegistryValue Root="HKCU" Key="Software\\Astbox\\Capabilities\\FileAssociations" Name=".astbox" Type="string" Value="Astbox.Container" />')
    a('        <RegistryValue Root="HKCU" Key="Software\\Astbox\\Capabilities\\FileAssociations" Name=".passbox" Type="string" Value="Astbox.Passbox" />')
    a('        <RegistryValue Root="HKCU" Key="Software\\RegisteredApplications" Name="ASTBOX" Type="string" Value="Software\\Astbox\\Capabilities" />')
    a('      </Component>')

    # 组件均定义于 Feature 内部, 归属自动生效 —— 不可再加 ComponentRef(WIX0130)
    a('    </Feature>')
    a('  </Package>')
    a('</Wix>')

    os.makedirs(os.path.dirname(OUT_WXS), exist_ok=True)
    with open(OUT_WXS, "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")
    log("gen_wxs: %d 目录 / %d 文件组件 -> %s" % (len(dirs), len(files), OUT_WXS))


def log(msg):
    print("[gen_wxs] %s" % msg)


if __name__ == "__main__":
    if sys.stdout is not None and hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    gen()
