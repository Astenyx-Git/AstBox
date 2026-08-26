import http.client

for p in ("/app.js", "/api/unknown", "/", "/icon.png"):
    conn = http.client.HTTPConnection("127.0.0.1", 8765, timeout=15)
    conn.request("GET", p)
    r = conn.getresponse()
    body = r.read()
    print(f"--- GET {p} -> {r.status}")
    for k, v in r.getheaders():
        print(f"    {k}: {v}")
    print(f"    body[:80]={body[:80]!r}")
    conn.close()
