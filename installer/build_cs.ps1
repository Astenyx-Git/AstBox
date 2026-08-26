# ASTBOX C#/.NET 10 installer builder (PowerShell port of the retired
# build_cs.py; zero Python anywhere in the build chain).
#
# Version source: installer/VERSION -> artifact AstboxSetup-<V>C#.exe
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File installer\build_cs.ps1
#   powershell ... installer\build_cs.ps1 -NoChromium
#
# Signing (same semantics as before):
#   env ASTBOX_SIGN_PFX (+ ASTBOX_SIGN_PW, optional ASTBOX_SIGN_TS);
#   unset => signing silently skipped.

param([switch]$NoChromium, [switch]$Msi)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$stage = Join-Path $here 'stage\Astbox'
$serverPub = Join-Path $root '.server-publish'
$cliPub = Join-Path $root '.cli-publish'
$guiSrc = Join-Path $root 'gui'
$chromiumSrc = Join-Path $root 'chromium'
$assetsSrc = Join-Path $here 'assets'
$dist = Join-Path $here 'dist'

function Log([string]$m) { Write-Output ('[build-cs] ' + $m) }
function Fail([string]$m) { throw $m }

function Sign-File([string]$path) {
    $pfx = $env:ASTBOX_SIGN_PFX
    if (-not $pfx -or -not (Test-Path -LiteralPath $pfx -PathType Leaf)) {
        Log ('未配置 ASTBOX_SIGN_PFX, 跳过签名: ' + (Split-Path -Leaf $path))
        return
    }
    $ts = if ($env:ASTBOX_SIGN_TS) { $env:ASTBOX_SIGN_TS } else { 'http://timestamp.digicert.com' }
    $pw = $env:ASTBOX_SIGN_PW
    Log ('签名: ' + (Split-Path -Leaf $path))
    $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($pfx, $pw)
    $r = Set-AuthenticodeSignature -FilePath $path -Certificate $cert `
        -IncludeChain All -TimeStampServer $ts -HashAlgorithm SHA256
    if ($r.Status -ne 'Valid') { Fail ('sign failed: ' + $r.Status) }
}

function Reset-Stage {
    $parent = Split-Path -Parent $stage
    if (Test-Path -LiteralPath $parent) {
        Get-ChildItem -LiteralPath $parent -Recurse -Force |
            ForEach-Object { try { $_.Attributes = 'Normal' } catch {} }
        Remove-Item -LiteralPath $parent -Recurse -Force
    }
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
}

function Find-Local-Chromium {
    $hits = @()
    if (Test-Path -LiteralPath $chromiumSrc -PathType Container) {
        foreach ($e in (Get-ChildItem -LiteralPath $chromiumSrc -Directory | Sort-Object Name)) {
            if (Test-Path (Join-Path $e.FullName 'chrome.exe')) { $hits += $e.FullName }
        }
    }
    return , $hits
}

function Stage-Chromium {
    $hits = Find-Local-Chromium
    if ($hits.Count -eq 0) {
        Fail '未找到便携内核: 请在 chromium\ 下放置含 chrome.exe 的已解压目录'
    }
    $src = $hits[0]
    $dst = Join-Path $stage 'chromium'
    Log ('复制内核: ' + (Split-Path -Leaf $src) + ' -> chromium/')
    robocopy $src $dst /E /XF *.pdb *.pyc /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { Fail ('robocopy failed: ' + $LASTEXITCODE) }
    [IO.File]::WriteAllText((Join-Path $dst 'VERSION'), (Split-Path -Leaf $src) + "`n",
        (New-Object Text.UTF8Encoding($false)))
    $mb = ((Get-ChildItem -LiteralPath $dst -Recurse -File | Measure-Object Length -Sum).Sum) / 1048576
    Log ('内核就绪: chromium/ ({0:N0} MiB)' -f $mb)
}

