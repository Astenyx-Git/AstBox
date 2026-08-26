# Converts a PNG into a multi-size Windows ICO (DIB-encoded, alpha preserved).
# Usage: powershell -File make_ico.ps1 -Png <in.png> -Ico <out.ico>
param(
    [Parameter(Mandatory=$true)][string]$Png,
    [Parameter(Mandatory=$true)][string]$Ico,
    [int[]]$Sizes = @(16,24,32,48,64,128,256)
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$img = [System.Drawing.Image]::FromFile($Png)

function Get-BgraBottomUp([System.Drawing.Image]$image, [int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    $scale = [Math]::Min($size / $image.Width, $size / $image.Height)
    $w = [int][Math]::Floor($image.Width  * $scale)
    $h = [int][Math]::Floor($image.Height * $scale)
    $x = [int][Math]::Floor(($size - $w) / 2)
    $y = [int][Math]::Floor(($size - $h) / 2)
    $g.DrawImage($image, $x, $y, $w, $h)
    $g.Dispose()

    $rect  = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $data  = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $out   = New-Object byte[] ($size * $size * 4)
    for ($row = 0; $row -lt $size; $row++) {
        $ptr = [IntPtr]::Add($data.Scan0, $row * $data.Stride)
        $dstRow = $size - 1 - $row                    # DIB 自底向上
        for ($col = 0; $col -lt $size; $col++) {
            $o = $col * 4
            $d = ($dstRow * $size + $col) * 4
            $out[$d]   = [Runtime.InteropServices.Marshal]::ReadByte($ptr, $o)
            $out[$d+1] = [Runtime.InteropServices.Marshal]::ReadByte($ptr, ($o+1))
            $out[$d+2] = [Runtime.InteropServices.Marshal]::ReadByte($ptr, ($o+2))
            $out[$d+3] = [Runtime.InteropServices.Marshal]::ReadByte($ptr, ($o+3))
        }
    }
    $bmp.UnlockBits($data)
    $bmp.Dispose()
    return ,$out
}

$entries = @()
foreach ($s in $Sizes) {
    $xor  = Get-BgraBottomUp $img $s
    $maskRow = [Math]::Ceiling($s / 8.0)
    $maskRow = [int]([Math]::Ceiling($maskRow / 4.0) * 4)   # 32-bit 对齐
    $and  = New-Object byte[] ($maskRow * $s)               # 全零: 不透明由 alpha 决定
    $ms = New-Object IO.MemoryStream
    $bw = New-Object IO.BinaryWriter($ms)
    # BITMAPINFOHEADER(40): biHeight = 高*2(XOR+AND)
    $bw.Write([uint32]40); $bw.Write([int32]$s); $bw.Write([int32]($s * 2))
    $bw.Write([uint16]1);  $bw.Write([uint16]32)
    $bw.Write([uint32]0);  $bw.Write([uint32]($xor.Length + $and.Length))
    $bw.Write([int32]0); $bw.Write([int32]0); $bw.Write([uint32]0); $bw.Write([uint32]0)
    $bw.Write($xor); $bw.Write($and)
    $entries += @{ Size = $s; Data = $ms.ToArray() }
    $bw.Dispose(); $ms.Dispose()
}
$img.Dispose()

$out = New-Object IO.MemoryStream
$bw  = New-Object IO.BinaryWriter($out)
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$entries.Count)  # ICONDIR
$offset = 6 + 16 * $entries.Count
foreach ($e in $entries) {
    $sz = if ($e.Size -ge 256) { 0 } else { $e.Size }
    $bw.Write([byte]$sz); $bw.Write([byte]$sz)          # 宽、高(256 记 0)
    $bw.Write([byte]0); $bw.Write([byte]0)              # 色数、保留
    $bw.Write([uint16]1); $bw.Write([uint16]32)         # 平面、位深
    $bw.Write([uint32]$e.Data.Length); $bw.Write([uint32]$offset)
    $offset += $e.Data.Length
}
foreach ($e in $entries) { $bw.Write($e.Data) }
$bw.Flush()
[IO.File]::WriteAllBytes($Ico, $out.ToArray())
$bw.Dispose(); $out.Dispose()

# 校验:目录头结构 + 帧偏移自洽(GDI Icon 构造在本机不可靠, 不用作探针)
$bytes = [IO.File]::ReadAllBytes($Ico)
$reserved = [BitConverter]::ToUInt16($bytes, 0)
$type     = [BitConverter]::ToUInt16($bytes, 2)
$count    = [BitConverter]::ToUInt16($bytes, 4)
if ($reserved -ne 0 -or $type -ne 1 -or $count -ne $entries.Count) { throw 'ICO 结构校验失败' }
$total = $bytes.Length
for ($i = 0; $i -lt $count; $i++) {
    $base = 6 + 16 * $i
    $off  = [BitConverter]::ToUInt32($bytes, $base + 12)
    $len  = [BitConverter]::ToUInt32($bytes, $base + 8)
    if ($off + $len -gt $total) { throw ('帧 ' + $i + ' 越界') }
}
'ICO ok: ' + $total + ' B, ' + $count + ' 帧(' + ($Sizes -join '/') + '), 结构自洽'
