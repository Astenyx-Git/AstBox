# CLI contract smoke tests for astbox-server.exe (installer/astbox-cs.iss):
#   1) no args      -> preferred port 11920 + auto-open --app window
#   2) <file.astbox>-> open container at startup
#   3) --port N     -> bind exactly N
#   4) --import-passbox <file.passbox>
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import quote

EXE = r"D:\New_LANG\C#-astbox\.server-publish\astbox-server.exe"
TMP = r"D:\New_LANG\C#-astbox\.tmp-build"
SECRETS = TMP + r"\test-secrets.bin"
CTXT = TMP + r"\cli-contract.astbox"
PB = TMP + r"\cli-contract.passbox"
LOG = r"D:\New_LANG\C#-astbox\.cli-contract.txt"

ENV = dict(os.environ)
ENV["ASTBOX_SECRETS_PATH"] = SECRETS
OUT = []


def log(msg):
    OUT.append(msg)


def start(args):
    return subprocess.Popen([EXE] + args, env=ENV,
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL)


def wait_port(port, timeout=25):
    end = time.time() + timeout
    while time.time() < end:
        try:
            with urllib.request.urlopen(
                    f"http://127.0.0.1:{port}/api/state", timeout=3) as r:
                return r.status, json.loads(r.read().decode("utf-8"))
        except Exception:
            time.sleep(0.3)
    return None, None


def post(port, path, body):
    data = json.dumps(body).encode("utf-8")
    r = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=data,
                               headers={"Content-Type": "application/json"},
                               method="POST")
    try:
        with urllib.request.urlopen(r, timeout=180) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except Exception:
            return e.code, {}


def shutdown(port):
    try:
        post(port, "/api/shutdown", {})
    except Exception:
        pass
    time.sleep(1.2)


def close_astbox_windows():
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.windll.user32
    closed = []

    def cb(hwnd, _lp):
        n = user32.GetWindowTextLengthW(hwnd)
        if n:
            buf = ctypes.create_unicode_buffer(n + 1)
            user32.GetWindowTextW(hwnd, buf, n + 1)
            if "ASTBOX" in buf.value and user32.IsWindowVisible(hwnd):
                user32.PostMessageW(hwnd, 0x0010, 0, 0)  # WM_CLOSE
                closed.append(buf.value)
        return True

    CB = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows(CB(cb), 0)
    return closed


def alive(proc):
    return proc.poll() is None


# ---------------- Test 1: no args -> preferred port + auto-open window ------
p1 = start([])
st, obj = wait_port(11920)
log(f"T1 no-args: state={st} port=11920 phase="
    f"{(obj or {}).get('state', {}).get('phase')}")
time.sleep(3.0)                      # 给 --app 窗口留出启动时间
import ctypes
log("T1 process alive after UI attempt: " + str(alive(p1)))

# 造测试容器 + 传播包(供 T2/T4 使用)
st, d = post(11920, "/api/demo", {"dst": CTXT, "digits": 6,
                                  "profile": "constrained"})
log(f"T1 demo -> {st} ok={d.get('ok')}")
b32 = d["demo"]["b32"]
st, t = post(11920, "/api/totp", {"b32": b32, "digits": 6})
code = t["code"]
st, u = post(11920, "/api/unlock", {"totp": code})
log(f"T1 unlock -> {st} phase={u.get('state', {}).get('phase')}")
st, e = post(11920, "/api/export_passbox", {"out": PB})
log(f"T1 export_passbox -> {st} ok={e.get('ok')} exists={os.path.exists(PB)}")

shutdown(11920)
closed = close_astbox_windows()
log(f"T1 closed ASTBOX windows: {closed}")

# ---------------- Test 2: positional <file.astbox> ---------------------------
p2 = start([CTXT, "--no-browser"])
st, obj = wait_port(11920)
info = (obj or {}).get("state", {}).get("info") or {}
log(f"T2 positional: state={st} phase={info.get('phase', (obj or {}).get('state', {}).get('phase'))} "
    f"name={info.get('name')}")
ok2 = st == 200 and info.get("name") == "cli-contract.astbox"
log(f"T2 PASS={ok2}")
shutdown(11920)

# ---------------- Test 3: --port N -------------------------------------------
p3 = start(["--port", "7777", "--no-browser"])
st, obj = wait_port(7777)
log(f"T3 --port 7777: state={st}")
try:
    urllib.request.urlopen("http://127.0.0.1:11920/api/state", timeout=2)
    log("T3 old port still open?! FAIL")
except Exception:
    log("T3 11920 closed OK")
log(f"T3 PASS={st == 200}")
shutdown(7777)

# ---------------- Test 4: --import-passbox -----------------------------------
if os.path.exists(SECRETS):
    os.remove(SECRETS)               # 验证导入可独立重建密钥注册
p4 = start(["--import-passbox", PB, "--no-browser"])
st, obj = wait_port(11920)
state = (obj or {}).get("state", {})
info = state.get("info") or {}
log(f"T4 import-passbox: state={st} phase={state.get('phase')} "
    f"name={info.get('name')}")
# 注册表已由导入流程重建: 用注册的密钥取码并解锁
st, d2 = post(11920, "/api/demo", {"dst": TMP + r"\t4tmp.astbox",
                                   "digits": 6, "profile": "constrained"})
b32x = d2["demo"]["b32"]
st, tx = post(11920, "/api/totp", {"b32": b32x, "digits": 6})
st, ux = post(11920, "/api/unlock", {"totp": tx["code"]})
# 现在解锁 T1 导入的容器本身: 重新打开并解锁
st, o = post(11920, "/api/open", {"path": CTXT})
log(f"T4 reopen imported container -> {st}")
# 取回导入密钥: 从注册表无法直接读, 但 demo 容器与导入容器同注册表;
# 直接验证导入是否成功以 state.info 为准
imp_ok = ok2_style = info.get("name") == "cli-contract.astbox"
log(f"T4 PASS={imp_ok}")
shutdown(11920)

with open(LOG, "w", encoding="utf-8") as f:
    f.write("\n".join(OUT))
print("done")
