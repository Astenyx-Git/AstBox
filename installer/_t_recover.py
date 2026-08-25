# -*- coding: utf-8 -*-
# Copyright 2026 Astenyx-Git
# SPDX-License-Identifier: Apache-2.0
"""旧容器恢复: 用户提供了封装密钥(ASTBOX×26+====)与精确时刻。
旧机制槽位凭据 = 封装时刻的 8 位验证码 => 直接算出并尝试解锁。
成功后把内容重封装为"稳定密钥"新容器(*_recovered.astbox)。
"""
import base64
import hashlib
import hmac
import os
import struct
import sys
import time

BASE = os.path.join(os.path.join(os.environ["LOCALAPPDATA"],
                                 "Programs", "Astbox"))
UPLOADS = os.path.join(BASE, "app", "tmp", "uploads")
sys.path.insert(0, os.path.join(BASE, "app"))
sys.path.insert(0, os.path.join(BASE, "app", "deps"))
from astbox import container as cont          # noqa: E402
from astbox import create                     # noqa: E402
from astbox import crypto                     # noqa: E402

B32 = "ASTBOX" * 26                            # 156 字符
T_PACK = 1787545262                            # Github-2FA 封装时刻
T_RELEASE = None                               # 用文件 mtime


def totp8(t):
    padded = B32 + '=' * ((-len(B32)) % 8)
    return crypto.totp_at(padded, 8, int(t))


DESK = os.path.expanduser('~') + r'\Desktop'
targets = [
    ('Github-2FA',
     os.path.join(DESK, 'Github-2FA.astbox')
     if os.path.exists(os.path.join(DESK, 'Github-2FA.astbox'))
     else max((os.path.join(UPLOADS, f) for f in os.listdir(UPLOADS)
               if 'Github' in f), key=os.path.getmtime),
     T_PACK),
    ('release',
     os.path.join(DESK, 'astbox - release.astbox')
     if os.path.exists(os.path.join(DESK, 'astbox - release.astbox'))
     else os.path.join(UPLOADS,
                       '20260824-105045_astbox - release.astbox'),
     None),
]

for tag, path, t_hint in targets:
    if not os.path.exists(path):
        print("skip %s: 文件不存在" % tag)
        continue
    mt = int(os.path.getmtime(path))
    t_center = t_hint if t_hint else mt
    print("== %s ==" % tag)
    print("   尝试中心时刻:", time.strftime(
        "%Y-%m-%d %H:%M:%S", time.localtime(t_center)))
    uc = None
    used_t = None
    for delta in range(-90, 91):               # 覆盖 mtime/记录误差 ±90s
        t = t_center + delta
        try:
            uc = cont.unlock_container(path, totp=totp8(t))
            used_t = t
            break
        except Exception:
            continue
    if uc is None:
        print("   ✗ 未能在 ±90s 内命中封装窗口")
        continue
    print("   ★ 命中! 时刻:", time.strftime(
        "%Y-%m-%d %H:%M:%S", time.localtime(used_t)),
        "(T%+ds)" % (used_t - t_center))
    out = path[:-7] + "_recovered.astbox"
    files = {}
    for p, ent in cont.walk_entries(uc):
        if ent.is_file:
            files[p] = cont.read_file(uc, ent)
    create.create_container(out, totp_secret=B32, totp_digits=8,
                            files=files)
    chk = cont.unlock_container(out, secret_b32=B32)
    print("   ✓ 已重封装(稳定密钥, 永久可开):", out,
          "| entries=%d size=%.1fMiB"
          % (len(chk.entries),
             os.path.getsize(out) / 1048576))
