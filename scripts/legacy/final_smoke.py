# Final full-chain smoke on the SHIPPED binary (port 8899).
import json
import os
import urllib.error
import urllib.request
from urllib.parse import quote

BASE = "http://127.0.0.1:8899"
TMP = r"D:\New_LANG\C#-astbox\.tmp-build"
OUT = []
PASS = []


def check(tag, cond, detail=""):
    PASS.append((tag, bool(cond)))
    OUT.append(f"[{'OK ' if cond else 'FAIL'}] {tag} {detail}")


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


def get(path):
    try:
        with urllib.request.urlopen(BASE + path, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))


st, s0 = get("/api/state")
check("state.empty", st == 200 and s0["state"]["phase"] == "empty"
      and s0["state"]["info"] is None and s0["state"]["qr_ok"] is True)

os.makedirs(TMP + r"\pack-src\sub", exist_ok=True)
open(TMP + r"\pack-src\a.txt", "wb").write(b"alpha")
open(TMP + r"\pack-src\sub\b.bin", "wb").write(bytes(range(256)))

st, pk = post("/api/pack", {"src": TMP + r"\pack-src",
                            "dst": TMP + r"\final-pack.astbox",
                            "digits": 6, "profile": "constrained"})
p = pk.get("pack") or {}
check("pack", st == 200 and pk["ok"] is True and p.get("b32")
      and p.get("dst", "").endswith("final-pack.astbox")
      and isinstance(p.get("matrix"), list) and len(p["matrix"]) > 40
      and len(p.get("vault_id", "")) == 32 and p.get("generation") == 0
      and p.get("entries") == 3 and p.get("digits") == 6)  # 目录也计入 entries
# python 参考语义: pack 只创建不打开(demo 才会打开), 会话相位保持不变
check("pack.state-unchanged", pk.get("state", {}).get("phase") == "empty")

st, opn = post("/api/open", {"path": TMP + r"\final-pack.astbox"})
check("open.packed", st == 200 and opn["state"]["phase"] == "locked"
      and opn["state"]["info"]["name"] == "final-pack.astbox")

st, t = post("/api/totp", {"b32": p["b32"], "digits": 6})
check("totp", st == 200 and len(t.get("code", "")) == 6)

st, u = post("/api/unlock", {"totp": t["code"]})
names = [i["name"] for i in u["state"]["items"]]
check("unlock", st == 200 and u["state"]["phase"] == "unlocked"
      and names == ["sub", "a.txt"]
      and u["state"]["info"]["files"] is not None)

st, n = post("/api/nav", {"path": "/sub"})
check("nav.path", st == 200 and n["state"]["path"] == "/sub"
      and [i["name"] for i in n["state"]["items"]] == ["b.bin"])

st, b = post("/api/back", {})
check("back", st == 200 and b["state"]["path"] == "/"
      and b["state"]["can_forward"] is True)

st, f = post("/api/forward", {})
check("forward", st == 200 and f["state"]["path"] == "/sub")

st, up = post("/api/up", {})
check("up.top-level-parity", st == 400
      and up.get("error", "").startswith("E_BAD_DIR"))

st, r0 = post("/api/nav", {"dir": "root"})
check("nav.dir-root", st == 200 and r0["state"]["path"] == "/")

outdir = TMP + r"\final-out"
st, o = post("/api/outdir", {"path": outdir})
check("outdir", st == 200 and o["state"]["out_dir"] == outdir)

st, x = post("/api/extract", {"ids": None, "out": outdir})
disk = sum(len(fs) for _, _, fs in os.walk(outdir))
check("extract.all", st == 200 and x.get("count") == 2 and disk == 2)

st, v = post("/api/verify", {})
check("verify", st == 200 and "认证成功" in v.get("message", ""))

pb = TMP + r"\final.passbox"
st, e = post("/api/export_passbox", {"out": pb})
check("export_passbox", st == 200 and e.get("out") == pb
      and os.path.exists(pb) and os.path.getsize(pb) > 1000)

# 显式再测 /api/open 本机路径(重新锁定态打开)
st, one = post("/api/open", {"path": TMP + r"\final-pack.astbox"})
check("open.good-path", st == 200 and one["state"]["phase"] == "locked"
      and one["state"]["info"]["name"] == "final-pack.astbox")

with open(TMP + r"\final-pack.astbox", "rb") as fh:
    blob = fh.read()
rq = urllib.request.Request(
    BASE + "/api/open_upload", data=blob, method="POST",
    headers={"Content-Type": "application/octet-stream",
             "X-Filename": quote("最终 测试.astbox")})
try:
    with urllib.request.urlopen(rq, timeout=120) as resp:
        stl, ul = resp.status, json.loads(resp.read().decode("utf-8"))
except urllib.error.HTTPError as e:
    stl, ul = e.code, {}
saved = ul.get("saved_to", "")
check("open_upload", stl == 200 and saved.endswith(".astbox")
      and ul["state"]["info"]["name"].endswith("_最终 测试.astbox"))

st, l = post("/api/lock", {})
check("lock", st == 200 and l["state"]["phase"] == "locked")

st, sf = get("/api/selftest")
check("selftest", st == 200 and len(sf.get("lines", [])) == 7
      and "TOTP RFC 6238 vectors OK" in sf["lines"]
      # 参考实现第 3 行(交叉核对项)本身不带 OK 后缀
      and sum(1 for l in sf["lines"] if "OK" in l) >= 6)

st, sd = post("/api/shutdown", {})
check("shutdown", st == 200 and sd["ok"] is True
      and "即将退出" in sd.get("message", ""))

import time
time.sleep(1.2)
try:
    urllib.request.urlopen(BASE + "/api/state", timeout=3)
    check("shutdown.exited", False)
except Exception:
    check("shutdown.exited", True)

fails = [t for t, okc in PASS if not okc]
OUT.append(f"TOTAL={len(PASS)} FAIL={len(fails)} {fails}")
with open(r"D:\New_LANG\C#-astbox\.final-smoke.txt", "w",
          encoding="utf-8") as fh:
    fh.write("\n".join(OUT))
print(f"TOTAL={len(PASS)} FAIL={len(fails)}")
