# Generates installer/wix/AstboxChromium.wxs from the current stage tree.
# WiX v4/v6 schema (pinned toolchain: wix 6.0.2). Zero heat dependency.
param(
    [string]$StageDir = 'D:\New_LANG\C#-astbox\installer\stage\Astbox',
    [string]$OutWxs   = 'D:\New_LANG\C#-astbox\installer\wix\AstboxChromium.wxs',
    [string]$VersionLabel = 'V3.0.0C#',
    [string]$RepoRoot = 'D:\New_LANG\C#-astbox'
)

$ErrorActionPreference = 'Stop'

$UpgradeCode   = 'B7E3A2D1-4C5F-46E8-9A21-D0F3B6C8E512'      # 固定不变
$InnoUninstKey = '{8F4A2C63-9D1E-4B57-A6F3-2E5C7A90D412}_is1'

$migratePs = @'
$k='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{8F4A2C63-9D1E-4B57-A6F3-2E5C7A90D412}_is1'
$p=Get-ItemProperty -LiteralPath $k -ErrorAction SilentlyContinue
if($p){
  $exe=$null
  $c=$p.QuietUninstallString
  if(-not $c){ $c=$p.UninstallString }
  if($c){
    $t=$c.Trim()
    if($t.StartsWith('"')){
      $j=$t.IndexOf('"',1)
      if($j -gt 1){ $exe=$t.Substring(1,$j-1) }
    } else {
      $sp=$t.IndexOf(' ')
      if($sp -gt 0){ $exe=$t.Substring(0,$sp) } else { $exe=$t }
    }
  }
  if($exe -and (Test-Path -LiteralPath $exe)){
    $pr=Start-Process -FilePath $exe -ArgumentList '/SILENT','/SUPPRESSMSGBOXES','/NORESTART' -PassThru -Wait
  }
}
exit 0
'@
$b64 = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($migratePs))

function Esc([string]$s) {
    $s.Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;').Replace('"', '&quot;')
}
function SafeId([string]$s) { $s -replace '[^A-Za-z0-9_.]', '_' }

$allFiles = Get-ChildItem -LiteralPath $StageDir -Recurse -File | Sort-Object FullName

$dirDecls = New-Object System.Collections.Generic.List[string]
$dirSeen  = @{}
$compXml  = New-Object System.Collections.Generic.List[string]
$compRefs = New-Object System.Collections.Generic.List[string]
$idSeen   = @{}
$seq      = 0

function Ensure-DirDecl([string]$relDir) {
    if ($relDir -eq '.' -or [string]::IsNullOrEmpty($relDir)) { return 'INSTALLFOLDER' }
    $did = 'DIR_' + (SafeId $relDir)
    if (-not $script:dirSeen.ContainsKey($did)) {
        $parts = $relDir.Split('/')
        $acc = ''
        foreach ($p in $parts) {
            $acc = if ($acc) { "$acc/$p" } else { $p }
            $pdid = 'DIR_' + (SafeId $acc)
            if (-not $script:dirSeen.ContainsKey($pdid)) {
                $script:dirSeen[$pdid] = 1
                $pn = Split-Path $acc -Leaf
                $script:dirDecls.Add(('      <Directory Id="' + $pdid + '" Name="' + (Esc $pn) + '" />'))
            }
        }
    }
    return $did
}

