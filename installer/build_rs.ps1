# ASTBOX Rust/Tauri desktop builder — replaces build_cs.ps1
# (ISCC/WiX -> tauri build; dual-channel NSIS artifacts).
#
# Version source: installer/VERSION (唯一版本源) -> tauri.conf.json
#   "V3.0.0" -> product version 3.0.0, artifact ASTBOX_3.0.0-setup.exe
#
# Channels (P6, plan 决策 #2):
#   default  — embedBootstrapper (WebView2 在线引导, 小包)
#   offline  — offlineInstaller (+WebView2 Standalone, 面向断网/LTSC),
#              artifact renamed *_offline-setup.exe
#   两通道 tauri 产物同名同目录, 故构建后立即取出再打下一通道。
#
# Signing (same semantics as build_cs.ps1):
#   env ASTBOX_SIGN_PFX (+ ASTBOX_SIGN_PW, optional ASTBOX_SIGN_TS);
#   unset => signing silently skipped.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File installer\build_rs.ps1
#   powershell ... installer\build_rs.ps1 -SkipOffline

param([switch]$SkipOffline)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$conf = Join-Path $root 'rust\crates\astbox-gui\tauri.conf.json'
$dist = Join-Path $here 'dist'

function Log([string]$m) { Write-Output ('[build-rs] ' + $m) }
function Fail([string]$m) { throw $m }

# --- signing (build_cs.ps1 semantics + store-cert mode) ----------------------
# 签名语义抽取到 sign-common.ps1(build_rs 与 beforeBundleCommand 钩子
# sign-app-exe.ps1 共用 —— 内嵌 app exe 与外壳产物同一套签名规则)。
. (Join-Path $here 'sign-common.ps1')
function Sign-File([string]$path) {
    Invoke-AppSign $path | Out-Null
}

# --- version injection: installer/VERSION -> tauri.conf.json ---------------
$versionRaw = (Get-Content (Join-Path $here 'VERSION') -Raw).Trim()
if ($versionRaw -notmatch '^V?(\d+\.\d+\.\d+.*)$') { Fail "bad VERSION: $versionRaw" }
$semver = $Matches[1]

$confJson = Get-Content $conf -Raw -Encoding UTF8 | ConvertFrom-Json
$oldVersion = $confJson.version
if ($oldVersion -ne $semver) {
    Log ("version {0} -> {1} (from installer/VERSION)" -f $oldVersion, $semver)
    $confJson.version = $semver
    $confJson | ConvertTo-Json -Depth 20 | Set-Content $conf -Encoding UTF8
}

# --- tauri 原生签名(打包器在自身资源改写之后签 exe/卸载器/安装包)-----------
# PFX 存在时导入 CurrentUser\My, 取指纹写入临时配置覆盖文件经 -c 传入
# tauri(不直传 JSON 字符串 —— PS5.1 原生参数传递会剥掉内嵌引号);
# 无签名环境时 $signExtra 为空, 构建保持无签名(语义不变)。
$signExtra = @()
if ($env:ASTBOX_SIGN_PFX) {
    $pw = ConvertTo-SecureString -String "$(if ($env:ASTBOX_SIGN_PW) { $env:ASTBOX_SIGN_PW })" -AsPlainText -Force
    $cert = Import-PfxCertificate -FilePath $env:ASTBOX_SIGN_PFX -CertStoreLocation Cert:\CurrentUser\My -Password $pw |
        Sort-Object NotBefore -Descending | Select-Object -First 1
    $thumb = $cert.Thumbprint
    Log ("tauri native signing enabled: thumbprint {0}" -f $thumb)
    $override = Join-Path $env:TEMP 'astbox-sign-override.json'
    ('{"bundle":{"windows":{"certificateThumbprint":"' + $thumb +
        '","digestAlgorithm":"sha256","timestampUrl":"http://timestamp.digicert.com","tsp":true}}}') |
        Set-Content $override -Encoding Ascii
    $signExtra = @('-c', $override)
} elseif ($env:ASTBOX_SIGN_CN) {
    Fail 'ASTBOX_SIGN_CN 暂不支持 tauri 原生签名路径 —— 请改用 ASTBOX_SIGN_PFX'
}

