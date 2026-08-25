# -*- coding: utf-8 -*-
# Copyright 2026 Astenyx-Git
# SPDX-License-Identifier: Apache-2.0
"""纯标准库生成 ASTBOX 应用图标 (assets/astbox.ico)。

渲染逻辑与 gui/index.html 的内联 favicon 一致：
蓝色渐变圆角方盒 + 浅色盒盖 + 白色卡槽。
2x 超采样抗锯齿，输出 PNG 后封装为单层 256px ICO。
"""
import os
import struct
import zlib

SIZE = 256
SS = 2                       # 超采样倍率
N = SIZE * SS


def _lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def _rounded_rect_sdf(px, py, cx, cy, hw, hh, r):
    """到圆角矩形的有符号距离（外部为正）。"""
    dx = abs(px - cx) - (hw - r)
    dy = abs(py - cy) - (hh - r)
    ox, oy = max(dx, 0.0), max(dy, 0.0)
    return (ox * ox + oy * oy) ** 0.5 + min(max(dx, dy), 0.0) - r


def _coverage(dist):
    """SDF -> alpha 覆盖率（1px 过渡带）。"""
    if dist <= -0.75:
        return 1.0
    if dist >= 0.75:
        return 0.0
    return 0.5 - dist / 1.5


def render():
    """在 64 单位设计坐标系绘制（与 favicon viewBox 一致），映射到 SIZE 像素。"""
    import math
    top_rgb = (125, 184, 255)     # #7db8ff
    bot_rgb = (61, 110, 242)      # #3d6ef2
    lid_rgb = (168, 205, 255)     # #a8cdff
    white = (255, 255, 255)
    K = SIZE / 64.0               # 设计单位 -> 输出像素

    # 盒盖梯形四条边的半平面函数(设计坐标, 外正内负)
    sqrt13 = math.sqrt(13)

    def d_lid_design(x, y):
        f_top = 10 - y
        f_right = (3 * (x - 38) - 2 * (y - 10)) / sqrt13
        f_bottom = y - 22
        f_left = (-3 * (x - 18) - 2 * (y - 10)) / sqrt13
        return max(f_top, f_right, f_bottom, f_left)

    rows = []
    inv = 1.0 / (SS * SS)
    for yo in range(SIZE):
        body_rgb = _lerp(top_rgb, bot_rgb,
                         min((yo / (SIZE - 1)) * 1.6, 1.0))
        row = bytearray([0])                       # PNG filter: none
        for xo in range(SIZE):
            # SS×SS 子采样，输出像素级 RGBA 均值（抗锯齿）
            acc = [0.0, 0.0, 0.0, 0.0]
            for oy in range(SS):
                for ox in range(SS):
                    px_out = xo + (ox + 0.5) / SS
                    py_out = yo + (oy + 0.5) / SS
                    sx, sy = px_out / K, py_out / K   # 设计坐标

                    d_body = _rounded_rect_sdf(sx, sy, 32, 36, 22, 16,
                                               9) * K
                    a_body = _coverage(d_body)
                    a_lid = _coverage(d_lid_design(sx, sy) * K)
                    d_slot = _rounded_rect_sdf(sx, sy, 32, 32, 5, 2,
                                               2) * K
                    a_slot = _coverage(d_slot)

                    # 合成顺序: 背景 -> 盒体 -> 盒盖 -> 卡槽
                    rgba = [0, 0, 0, 0]
                    def over(dst, src_rgb, src_a):
                        da = dst[3] / 255.0
                        out_a = src_a + da * (1 - src_a)
                        if out_a <= 0:
                            return [0, 0, 0, 0]
                        for i in range(3):
                            dst[i] = int((src_rgb[i] * src_a +
                                          dst[i] * da * (1 - src_a))
                                         / out_a)
                        dst[3] = int(round(out_a * 255))
                        return dst
                    rgba = over(rgba, body_rgb, a_body)
                    rgba = over(rgba, lid_rgb, a_lid)
                    rgba = over(rgba, white, a_slot)
                    for i in range(4):
                        acc[i] += rgba[i]
            row += bytes(int(round(c * inv)) for c in acc)
        rows.append(bytes(row))
    return bytes().join(rows)


def png_encode(raw_rows, w, h):
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)   # RGBA8
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw_rows, 9))
            + chunk(b"IEND", b""))


def wrap_ico(png_bytes, size):
    entry = struct.pack("<BBBBHHII",
                        0 if size >= 256 else size,   # width (0=256)
                        0 if size >= 256 else size,   # height
                        0,                             # palette
                        0,                             # reserved
                        1,                             # planes
                        32,                            # bpp
                        len(png_bytes),
                        22)                            # data offset
    return struct.pack("<HHH", 0, 1, 1) + entry + png_bytes


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    raw = render()
    png = png_encode(raw, SIZE, SIZE)
    ico = wrap_ico(png, SIZE)
    os.makedirs(os.path.join(here, "assets"), exist_ok=True)
    with open(os.path.join(here, "assets", "astbox.png"), "wb") as f:
        f.write(png)
    with open(os.path.join(here, "assets", "astbox.ico"), "wb") as f:
        f.write(ico)
    print("icon written: assets/astbox.png (%d B), assets/astbox.ico (%d B)"
          % (len(png), len(ico)))


if __name__ == "__main__":
    main()