function Invoke-Selftest([string]$cli) {
    # 前置直跑:绕开 Start-Job 序列化干扰, 失败时保留原始 stderr
    $pre = & $cli selftest 2>&1
    if ($LASTEXITCODE -ne 0) { Fail ('自检失败(直跑): ' + (($pre | Select-Object -Last 3) -join ' ')) }
    $job = Start-Job -ScriptBlock { param($c) & $c selftest 2>&1; $LASTEXITCODE } -ArgumentList $cli
    if (-not (Wait-Job $job -Timeout 300)) {
        Stop-Job $job; Remove-Job $job -Force
        Fail '自检失败: 负载 CLI selftest 超时(300s)'
    }
    $rc = Receive-Job $job
    Remove-Job $job -Force
    if ($rc[-1] -ne 0) {
        $tail = ($rc | Select-Object -First ([Math]::Max(0, $rc.Count - 1))) -join ''
        Fail ('自检失败: 打包负载 CLI selftest 未通过 ' + $tail.Substring([Math]::Max(0, $tail.Length - 400)))
    }
    Log '自检通过: 负载 CLI selftest OK'
}

function Stage {
    Reset-Stage

    Get-ChildItem -LiteralPath $serverPub -File |
        Where-Object { $_.Name -notlike '*.pdb' -and $_.Name -ne 'NuGet.Config' } |
        ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $stage $_.Name) -Force
        }

    $cliDst = Join-Path $stage 'astbox-cli.exe'
    $cliSrc = Join-Path $cliPub 'astbox-cli.exe'
    if (-not (Test-Path -LiteralPath $cliSrc -PathType Leaf)) { Fail ('缺少发布产物: ' + $cliSrc) }
    Copy-Item -LiteralPath $cliSrc -Destination $cliDst -Force
    Log ('copied astbox-cli.exe (' + (Get-Item -LiteralPath $cliSrc).Length + ' bytes)')

    $dstGui = Join-Path $stage 'gui'
    Copy-Item -LiteralPath $guiSrc -Destination $dstGui -Recurse -Force
    $n = (Get-ChildItem -LiteralPath $dstGui -Recurse -File | Measure-Object).Count
    Log ('gui/ staged (' + $n + ' files)')

    Copy-Item -LiteralPath $assetsSrc -Destination (Join-Path $stage 'assets') -Recurse -Force
    Log 'assets/ staged'

    foreach ($req in @('astbox-server.exe', 'astbox-cli.exe', 'libsodium.dll', 'gui', 'assets')) {
        if (-not (Test-Path (Join-Path $stage $req))) { Fail ('SANITY FAIL: ' + $req + ' missing') }
    }

    Invoke-Selftest $cliDst
}

