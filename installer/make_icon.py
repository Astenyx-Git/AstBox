# -*- coding: utf-8 -*-
# Copyright 2026 Astenyx-Git
# SPDX-License-Identifier: Apache-2.0
"""PNG -> 多尺寸 ICO 转换器 (纯标准库, 无 PIL/System.Drawing 依赖)。

图标双轨约定 (与安装器引用一一对应, 勿混用):
    assets\\astbox.ico      <- .astbox  文件类型图标 (资源管理器文件外观)
    assets\\passbox.ico     <- .passbox 文件类型图标
    assets\\astbox-app.ico  <- 应用本体身份 (桌面/开始菜单快捷方式,
                              安装器 EXE 图标, ARP DisplayIcon,
                              设置页 Capabilities ApplicationIcon)

用法:
    python make_icon.py --preset astbox      INPUT.png   # 写 assets\\astbox.ico
    python make_icon.py --preset astbox-app  INPUT.png   # 写 assets\\astbox-app.ico
    python make_icon.py --preset passbox     INPUT.png   # 写 assets\\passbox.ico
    python make_icon.py INPUT.png OUTPUT.ico [16 24 32 ...]  # 自由输出

输入要求: 8-bit 非 渐进PNG (支持灰度/RGB/RGBA/调色板+tRNS)。
缩放采用面积平均 (box filter), 缩小场景下质量优于双三次。
"""
import os
import struct
import sys
import zlib

DEFAULT_SIZES = (16, 24, 32, 48, 64, 128, 256)
PRESETS = {
    # 名称: (输出相对 assets/, 用途说明)
    "astbox": ("astbox.ico", ".astbox 文件类型图标"),
    "passbox": ("passbox.ico", ".passbox 文件类型图标"),
    "astbox-app": ("astbox-app.ico", "应用本体身份图标"),
}

# ---------------------------------------------------------------- PNG 解码

_PAETH = staticmethod(lambda a, b, c: _paeth(a, b, c))  # noqa: E305 (占位)


def _paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    return b if pb <= pc else c


