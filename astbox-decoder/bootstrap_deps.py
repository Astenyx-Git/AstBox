#!/usr/bin/env python3
# Copyright 2026 Astenyx-Git
# SPDX-License-Identifier: Apache-2.0
"""Bootstrap the two native cryptography dependencies for ASTBOX decoder.

Tries `pip install --target deps` first (normal environments).  If pip fails
(e.g. running under a restricted sandbox where pip's temp-dir handling is
blocked), falls back to a pure-stdlib download of the correct wheels from
PyPI and extracts them into ./deps with permission-friendly directory
creation.

Packages installed:
    argon2-cffi          - Argon2id (TOTP KDF)
    argon2-cffi-bindings - compiled Argon2 core (abi3 wheel)
    cffi, pycparser      - cffi runtime needed by the two bindings
    pynacl               - XChaCha20-Poly1305 (libsodium)
    qrcode, typing-extensions - QR code generation for TOTP provisioning
"""
import json
import os
import shutil
import subprocess
import sys
import urllib.request
import zipfile

BASE = os.path.dirname(os.path.abspath(__file__))
DEPS = os.path.join(BASE, "deps")
WHEELS = os.path.join(BASE, "wheels")

PACKAGES = ["argon2-cffi", "argon2-cffi-bindings", "cffi", "pycparser",
            "pynacl", "qrcode", "pypng", "typing-extensions"]


def pip_install():
    """Try a normal pip --target install; returns True on success."""
    print(">>> Attempting pip install --target deps ...")
    env = dict(os.environ)
    tmp = os.path.join(BASE, "tmp")
    os.makedirs(tmp, exist_ok=True)
    env["TMP"] = tmp
    env["TEMP"] = tmp
    cmd = [
        sys.executable, "-m", "pip", "install", "--disable-pip-version-check",
        "--no-input", "--timeout", "15", "--retries", "1",
        "--target", DEPS,
    ] + PACKAGES
    proc = subprocess.run(cmd, env=env, stdout=subprocess.PIPE,
                          stderr=subprocess.STDOUT, text=True, timeout=120)
    if proc.returncode == 0 and os.path.isdir(os.path.join(DEPS, "argon2")):
        print(">>> pip install succeeded.")
        return True
    print(">>> pip install failed; using manual wheel download fallback.")
    return False


def _fetch(url, tries=3):
    import time
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=30) as resp:
                return resp.read()
        except Exception as exc:  # transient network errors
            last = exc
            time.sleep(1 + i)
    raise last


def pick_wheel(pkg):
    import re
    data = json.loads(_fetch("https://pypi.org/pypi/%s/json" % pkg))
    version = data["info"]["version"]
    files = data["releases"][version]
    pure = [f for f in files if f["filename"].endswith("py3-none-any.whl")]
    if pure:
        return version, pure[0]
    # Exclude free-threaded builds (cp314t / cp315t): they need the -t
    # interpreter and cannot load on the standard build.
    win = [f for f in files
           if f["filename"].endswith(".whl")
           and "win_amd64" in f["filename"]
           and not re.search(r"-cp\d+t-", f["filename"])]
    if not win:
        raise RuntimeError("no suitable win_amd64 wheel for %s" % pkg)

    def tagscore(fn):
        # Prefer abi3 (portable), then exact CPython version match, newest first.
        pref = ["abi3", "cp314", "cp313", "cp312", "cp311", "cp310"]
        for i, tag in enumerate(pref):
            if "-" + tag + "-" in fn:
                return i
        return 99

    win.sort(key=lambda f: tagscore(f["filename"]))
    return version, win[0]


def extract_wheel(whl_path, target):
    """Extract a wheel with os.makedirs(default-mode) so the result is
    writable even under sandboxes that restrict os.mkdir(mode=0o700)."""
    os.makedirs(target, exist_ok=True)
    with zipfile.ZipFile(whl_path) as z:
        for member in z.infolist():
            if member.is_dir():
                continue
            out = os.path.join(target, member.filename)
            # Guard against zip slip.
            norm = os.path.normpath(member.filename)
            if norm.startswith("..") or os.path.isabs(norm):
                raise RuntimeError("unsafe path in wheel: %r" % member.filename)
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with open(out, "wb") as f:
                f.write(z.read(member.filename))


def manual_install():
    print(">>> Downloading wheels from PyPI ...")
    os.makedirs(WHEELS, exist_ok=True)
    os.makedirs(DEPS, exist_ok=True)
    for pkg in PACKAGES:
        version, file_info = pick_wheel(pkg)
        url = file_info["url"]
        fname = file_info["filename"]
        dest = os.path.join(WHEELS, fname)
        if not os.path.exists(dest) or os.path.getsize(dest) != file_info["size"]:
            print("    %s %s (%d bytes)" % (pkg, version, file_info["size"]))
            with open(dest, "wb") as f:
                f.write(_fetch(url))
        else:
            print("    cached %s" % fname)
        extract_wheel(dest, DEPS)
    print(">>> Done. deps ->", DEPS)


def check():
    sys.path.insert(0, DEPS)
    try:
        import argon2  # noqa: F401
        import cffi  # noqa: F401
        import nacl  # noqa: F401
        import qrcode  # noqa: F401
        from nacl import bindings  # noqa: F401
        print(">>> argon2 + cffi + pynacl + qrcode import OK")
        return True
    except Exception as exc:  # pragma: no cover
        print(">>> import check failed: %r" % exc)
        return False


def main():
    skip_pip = "--skip-pip" in sys.argv
    ok = False if skip_pip else pip_install()
    if not ok:
        # pip may have left a partially created ./deps with restrictive ACLs
        # (see extract_wheel notes); drop it and rebuild from wheels.
        shutil.rmtree(DEPS, ignore_errors=True)
        manual_install()
    if not check():
        sys.exit("FATAL: dependencies could not be set up; see output above.")
    print(">>> Bootstrap complete.")


if __name__ == "__main__":
    main()