# --- build helpers -----------------------------------------------------------
# cargo in PATH (tauri build spawns cargo)
$env:PATH = "$env:USERPROFILE\.cargo\bin;" + $env:PATH
$guiDir = Join-Path $root 'rust\crates\astbox-gui'

function Invoke-TauriBuild([string[]]$extra, [string]$label) {
    Log "tauri build ($label)..."
    Push-Location $guiDir
    try {
        # Stop preference turns native stderr info lines into terminating
        # errors; relax around the native call and judge via exit code.
        $oldEap = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            & npx.cmd tauri build @extra
        } finally { $ErrorActionPreference = $oldEap }
        if ($LASTEXITCODE -ne 0) { Fail "tauri build failed ($label)" }
    } finally { Pop-Location }
}

# SAC 防御: 任何会重链 build.rs 的变更(如 tauri.conf.json 版本)都会产生
# 未签名的新 build-script-build.exe, Smart App Control 首见即拦(os 4551)。
# 有签名环境时预签全部中间构建脚本(Invoke-AppSign 无环境时静默跳过)。
function Sign-BuildScripts {
    if (-not $env:ASTBOX_SIGN_PFX) { return }
    $n = 0
    Get-ChildItem (Join-Path $root 'rust\target\release\build') -Recurse -Filter 'build-script-build*.exe' -ErrorAction SilentlyContinue |
        ForEach-Object { Invoke-AppSign $_.FullName | Out-Null; $n++ }
    Log "build scripts signed: $n"
}

# 两通道产物同名(bundle\nsis\ASTBOX_<v>_x64-setup.exe, offline 构建会覆盖
# 前者), 故每通道构建后立即取出。
function Save-Setup([string]$name) {
    $nsisDir = Join-Path $root 'rust\target\release\bundle\nsis'
    $f = Get-ChildItem $nsisDir -Filter "ASTBOX_*-setup.exe" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $f) { Fail "setup artifact not found in $nsisDir" }
    $dst = Join-Path $dist $name
    Copy-Item $f.FullName $dst -Force
    Sign-File $dst
    return $dst
}

# MSI 通道(per-machine, WiX): 默认通道随 NSIS 一并产出; 离线通道仍 NSIS-only
# (--bundles nsis 覆盖 targets, 避免巨型内嵌 MSI)。
function Save-Msi([string]$name) {
    $msiDir = Join-Path $root 'rust\target\release\bundle\msi'
    $f = Get-ChildItem $msiDir -Filter "ASTBOX_*.msi" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $f) { Fail "msi artifact not found in $msiDir" }
    $dst = Join-Path $dist $name
    Copy-Item $f.FullName $dst -Force
    Sign-File $dst
    return $dst
}

# --- collect ------------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$artifacts = @()

# --- build: default channel (embedBootstrapper) ------------------------------
Sign-BuildScripts
Invoke-TauriBuild $signExtra 'default embedBootstrapper'
$artifacts += (Split-Path -Leaf (Save-Setup "ASTBOX_$semver-setup.exe"))
$artifacts += (Split-Path -Leaf (Save-Msi "ASTBOX_${semver}-x64.msi"))

# --- build: offline channel (offlineInstaller) -------------------------------
if (-not $SkipOffline) {
    Sign-BuildScripts
    Invoke-TauriBuild ($signExtra + @('-c', 'tauri.offline.json', '--bundles', 'nsis')) 'offlineInstaller'
    $artifacts += (Split-Path -Leaf (Save-Setup "ASTBOX_${semver}-offline-setup.exe"))
}

# --- manifest -----------------------------------------------------------------
$channels = @('nsis', 'msi')
if (-not $SkipOffline) { $channels += 'offline' }
$manifest = [ordered]@{
    app_version = "V$semver"
    channels    = $channels
    runtime     = 'Rust + Tauri v2 (WebView2)'
    built       = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
}
$manifest | ConvertTo-Json | Set-Content (Join-Path $dist 'manifest.json') -Encoding UTF8

Log ('artifacts: ' + ($artifacts -join ', '))
Log 'done.'