function Find-Iscc {
    $cands = @(
        'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
        'C:\Program Files\Inno Setup 6\ISCC.exe',
        (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe')
    )
    foreach ($c in $cands) { if (Test-Path -LiteralPath $c -PathType Leaf) { return $c } }
    $w = Get-Command ISCC -ErrorAction SilentlyContinue
    if ($w) { return $w.Source }
    return $null
}

try {
    $verPath = Join-Path $here 'VERSION'
    $appVersion = ([IO.File]::ReadAllText($verPath)).Trim()
    if (-not $appVersion) { Fail 'installer/VERSION 为空, 无法确定版本' }
    $label = $appVersion + 'C#'          # e.g. V2.0.1C#
    $num = $label.Substring(1)           # 2.0.1C#
    Log ('本包版本: ' + $label + ' (VERSION 文件)')

    Stage

    $iscc = Find-Iscc
    if (-not $iscc) { Fail '未找到 ISCC(Inno Setup 6), 无法编译安装程序' }

    function Compile([string[]]$extraDefines, [string]$outName) {
        $outPath = Join-Path $dist $outName
        # 预清理旧产物(防杀软/SAC 扫描句柄钉住文件)
        if (Test-Path -LiteralPath $outPath) {
            Remove-Item -LiteralPath $outPath -Force -ErrorAction SilentlyContinue
            foreach ($i in 1..10) {
                if (-not (Test-Path -LiteralPath $outPath)) { break }
                Start-Sleep -Milliseconds 500
                Remove-Item -LiteralPath $outPath -Force -ErrorAction SilentlyContinue
            }
        }
        New-Item -ItemType Directory -Path $dist -Force | Out-Null

        $args = @('/DAppVersionNum=' + $num, '/DAppVersionLabel=' + $label) + $extraDefines +
            @(Join-Path $here 'astbox-cs.iss')
        $attempt = 0
        while ($true) {
            $attempt++
            Push-Location $here
            try { & $iscc @args | Out-Null } finally { Pop-Location }
            if ($LASTEXITCODE -eq 0) { break }
            if ($attempt -lt 3) {
                Log ('ISCC 退出码 ' + $LASTEXITCODE + '(第 ' + $attempt + ' 次), 3 秒后重试')
                Start-Sleep -Seconds 3
                if (Test-Path -LiteralPath $outPath) {
                    Remove-Item -LiteralPath $outPath -Force -ErrorAction SilentlyContinue
                }
                continue
            }
            Fail ('ISCC failed: ' + $LASTEXITCODE)
        }
        if (-not (Test-Path -LiteralPath $outPath -PathType Leaf)) { Fail ('编译完成但未找到产物: ' + $outPath) }
        Sign-File $outPath
        Log ('安装程序: ' + $outPath + ' ({0:N1} MiB)' -f ((Get-Item -LiteralPath $outPath).Length / 1048576))
    }

    # 签名负载内我方可执行文件(未配置证书则自动跳过)
    foreach ($exe in @('astbox-server.exe', 'astbox-cli.exe')) {
        Sign-File (Join-Path $stage $exe)
    }

    $channels = @()

    # (1) 精简版
    Compile @() ('AstboxSetup-' + $label + '.exe')
    $channels += 'slim'

    # (2) 内核版(stage 加入 chromium/ 后重编译)
    if (-not $NoChromium) {
        Stage-Chromium
        Compile @('/DChromiumBuild') ('AstboxSetup-' + $label + '-Chromium.exe')
        $channels += 'chromium'
    }

    # (3) 内核版 MSI(S2 无缝迁移: 静默卸载旧 Inno 版后安装至 Programs\AstboxMSI)
    if ($Msi) {
        $wixExe = Join-Path $env:USERPROFILE '.dotnet\tools\wix.exe'
        if (-not (Test-Path $wixExe)) { Fail '未找到 wix.exe(需 dotnet tool install -g wix --version 6.0.2)' }
        $gen = Join-Path $PSScriptRoot 'wix\gen_wxs.ps1'
        & powershell -NoProfile -ExecutionPolicy Bypass -File $gen -VersionLabel $label
        if ($LASTEXITCODE -ne 0) { Fail 'gen_wxs 失败' }
        $msiOut = Join-Path $dist ('AstboxSetup-' + $label + '-Chromium.msi')
        Log ('wix build → ' + (Split-Path $msiOut -Leaf))
        & $wixExe build -arch x64 -o $msiOut (Join-Path $PSScriptRoot 'wix\AstboxChromium.wxs') 2>&1 |
            ForEach-Object { Write-Output ('[wix] ' + $_) }
        if ($LASTEXITCODE -ne 0) { Fail 'wix build 失败' }
        Sign-File $msiOut
        $channels += 'msi'
        Log ('安装程序: ' + $msiOut + ' ({0:N1} MiB)' -f ((Get-Item -LiteralPath $msiOut).Length / 1048576))
    }

    $manifest = [ordered]@{
        app_version = $label
        channels    = $channels
        runtime     = '.NET 10 NativeAOT'
        built       = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    }
    [IO.File]::WriteAllText((Join-Path $dist 'manifest.json'),
        ($manifest | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
    Log 'manifest.json 已更新'
    exit 0
}
catch {
    Write-Output ('[build-cs] FATAL: ' + $_.Exception.Message)
    exit 1
}
