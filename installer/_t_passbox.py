# -*- coding: utf-8 -*-
"""传播包(.passbox)端到端验证(对已安装栈):

  P1 模块级: 口令包/快速包 往返 + 篡改拒绝 + 错误口令拒绝
  P2 E2E:    设备A导出 -> 全新密钥库设备B --import-passbox 启动导入
             -> 输入当前验证码解锁 (跨设备能力本体)
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
TMP = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(BASE, "app"))
sys.path.insert(0, os.path.join(BASE, "app", "deps"))

results = []


def check(name, ok):
    results.append((name, ok))


def totp_code(b32, t, digits=6):
    key = base64.b32decode(b32 + "=" * ((-len(b32)) % 8), casefold=True)
    cnt = int(t // 30)
    mac = hmac.new(key, struct.pack(">Q", cnt), hashlib.sha1).digest()
    o = mac[19] & 0x0F
    mod = 10 ** digits
    return str((struct.unpack(">I", mac[o:o + 4])[0] & 0x7FFFFFFF)
               % mod).zfill(digits)


_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def api(url, route, payload=None, timeout=300):
    data = json.dumps(payload or {}).encode()
    req = urllib.request.Request(url + route, data=data,
                                 headers={"Content-Type":
                                          "application/json"})
    try:
        with _OPENER.open(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:300]
        raise SystemExit("API %s -> HTTP %d\n%s" % (route, e.code, body))


def free_port(start):
    import socket
    port = start
    while port < start + 50:
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                port += 1
    raise SystemExit("no free port")


def start_server(port, secrets_path, extra=()):
    env = dict(os.environ)
    env["ASTBOX_SECRETS_PATH"] = secrets_path
    cmd = [PY, SRV, "--port", str(port), "--no-browser"] + list(extra)
    p = subprocess.Popen(cmd, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, env=env)
    url = "http://127.0.0.1:%d" % port
    for _ in range(50):
        time.sleep(0.4)
        if p.poll() is not None:
            break                                   # 子进程已退出(端口被占等)
        try:
            with urllib.request.urlopen(url + "/api/state",
                                        timeout=2) as r:
                body = json.loads(r.read().decode())
            if r.status == 200 and isinstance(body, dict) \
                    and "state" in body:
                return p, url
        except Exception:
            continue
    kill(p)
    raise SystemExit("server failed to start on %d" % port)


def stop(p):
    try:
        p.kill()
    except Exception:
        pass


def kill(p):
    try:
        p.kill()
    except Exception:
        pass


workdir = os.path.join(TMP, "_t_pb_work")
shutil.rmtree(workdir, ignore_errors=True)
os.makedirs(workdir)
srcdir = os.path.join(workdir, "src")
os.makedirs(srcdir)
with open(os.path.join(srcdir, "note.txt"), "w", encoding="utf-8") as f:
    f.write("passbox e2e")

secA = os.path.join(workdir, "secrets_A.bin")
secB = os.path.join(workdir, "secrets_B.bin")
ast = os.path.join(workdir, "demo.astbox")
pb_quick = os.path.join(workdir, "demo.quick.passbox")
pb_pass = os.path.join(workdir, "demo.protected.passbox")

for f in (secA, secB):
    if os.path.exists(f):
        os.remove(f)

# ---- 设备A: 封装 + 导出 ----
portA = free_port(18896)
pA, urlA = start_server(portA, secA)
pk = api(urlA, "/api/pack", {"src": srcdir, "dst": ast,
                             "digits": 6, "profile": "constrained"})
pack = pk.get("pack", {})
b32 = pack.get("secret") or pack.get("b32")
check("P0 设备A封装并取得密钥", bool(b32))
api(urlA, "/api/open", {"path": ast})
api(urlA, "/api/unlock", {"totp": totp_code(b32, time.time())})

r1 = api(urlA, "/api/export_passbox",
         {"out": pb_quick, "passphrase": ""})
r2 = api(urlA, "/api/export_passbox",
         {"out": pb_pass, "passphrase": "pw123"})
check("P1a 快速包+口令包导出成功",
      r1.get("ok") and r2.get("ok")
      and os.path.isfile(pb_quick) and os.path.isfile(pb_pass))
kill(pA)

# ---- P2 模块级往返/防篡改 ----
from astbox import passbox as pbm            # noqa: E402
from astbox.errors import AstboxError        # noqa: E402

info, needs = pbm.read_info(pb_pass)
s2, _h, c2 = pbm.unwrap_secret(pb_pass, "pw123")
check("P2a 口令包正确口令解出密钥", s2 == b32.upper().replace(" ", "")
      and os.path.isfile(c2))
bad = False
try:
    pbm.unwrap_secret(pb_pass, "wrong")
except AstboxError:
    bad = True
check("P2b 错误口令被拒", bad)
data = bytearray(open(pb_quick, "rb").read())
data[len(data) // 2] ^= 0xFF
tamp = pb_quick + ".tampered"
open(tamp, "wb").write(data)
tampered = False
try:
    pbm.unwrap_secret(tamp, None)
except AstboxError:
    tampered = True
check("P2c 篡改包被完整性校验拒绝", tampered)

# ---- P3 E2E: 全新设备B 双击导入(--import-passbox) ----
pB, urlB = start_server(free_port(18900), secB,
                        extra=["--import-passbox", pb_quick])
req_g = urllib.request.Request(urlB + "/api/state")
with _OPENER.open(req_g, timeout=10) as rg:
    st = json.loads(rg.read().decode())
phase = st["state"]["phase"]
iname = (st["state"].get("info") or {}).get("name")
code = totp_code(b32, time.time())
unlock_err = None
try:
    api(urlB, "/api/unlock", {"totp": code})
    unlocked = True
except SystemExit as exc:
    unlocked = False
    unlock_err = str(exc)[:200]
except Exception as exc:
    unlocked = False
    unlock_err = repr(exc)[:200]
detail = ("phase=%r name=%r unlocked=%s err=%s"
          % (phase, iname, unlocked, unlock_err))
if not (phase == "locked" and iname
        and iname.startswith("demo") and unlocked):
    print("P3 detail:", detail)
check("P3 新设备导入后当前码解锁(跨设备本体)",
      phase == "locked" and bool(iname)
      and iname.startswith("demo") and unlocked)
kill(pB)

# 清理
shutil.rmtree(workdir, ignore_errors=True)
os.remove(tamp) if os.path.exists(tamp) else None

fails = [n for n, ok in results if not ok]
for n, ok in results:
    print("%-36s %s" % (n, "PASS" if ok else "FAIL"))
if fails:
    raise SystemExit("FAILED: %s" % ", ".join(fails))
print("ALL PASS")