def read_png(path):
    """读取 PNG, 返回 (width, height, rgba_bytes 按行紧凑排列)。"""
    with open(path, "rb") as f:
        data = f.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit("not a PNG: %s" % path)
    pos, idat, ihdr, plte, trns = 8, [], None, None, None
    while pos < len(data):
        ln, tag = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + ln]
        pos += 12 + ln                       # 跳过 CRC
        if tag == b"IHDR":
            ihdr = struct.unpack(">IIBBBBB", body)
        elif tag == b"IDAT":
            idat.append(body)
        elif tag == b"PLTE":
            plte = body
        elif tag == b"tRNS":
            trns = body
        elif tag == b"IEND":
            break
    w, h, depth, ctype, _, _, interlace = ihdr
    if depth != 8 or interlace != 0:
        raise SystemExit("unsupported PNG (need 8-bit non-interlaced): %s"
                         % path)
    raw = zlib.decompress(b"".join(idat))
    nch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
    stride = w * nch

    def row_bytes(y):                        # 带滤波字节的原始行
        return raw[y * (stride + 1):(y + 1) * (stride + 1)]

    out = bytearray(w * h * 4)
    prev = bytearray(stride)
    for y in range(h):
        line = bytearray(row_bytes(y))
        ft = line[0]
        cur = line[1:]
        if ft == 1:                          # Sub
            for i in range(nch, stride):
                cur[i] = (cur[i] + cur[i - nch]) & 0xFF
        elif ft == 2:                        # Up
            for i in range(stride):
                cur[i] = (cur[i] + prev[i]) & 0xFF
        elif ft == 3:                        # Average
            for i in range(stride):
                left = cur[i - nch] if i >= nch else 0
                cur[i] = (cur[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif ft == 4:                        # Paeth
            for i in range(stride):
                a = cur[i - nch] if i >= nch else 0
                c = prev[i - nch] if i >= nch else 0
                cur[i] = (cur[i] + _paeth(a, prev[i], c)) & 0xFF
        base = y * w * 4
        if ctype == 6:
            out[base:base + w * 4] = cur
        elif ctype == 2:
            for x in range(w):
                o = base + x * 4
                out[o:o + 3] = cur[x * 3:x * 3 + 3]
                out[o + 3] = 255
        elif ctype == 0:
            for x in range(w):
                o = base + x * 4
                out[o:o + 4] = cur[x:x + 1] * 3 + b"\xff"
        elif ctype == 4:
            for x in range(w):
                o = base + x * 4
                out[o:o + 2] = cur[x * 2:x * 2 + 1] * 3
                out[o + 3] = cur[x * 2 + 1]
        else:                                # 调色板
            for x in range(w):
                idx = cur[x]
                o = base + x * 4
                out[o:o + 3] = plte[idx * 3:idx * 3 + 3]
                out[o + 3] = trns[idx] if (trns and idx < len(trns)) else 255
        prev = cur
    return w, h, bytes(out)

# ---------------------------------------------------------------- 缩放


def resize_area(src, sw, sh, tw, th):
    """面积平均缩放 (含边缘分数权重), 返回目标尺寸 rgba 字节。"""
    out = bytearray(tw * th * 4)
    xr = [(max(0, int(i * sw / tw)), min(sw, -(-((i + 1) * sw // tw))))
          for i in range(tw)]
    yr = [(max(0, int(j * sh / th)), min(sh, -(-((j + 1) * sh // th))))
          for j in range(th)]
    for j in range(th):
        y0, y1 = yr[j]
        obase = j * tw * 4
        for i in range(tw):
            x0, x1 = xr[i]
            r = g = b = a = 0.0
            area = 0.0
            for yy in range(y0, y1):
                wy = 1.0 if y1 - y0 == 1 else min(yy + 1, y1) - max(yy, y0)
                wy /= (y1 - y0)
                srow = (yy * sw + x0) * 4
                for xx in range(x0, x1):
                    wx = 1.0 if x1 - x0 == 1 else min(xx + 1, x1) \
                        - max(xx, x0)
                    wx /= (x1 - x0)
                    wgt = wx * wy
                    so = srow + (xx - x0) * 4
                    r += src[so] * wgt
                    g += src[so + 1] * wgt
                    b += src[so + 2] * wgt
                    a += src[so + 3] * wgt
                    area += wgt
            o = obase + i * 4
            out[o] = int(r / area + 0.5)
            out[o + 1] = int(g / area + 0.5)
            out[o + 2] = int(b / area + 0.5)
            out[o + 3] = int(a / area + 0.5)
    return bytes(out)

# ---------------------------------------------------------------- 编码


def png_encode(rgba, w, h):
    """RGBA 字节 -> PNG (filter type 0)。"""
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)
        raw += rgba[y * stride:(y + 1) * stride]

    def chunk(tag, payload):
        return (struct.pack(">I", len(payload)) + tag + payload
                + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + chunk(b"IEND", b""))


def build_ico(entries):
    """[(size, png_bytes)] -> ICO 容器字节。"""
    count = len(entries)
    offset = 6 + 16 * count
    head = [struct.pack("<HHH", 0, 1, count)]
    blobs = []
    for size, png in entries:
        w = 0 if size >= 256 else size
        head.append(struct.pack("<BBBBHHII", w, w, 0, 0, 1, 32,
                                len(png), offset))
        blobs.append(png)
        offset += len(png)
    return b"".join(head) + b"".join(blobs)

# ---------------------------------------------------------------- 入口


def convert(src_png, dst_ico, sizes):
    sw, sh, rgba = read_png(src_png)
    entries = []
    for s in sizes:
        small = resize_area(rgba, sw, sh, s, s) if (sw, sh) != (s, s) else rgba
        entries.append((s, png_encode(small, s, s)))
        print("  %4dpx  ok" % s)
    os.makedirs(os.path.dirname(os.path.abspath(dst_ico)), exist_ok=True)
    with open(dst_ico, "wb") as f:
        f.write(build_ico(entries))
    print("%s <- %s (%dx%d, %d sizes)"
          % (dst_ico, src_png, sw, sh, len(sizes)))


def main(argv):
    args = argv[1:]
    here = os.path.dirname(os.path.abspath(__file__))
    assets = os.path.join(here, "assets")
    if args and args[0] == "--preset":
        if len(args) != 3 or args[1] not in PRESETS:
            raise SystemExit(__doc__)
        name = args[1]
        dst = os.path.join(assets, PRESETS[name][0])
        sizes = DEFAULT_SIZES
        convert(args[2], dst, sizes)
    else:
        if len(args) not in (2, 3):
            raise SystemExit(__doc__)
        sizes = tuple(int(x) for x in args[2].split(",")) \
            if len(args) == 3 else DEFAULT_SIZES
        convert(args[0], args[1], sizes)


if __name__ == "__main__":
    main(sys.argv)
