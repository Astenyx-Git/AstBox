# -*- coding: utf-8 -*-
"""上传链路端到端验证(对已安装栈):
  T1: ~600MiB 容器经 /api/open_upload 上传 -> 解锁成功 (旧版 512MiB 必失败)
  T2: 超 4GiB 声明体被拒绝时, 客户端能读到 JSON 错误而非连接重置
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


def api_json(route, payload=None, timeout=600):
    data = json.dumps(payload or {}).encode("utf-8")
    req = urllib.request.Request(URL + route, data=data,
                                 headers={"Content-Type":
                                          "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def start_server():
    # 测试隔离: 密钥注册表重定向到临时文件, 绝不触碰真实 secrets.bin
    env = dict(os.environ)
    env["ASTBOX_SECRETS_PATH"] = os.path.join(TMP, "_t_secrets.bin")
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
        api_json("/api/shutdown")
    except Exception:
        pass
    try:
        p.wait(timeout=10)
    except Exception:
        p.kill()


def totp6(b32, t=None):
    key = base64.b32decode(b32, casefold=True)
    cnt = int((t or time.time()) // 30)
    mac = hmac.new(key, struct.pack(">Q", cnt), hashlib.sha1).digest()
    o = mac[19] & 0x0F
    return "%06d" % ((struct.unpack(">I", mac[o:o+4])[0] & 0x7FFFFFFF)
                     % 1000000)


def upload(path, name):
    """模拟浏览器: POST 文件字节流到 /api/open_upload。"""
    size = os.path.getsize(path)
    req = urllib.request.Request(URL + "/api/open_upload",
                                 data=open(path, "rb").read(),
                                 method="POST")
    req.add_header("Content-Type", "application/octet-stream")
    req.add_header("X-Filename", name)
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))


def main():
    results = []
    srcdir = os.path.join(TMP, "_t_up_src")
    dst = os.path.join(srcdir, "_t_big.astbox")
    test_secrets = os.path.join(TMP, "_t_secrets.bin")
    if os.path.exists(test_secrets):
        os.remove(test_secrets)          # 只清测试密钥库, 不碰真实文件
    shutil.rmtree(srcdir, ignore_errors=True)
    os.makedirs(srcdir)

    # ---- T1: 打包 ~600MiB 容器并走上传通道 ----
    srv = start_server()
    bigfile = os.path.join(srcdir, "blob.bin")
    chunk = os.urandom(1048576)
    with open(bigfile, "wb") as f:
        for _ in range(600):                    # 600 MiB
            f.write(chunk)
    pk = api_json("/api/pack", {"src": srcdir, "dst": dst,
                                "digits": 6, "profile": "constrained"})
    b32 = pk["pack"]["secret"] if "secret" in pk["pack"] \
        else pk["pack"].get("b32")
    stop_server(srv)

    srv = start_server()                        # 新会话: 无注册表状态
    st, body = upload(dst, "big.astbox")
    ok_t1a = (st == 200 and body.get("ok"))
    code = totp6(b32)                           # 手输码(无注册表辅助)
    u = api_json("/api/unlock", {"totp": code})
    ok_t1b = bool(u.get("ok")) and u["state"]["phase"] == "unlocked"
    results.append(("T1 600MiB上传并解锁", ok_t1a and ok_t1b))
    api_json("/api/lock")

    # ---- T2: 超限声明体 -> 可读 JSON 错误(非 RST) ----
    over = 4 * 1024 * 1024 * 1024 + 1          # 4 GiB + 1 字节

    def gen():
        sent = 0
        blk = b"\x00" * 4194304
        while sent < over:
            n = min(len(blk), over - sent)
            yield blk[:n]
            sent += n
    import http.client
    conn = http.client.HTTPConnection("127.0.0.1", PORT, timeout=300)
    conn.putrequest("POST", "/api/open_upload")
    conn.putheader("Content-Type", "application/octet-stream")
    conn.putheader("X-Filename", "huge.astbox")
    conn.putheader("Content-Length", str(over))
    conn.endheaders()
    for piece in gen():
        conn.send(piece)
    resp = conn.getresponse()
    payload = json.loads(resp.read().decode("utf-8"))
    ok_t2 = (resp.status == 400 and payload.get("ok") is False
             and "4 GiB" in payload.get("error", ""))
    conn.close()
    results.append(("T2 超限请求返回可读错误", ok_t2))

    stop_server(srv)
    # 清理
    shutil.rmtree(srcdir, ignore_errors=True)

    fails = [n for n, ok in results if not ok]
    for n, ok in results:
        print("%-28s %s" % (n, "PASS" if ok else "FAIL"))
    if fails:
        raise SystemExit("FAILED: %s" % ", ".join(fails))
    print("ALL PASS")


if __name__ == "__main__":
    sys.exit(main())
