# -*- coding: utf-8 -*-
# Copyright 2026 Astenyx-Git
# SPDX-License-Identifier: Apache-2.0
"""解锁链路端到端验证: 持久化 + 时钟偏移窗口(对已安装栈)。

场景:
  A. demo 创建 -> 重启服务 -> 用"漂移+120s"的验证码解锁
  B. pack 封装 -> 重启服务 -> 同样漂移码解锁 (注册表持久化覆盖)
   C. 跨窗口(+160s)当前码解锁 (回归: 旧版单窗口时间锁缺陷)
   D. 空注册表 + 正确验证码 => 必须拒绝 (fail-closed 安全断言)
"""
import base64
import hashlib
import hmac
import json
import os
import shutil
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request

BASE = os.path.join(os.environ["LOCALAPPDATA"], "Programs", "Astbox")
PY = os.path.join(BASE, "runtime", "python.exe")
SRV = os.path.join(BASE, "app", "astbox_server.py")
PORT = 18798
URL = "http://127.0.0.1:%d" % PORT
TMP = os.path.dirname(os.path.abspath(__file__))
SECRETS = os.path.join(os.environ["LOCALAPPDATA"], "ASTBOX", "secrets.bin")
TEST_SECRETS = os.path.join(TMP, "_t_secrets.bin")


def api(route, payload=None, timeout=300):
    data = json.dumps(payload or {}).encode("utf-8")
    req = urllib.request.Request(URL + route, data=data,
                                 headers={"Content-Type":
                                          "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def start_server():
    # 测试隔离: 密钥注册表重定向到临时文件, 绝不触碰真实 secrets.bin
    env = dict(os.environ)
    env["ASTBOX_SECRETS_PATH"] = TEST_SECRETS
    p = subprocess.Popen([PY, SRV, "--port", str(PORT), "--no-browser"],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         env=env)
    for _ in range(40):
        time.sleep(0.4)
        try:
            with urllib.request.urlopen(URL + "/api/state", timeout=2) as r:
                if r.status == 200:
                    return p
        except Exception:
            continue
    p.kill()
    raise SystemExit("server failed to start")


def stop_server(p):
    try:
        api("/api/shutdown")
    except Exception:
        pass
    try:
        p.wait(timeout=10)
    except Exception:
        p.kill()


def totp_code6(b32, t):
    key = base64.b32decode(b32 + "=" * ((-len(b32)) % 8), casefold=True)
    cnt = int(t // 30)
    mac = hmac.new(key, struct.pack(">Q", cnt), hashlib.sha1).digest()
    o = mac[19] & 0x0F
    return "%06d" % ((struct.unpack(">I", mac[o:o + 4])[0] & 0x7FFFFFFF)
                     % 1000000)


def main():
    results = []
    demo_dst = os.path.join(TMP, "_t_demo.astbox")
    pack_dir = os.path.join(TMP, "_t_packsrc")
    pack_dst = os.path.join(TMP, "_t_packed.astbox")
    for f in (demo_dst, pack_dst, TEST_SECRETS):
        if os.path.exists(f):
            os.remove(f)
    shutil.rmtree(pack_dir, ignore_errors=True)
    os.makedirs(pack_dir)
    with open(os.path.join(pack_dir, "note.txt"), "w") as f:
        f.write("unlock drift test")

    # ---- A: demo 容器, 重启后漂移解锁 ----
    srv = start_server()
    d = api("/api/demo", {"dst": demo_dst, "digits": 6,
                          "profile": "constrained"})
    b32 = d["demo"]["b32"]
    assert d.get("ok"), d
    stop_server(srv)
    assert os.path.exists(TEST_SECRETS), "测试密钥库未落盘"

    srv = start_server()                      # 重启: 内存注册表应从磁盘恢复
    api("/api/open", {"path": demo_dst})
    drifted = int(time.time()) + 120          # +4 步漂移
    import hmac, hashlib, struct, base64
    key = base64.b32decode(b32, casefold=True)
    cnt = int(drifted // 30)
    mac = hmac.new(key, struct.pack(">Q", cnt), hashlib.sha1).digest()
    o = mac[19] & 0x0F
    code = "%06d" % ((struct.unpack(">I", mac[o:o+4])[0] & 0x7FFFFFFF)
                     % 1000000)
    u = api("/api/unlock", {"totp": code})
    okA = bool(u.get("ok")) and u["state"]["phase"] == "unlocked"
    results.append(("A demo重启后漂移(+120s)解锁", okA))
    api("/api/lock")

    # ---- B: pack 容器, 重启后漂移解锁 ----
    pk = api("/api/pack", {"src": pack_dir, "dst": pack_dst,
                           "digits": 6, "profile": "constrained"})
    pb32 = pk["pack"]["secret"] if "secret" in pk["pack"] else \
        pk["pack"].get("b32")
    stop_server(srv)

    srv = start_server()
    api("/api/open", {"path": pack_dst})
    drifted2 = int(time.time()) + 120
    cnt = int(drifted2 // 30)
    if pb32:
        key = base64.b32decode(pb32, casefold=True)
        mac = hmac.new(key, struct.pack(">Q", cnt), hashlib.sha1).digest()
        o = mac[19] & 0x0F
        pcode = "%06d" % ((struct.unpack(">I", mac[o:o+4])[0] & 0x7FFFFFFF)
                          % 1000000)
        u2 = api("/api/unlock", {"totp": pcode})
        okB = bool(u2.get("ok")) and u2["state"]["phase"] == "unlocked"
    else:
        okB = False
        print("pack payload keys:", list(pk["pack"]))
    results.append(("B pack重启后漂移(+120s)解锁", okB))
    stop_server(srv)

    # ---- C: 跨窗口解锁(回归: 旧版容器被封装时刻码锁死, >150s 即砖) ----
    # 等到 T+160s(超出 created±150s 补偿窗), 重启后用"当前"码解锁
    t_pack = int(time.time())
    while int(time.time()) - t_pack < 160:
        time.sleep(5)
    srv = start_server()                      # 注册表从磁盘恢复
    api("/api/open", {"path": pack_dst})
    u3 = api("/api/unlock", {"totp": totp_code6(pb32, int(time.time()))})
    okC = bool(u3.get("ok")) and u3["state"]["phase"] == "unlocked"
    results.append(("C 跨窗口(+160s)当前码解锁", okC))
    api("/api/lock")

    # ---- D: 空注册表 + 正确验证码 => 必须拒绝(fail-closed 安全断言) ----
    stop_server(srv)
    if os.path.exists(TEST_SECRETS):
        os.remove(TEST_SECRETS)               # 模拟无任何本机记录
    srv = start_server()
    api("/api/open", {"path": pack_dst})
    rejected = False
    try:
        api("/api/unlock", {"totp": totp_code6(pb32, int(time.time()))})
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        rejected = (exc.code == 400
                    and "E_AUTH_CODE" in body
                    and "密钥记录" in body)
    okD = rejected
    results.append(("D 空注册表正确码被拒(fail-closed)", okD))
    stop_server(srv)

    # 清理
    for f in (demo_dst, pack_dst, TEST_SECRETS):
        if os.path.exists(f):
            os.remove(f)
    shutil.rmtree(pack_dir, ignore_errors=True)

    fails = [n for n, ok in results if not ok]
    for n, ok in results:
        print("%-36s %s" % (n, "PASS" if ok else "FAIL"))
    if fails:
        raise SystemExit("FAILED: %s" % ", ".join(fails))
    print("ALL PASS")


if __name__ == "__main__":
    main()
