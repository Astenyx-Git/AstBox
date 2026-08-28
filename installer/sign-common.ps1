# Copyright 2026 Astenyx-Git
# SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
# ASTBOX 代码签名公共函数 —— build_rs.ps1 与 sign-app-exe.ps1 共用。
# 语义与 build_cs.ps1 一致:
#   env ASTBOX_SIGN_PFX (+ ASTBOX_SIGN_PW, ASTBOX_SIGN_TS)  — PFX 文件签名
#   env ASTBOX_SIGN_CN (+ optional ASTBOX_SIGN_TS)          — 证书库内签名(/n)
#   都未设置 => 签名静默跳过(返回 $false,不阻断构建)。
#   默认带 RFC3161 时间戳(签名在证书过期后仍可验真);ASTBOX_SIGN_TS='' 可关闭。

function Get-SignTool {
    $sig = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($sig) { return $sig.Source }
    $kits = 'C:\Program Files (x86)\Windows Kits\10\bin'
    if (Test-Path $kits) {
        $tool = Get-ChildItem $kits -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match 'x64' } | Sort-Object FullName -Descending |
            Select-Object -First 1
        if ($tool) { return $tool.FullName }
    }
    return $null
}

function Invoke-AppSign([string]$path) {
    $pfx = $env:ASTBOX_SIGN_PFX
    $cn  = $env:ASTBOX_SIGN_CN
    if (-not $pfx -and -not $cn) {
        Write-Output ('[sign] signing skipped (no ASTBOX_SIGN_PFX/CN): ' + (Split-Path -Leaf $path))
        return $false
    }
    $sigPath = Get-SignTool
    if (-not $sigPath) {
        Write-Output '[sign] signtool not found; skip'
        return $false
    }
    if ($pfx) {
        $sargs = @('sign', '/fd', 'SHA256', '/f', $pfx)
        if ($env:ASTBOX_SIGN_PW) { $sargs += @('/p', $env:ASTBOX_SIGN_PW) }
    } else {
        $sargs = @('sign', '/fd', 'SHA256', '/n', $cn)
    }
    if ($env:ASTBOX_SIGN_TS) {
        $sargs += @('/tr', $env:ASTBOX_SIGN_TS, '/td', 'SHA256')
    } elseif ($null -eq $env:ASTBOX_SIGN_TS) {
        # 默认带 RFC3161 时间戳;ASTBOX_SIGN_TS='' 可关闭
        $sargs += @('/tr', 'http://timestamp.digicert.com', '/td', 'SHA256')
    }
    $sargs += $path
    & $sigPath @sargs | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "signing failed: $path" }
    Write-Output ('[sign] signed: ' + (Split-Path -Leaf $path))
    return $true
}
