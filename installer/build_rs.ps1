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
# env ASTBOX_SIGN_PFX (+ ASTBOX_SIGN_PW, ASTBOX_SIGN_TS)  — PFX 文件签名
# env ASTBOX_SIGN_CN (+ optional ASTBOX_SIGN_TS)          — 证书库内签名(/n)
# 都未设置 => signing silently skipped.
function Sign-File([string]$path) {
    $pfx = $env:ASTBOX_SIGN_PFX
    $cn  = $env:ASTBOX_SIGN_CN
    if (-not $pfx -and -not $cn) { Log "signing skipped (no ASTBOX_SIGN_PFX/CN): $(Split-Path -Leaf $path)"; return }
    $sigPath = $null
    $sig = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($sig) { $sigPath = $sig.Source }
    else {
        $kits = 'C:\Program Files (x86)\Windows Kits\10\bin'
        if (Test-Path $kits) {
            $tool = Get-ChildItem $kits -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
                Where-Object { $_.FullName -match 'x64' } | Sort-Object FullName -Descending |
                Select-Object -First 1
            if ($tool) { $sigPath = $tool.FullName }
        }
    }
    if (-not $sigPath) { Log "signtool not found; skip"; return }
    if ($pfx) {
        $sargs = @('sign', '/fd', 'SHA256', '/f', $pfx)
        if ($env:ASTBOX_SIGN_PW) { $sargs += @('/p', $env:ASTBOX_SIGN_PW) }
    } else {
        $sargs = @('sign', '/fd', 'SHA256', '/n', $cn)
    }
    if ($env:ASTBOX_SIGN_TS) {
        $sargs += @('/tr', $env:ASTBOX_SIGN_TS, '/td', 'SHA256')
    } elseif ($null -eq $env:ASTBOX_SIGN_TS) {
        # 默认带 RFC3161 时间戳(签名在证书过期后仍可验真);ASTBOX_SIGN_TS='' 可关闭
        $sargs += @('/tr', 'http://timestamp.digicert.com', '/td', 'SHA256')
    }
    $sargs += $path
    & $sigPath @sargs | Out-Host
    if ($LASTEXITCODE -ne 0) { Fail "signing failed: $path" }
    Log "signed: $(Split-Path -Leaf $path)"
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
Invoke-TauriBuild @() 'default embedBootstrapper'
$artifacts += (Split-Path -Leaf (Save-Setup "ASTBOX_$semver-setup.exe"))
$artifacts += (Split-Path -Leaf (Save-Msi "ASTBOX_${semver}-x64.msi"))

# --- build: offline channel (offlineInstaller) -------------------------------
if (-not $SkipOffline) {
    Invoke-TauriBuild @('-c', 'tauri.offline.json', '--bundles', 'nsis') 'offlineInstaller'
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
