# Deep E2E against astbox-server: nav history, extract, add, export_passbox.
import json
import os
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:8765"
TMP = r"D:\New_LANG\C#-astbox\.tmp-build"
OUT = []


def post(path, body):
    data = json.dumps(body).encode("utf-8")
    r = urllib.request.Request(BASE + path, data=data,
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


def show(tag, st, obj):
    OUT.append(f"{tag} -> {st} ok={obj.get('ok')}" +
               ("" if obj.get("ok") else f" err={obj.get('error')}"))


st, d = post("/api/demo", {"dst": TMP + r"\e2e-final.astbox",
                           "digits": 6, "profile": "constrained"})
show("DEMO", st, d)
b32 = d["demo"]["b32"]

st, t = post("/api/totp", {"b32": b32, "digits": 6})
show("TOTP", st, t)
code = t["code"]

st, u = post("/api/unlock", {"totp": code})
show("UNLOCK", st, u)
names = [i["name"] for i in u["state"]["items"]]
OUT.append(f"  root items={names}")

st, n = post("/api/nav", {"path": "/docs"})
show("NAV docs", st, n)
names = [(i["name"], i["is_dir"], i["size_h"]) for i in n["state"]["items"]]
OUT.append(f"  docs items={names} path={n['state']['path']}")

st, b = post("/api/back", {})
show("BACK", st, b)
OUT.append(f"  path={b['state']['path']} fwd={b['state']['can_forward']}")

st, f = post("/api/forward", {})
show("FORWARD", st, f)
OUT.append(f"  path={f['state'].get('path')}")

# 与 python 参考一致的已知怪癖: 从顶层目录向上(父=ROOT 不在 entries)
# 会得到 400 E_BAD_DIR —— 这里验证该行为被忠实移植。
st, up = post("/api/up", {})
show("UP-from-top-level", st, up)
OUT.append(f"  err={up.get('error')!r}")

st, n2 = post("/api/nav", {"dir": "root"})
show("NAV root", st, n2)
OUT.append(f"  path={n2['state'].get('path')}")

st, o = post("/api/outdir", {"path": TMP + r"\out-e2e2"})
show("OUTDIR", st, o)

st, x = post("/api/extract", {"ids": None, "out": TMP + r"\out-e2e2"})
show("EXTRACT-ALL", st, x)
count = x.get("count")
files = sum(len(fs) for _, _, fs in os.walk(TMP + r"\out-e2e2"))
OUT.append(f"  count={count} files_on_disk={files}")

st, v = post("/api/verify", {})
show("VERIFY", st, v)

st, a = post("/api/add", {"paths": [TMP + r"\demo-e2e.astbox"]})
show("ADD", st, a)
if st == 200:
    OUT.append(f"  count={a.get('count')} gen={a['state']['info']['generation']}")

st, e = post("/api/export_passbox", {"out": TMP + r"\e2e-final.passbox"})
show("EXPORT-PASSBOX", st, e)
pb = TMP + r"\e2e-final.passbox"
OUT.append(f"  passbox_size={os.path.getsize(pb) if os.path.exists(pb) else 'MISSING'}")

st, l = post("/api/lock", {})
show("LOCK", st, l)

r = urllib.request.Request(BASE + "/api/state")
with urllib.request.urlopen(r, timeout=30) as resp:
    stt = json.loads(resp.read().decode("utf-8"))
OUT.append(f"STATE-FINAL phase={stt['state']['phase']} "
           f"out_dir={stt['state']['out_dir']}")

with open(r"D:\New_LANG\C#-astbox\.probe-e2e.txt", "w", encoding="utf-8") as fh:
    fh.write("\n".join(OUT))
print("done")