foreach ($f in $allFiles) {
    $rel = $f.FullName.Substring($StageDir.Length + 1).Replace('\', '/')
    $relDir = Split-Path $rel -Parent
    $dirId = Ensure-DirDecl $relDir

    $seq++
    $fid = 'fil_' + (SafeId ($relDir + '_' + $f.BaseName)) + "_$seq"
    if ($fid.Length -gt 60) { $fid = $fid.Substring(0, 60) }
    while ($idSeen.ContainsKey($fid)) { $seq++; $fid += "_$seq" }
    $idSeen[$fid] = 1
    $cid = 'cmp_' + $fid
    $idSeen[$cid] = 1

    $isServer = ($rel -eq 'astbox-server.exe')
    if ($isServer) { $fid = 'AstboxServerExe' }

    $inner = ('<File Id="{0}" Name="{1}" Source="{2}" />' -f $fid, (Esc $f.Name), (Esc $f.FullName))
    $extra = ''
    if ($isServer) {
        $extra = @'
        <Shortcut Id="SmAstbox" Directory="MENU_ASTBOX" Name="ASTBOX 容器管理器"
                  WorkingDirectory="INSTALLFOLDER" Icon="AppIco" />
        <RemoveFolder Directory="MENU_ASTBOX" On="uninstall" />

'@
    }

    $compRefs.Add($cid)
    $compXml.Add(('      <Component Id="{0}" Directory="{1}">' -f $cid, $dirId))
    $compXml.Add('        ' + $inner)
    if ($extra) { $compXml.Add($extra.TrimEnd()) }
    $compXml.Add('      </Component>')
}

$assocXml = @'
      <Component Id="cmp_Assoc" Directory="INSTALLFOLDER">
        <RegistryValue Root="HKCU" Key="Software\Classes\.astbox" Type="string" Value="Astbox.Container" KeyPath="yes" />
        <RegistryValue Root="HKCU" Key="Software\Classes\.astbox\OpenWithProgids" Name="Astbox.Container" Type="string" Value="" />
        <RegistryValue Root="HKCU" Key="Software\Classes\Astbox.Container" Type="string" Value="ASTBOX 容器" />
        <RegistryValue Root="HKCU" Key="Software\Classes\Astbox.Container\shell\open\command" Type="string" Value="&quot;[#AstboxServerExe]&quot; &quot;%1&quot;" />
        <RegistryValue Root="HKCU" Key="Software\Classes\Astbox.Container\DefaultIcon" Type="string" Value="[INSTALLFOLDER]assets\astbox.ico,0" />
        <RegistryValue Root="HKCU" Key="Software\Classes\.passbox" Type="string" Value="Astbox.Passbox" />
        <RegistryValue Root="HKCU" Key="Software\Classes\.passbox\OpenWithProgids" Name="Astbox.Passbox" Type="string" Value="" />
        <RegistryValue Root="HKCU" Key="Software\Classes\Astbox.Passbox" Type="string" Value="ASTBOX 传播包" />
        <RegistryValue Root="HKCU" Key="Software\Classes\Astbox.Passbox\shell\open\command" Type="string" Value="&quot;[#AstboxServerExe]&quot; --import-passbox &quot;%1&quot;" />
        <RegistryValue Root="HKCU" Key="Software\Classes\Astbox.Passbox\DefaultIcon" Type="string" Value="[INSTALLFOLDER]assets\passbox.ico,0" />
        <RegistryValue Root="HKCU" Key="Software\Astbox\Capabilities" Name="ApplicationName" Type="string" Value="ASTBOX 容器管理器" />
        <RegistryValue Root="HKCU" Key="Software\Astbox\Capabilities" Name="ApplicationIcon" Type="string" Value="[#AppIco]" />
        <RegistryValue Root="HKCU" Key="Software\Astbox\Capabilities\FileAssociations" Name=".astbox" Type="string" Value="Astbox.Container" />
        <RegistryValue Root="HKCU" Key="Software\Astbox\Capabilities\FileAssociations" Name=".passbox" Type="string" Value="Astbox.Passbox" />
        <RegistryValue Root="HKCU" Key="Software\RegisteredApplications" Name="ASTBOX" Type="string" Value="Software\Astbox\Capabilities" />
      </Component>
'@

$cleanupXml = @'
      <Component Id="cmp_ProfileCleanup" Directory="INSTALLFOLDER">
        <RemoveFolder Directory="DIR_PROFILE" On="uninstall" />
        <RegistryValue Root="HKCU" Key="Software\Astbox\MSI" Name="profileCleanup" Type="integer" Value="1" KeyPath="yes" />
      </Component>
'@

$num = $VersionLabel.TrimStart('V') -replace 'C#$', ''
$refs = (($compRefs | ForEach-Object { '      <ComponentRef Id="' + $_ + '" />' }) -join "`n")

$wxs = @"
<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs">
  <Package Name="ASTBOX 容器管理器 $(Esc $VersionLabel) (MSI)"
           Manufacturer="ASTBOX"
           Version="$num"
           UpgradeCode="$UpgradeCode"
           Scope="perUser"
           Compressed="yes"
           Language="2052"
           InstallerVersion="500">
    <SummaryInformation Description="ASTBOX 容器管理器(Chromium 内核版, MSI)" />
    <MajorUpgrade DowngradeErrorMessage="已安装更新版本的 ASTBOX, 无法降级。(错误 1)" />
    <MediaTemplate EmbedCab="yes" CompressionLevel="high" />
    <Icon Id="AppIco" SourceFile="$(Esc $RepoRoot)\installer\assets\astbox.ico" />
    <Property Id="ARPPRODUCTICON" Value="AppIco" />
    <Property Id="INNO_QUIET">
      <RegistrySearch Type="raw" Id="RS_InnoQuiet" Root="HKCU"
          Key="Software\Microsoft\Windows\CurrentVersion\Uninstall\$InnoUninstKey"
          Name="QuietUninstallString" />
    </Property>
    <Property Id="INNO_UNINST">
      <RegistrySearch Type="raw" Id="RS_InnoUninst" Root="HKCU"
          Key="Software\Microsoft\Windows\CurrentVersion\Uninstall\$InnoUninstKey"
          Name="UninstallString" />
    </Property>
    <CustomAction Id="SetPsFull" Property="PS_FULL"
                  Value="[SystemFolder]WindowsPowerShell\v1.0\powershell.exe" />
    <CustomAction Id="SetS2Data" Property="S2InnoMigrate"
                  Value="[PS_FULL]" />
    <CustomAction Id="S2InnoMigrate" Execute="deferred" Impersonate="yes"
                  Property="PS_FULL"
                  ExeCommand="powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -EncodedCommand $($b64)" Return="check" />
    <InstallExecuteSequence>
      <Custom Action="SetPsFull" After="AppSearch" />
      <Custom Action="SetS2Data" After="SetPsFull" />
      <Custom Action="S2InnoMigrate" After="InstallFiles" Condition="INNO_QUIET OR INNO_UNINST" />
    </InstallExecuteSequence>
    <StandardDirectory Id="LocalAppDataFolder">
      <Directory Id="PROGRAMS_LOC" Name="Programs">
        <Directory Id="INSTALLFOLDER" Name="AstboxMSI">
$(($dirDecls -join "`n"))
          <Directory Id="MENU_ASTBOX" Name="ASTBOX 容器管理器" />
          <Directory Id="DIR_PROFILE" Name="chromium-profile" />
          
$compXml
$assocXml
$cleanupXml
        </Directory>
      </Directory>
    </StandardDirectory>
    <Feature Id="Main" Level="1">
$refs
      <ComponentRef Id="cmp_Assoc" />
      <ComponentRef Id="cmp_ProfileCleanup" />
    </Feature>
  </Package>
</Wix>
"@

[IO.File]::WriteAllText($OutWxs, $wxs, (New-Object Text.UTF8Encoding($false)))
"wxs written: $OutWxs  ($($compRefs.Count) components, $($allFiles.Count) files)"
