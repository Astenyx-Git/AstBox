# Graceful-shutdown my three leftover servers on their REAL ports,
# then prove the DPAPI secrets registry round-trips across processes.
import base64
import ctypes
import json
import os
import time
import urllib.request

SECRETS = r"D:\New_LANG\C#-astbox\.tmp-build\test-secrets.bin"
MAGIC = b"ASTBOX1\x00"


def post(port, path):
    r = urllib.request.Request(f"http://127.0.0.1:{port}{path}",
                               data=b"{}",
                               headers={"Content-Type": "application/json"},
                               method="POST")
    try:
        with urllib.request.urlopen(r, timeout=10) as resp:
            return resp.status, resp.read(120).decode("utf-8", "replace")
    except Exception as e:
        return None, type(e).__name__


print("shutdown 21524 ->", post(21524, "/api/shutdown"))
print("shutdown 6583  ->", post(6583, "/api/shutdown"))
print("shutdown 8466  ->", post(8466, "/api/shutdown"))
time.sleep(2.0)


def dpapi_unprotect(blob):
    class BLOB(ctypes.Structure):
        _fields_ = [("cb", ctypes.c_uint32), ("pb", ctypes.c_void_p)]
    buf = ctypes.create_string_buffer(blob, len(blob))
    inp = BLOB(len(blob), ctypes.cast(buf, ctypes.c_void_p).value)
    out = BLOB()
    if not ctypes.windll.crypt32.CryptUnprotectData(
            ctypes.byref(inp), None, None, None, None, 1, ctypes.byref(out)):
        raise OSError("CryptUnprotectData failed")
    try:
        return ctypes.string_at(out.pb, out.cb)
    finally:
        ctypes.windll.kernel32.LocalFree(ctypes.c_void_p(out.pb))


raw = dpapi_unprotect(open(SECRETS, "rb").read()[len(MAGIC):])
store = json.loads(raw.decode("utf-8"))
print("registry entries:", len(store))
for vid, ent in store.items():
    print("  vid=%s digits=%s b32[:8]=%s" %
          (vid[:16], ent.get("digits"), str(ent.get("b32"))[:8]))

# 用注册表中的密钥解锁 6583 上仍活着的会话前先确认它还在;
# 若已被上面 shutdown 掉则跳过(仅验证注册表本身)。
try:
    urllib.request.urlopen("http://127.0.0.1:6583/api/state", timeout=3)
    vid, ent = next(iter(store.items()))
    st, body = post.__wrapped__ if False else (None, None)
    import urllib.error
    data = json.dumps({"b32": ent["b32"], "digits": ent["digits"]}).encode()
    rq = urllib.request.Request("http://127.0.0.1:6583/api/totp", data=data,
                                headers={"Content-Type": "application/json"},
                                method="POST")
    code = json.loads(urllib.request.urlopen(rq, timeout=30).read())["code"]
    data = json.dumps({"totp": code}).encode()
    rq = urllib.request.Request("http://127.0.0.1:6583/api/unlock", data=data,
                                headers={"Content-Type": "application/json"},
                                method="POST")
    u = json.loads(urllib.request.urlopen(rq, timeout=60).read())
    print("cross-process unlock:", u["ok"], u["state"]["phase"])
    post(6583, "/api/shutdown")
except Exception as e:
    print("6583 already down:", type(e).__name__)
