# Probe astbox-server endpoints; write results to stdout file.
import json
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:8765"
OUT = []


def req(method, path, body=None, headers=None):
    url = BASE + path
    data = None
    hdrs = dict(headers or {})
    if body is not None:
        if isinstance(body, (dict, list)):
            data = json.dumps(body).encode("utf-8")
            hdrs["Content-Type"] = "application/json"
        else:
            data = body
            hdrs.setdefault("Content-Type", "application/octet-stream")
    r = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            raw = resp.read()
            OUT.append(f"{method} {path} -> {resp.status} ct={resp.headers.get('Content-Type')}")
            return resp.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read()
        OUT.append(f"{method} {path} -> {e.code} ct={e.headers.get('Content-Type')}")
        return e.code, raw


# --- static assets ---
for p in ("/", "/index.html", "/app.css", "/app.js", "/icon.png",
          "/favicon.ico", "/nope.txt"):
    st, raw = req("GET", p)
    head = raw[:60]
    if p.endswith((".html", ".css", ".js")) or p == "/":
        OUT.append(f"   body[:60]={head!r}")
    elif p == "/favicon.ico" or p == "/nope.txt":
        OUT.append(f"   body={raw.decode('utf-8', 'replace')}")
    else:
        OUT.append(f"   bytes={len(raw)} magic={raw[:8].hex()}")

# --- api errors ---
st, raw = req("POST", "/api/open", {"path": r"D:\nonexistent\x.astbox"})
OUT.append(f"   body={raw.decode('utf-8', 'replace')}")

st, raw = req("GET", "/api/unknown")
OUT.append(f"   body={raw.decode('utf-8', 'replace')}")

st, raw = req("POST", "/api/unknown_post", {})
OUT.append(f"   body={raw.decode('utf-8', 'replace')}")

st, raw = req("POST", "/api/extract", {"ids": None,
                                       "out": r"D:\New_LANG\C#-astbox\.tmp-build\out-e2e"})
OUT.append(f"   body={raw.decode('utf-8', 'replace')}")

st, raw = req("POST", "/api/unlock", {"totp": "000000"})
OUT.append(f"   body={raw.decode('utf-8', 'replace')}")

st, raw = req("POST", "/api/totp", {"b32": "JBSWY3DPEHPK3PXP", "digits": 7})
OUT.append(f"   body={raw.decode('utf-8', 'replace')}")

st, raw = req("POST", "/api/nav", {"dir": "zzzz"})
OUT.append(f"   body={raw.decode('utf-8', 'replace')}")

# --- upload e2e: re-upload demo container ---
with open(r"D:\New_LANG\C#-astbox\.tmp-build\demo-e2e.astbox", "rb") as f:
    payload = f.read()
from urllib.parse import quote
st, raw = req("POST", "/api/open_upload", payload,
              {"X-Filename": quote("e2e-upload.astbox")})
OUT.append(f"   body={raw.decode('utf-8', 'replace')[:400]}")

with open(r"D:\New_LANG\C#-astbox\.probe-py.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(OUT))
print("done")
