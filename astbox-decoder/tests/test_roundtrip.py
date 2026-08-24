# -*- coding: utf-8 -*-
"""End-to-end round trip: create a TOTP-only container, unlock it, extract,
modify it, and verify that password-slot containers are rejected."""
import os
import shutil
import struct
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (ROOT, os.path.join(ROOT, "deps")):
    if p not in sys.path:
        sys.path.insert(0, p)

from astbox import container as cont  # noqa: E402
from astbox import create  # noqa: E402
from astbox import crypto  # noqa: E402
from astbox import constants as C  # noqa: E402
from astbox.errors import AstboxError  # noqa: E402


def make_tmpdir():
    """Create a writable temp dir (os.makedirs default mode; avoids
    tempfile.mkdtemp, whose restrictive ACL breaks under some sandboxes)."""
    base = os.path.join(ROOT, "tmp", "test_runs")
    os.makedirs(base, exist_ok=True)
    d = os.path.join(base, "t%d_%d" % (os.getpid(), int(time.time() * 1000)))
    os.makedirs(d)
    return d


def make_demo_files():
    big = bytes((i * 7 + 3) % 256 for i in range(2 * 1048576 + 50000))
    return {
        "readme.txt": b"Hello ASTBOX!\n" * 100,
        "docs/guide.md": ("# Guide\n\nUnicode: 你好！\n".encode("utf-8")) * 50,
        "photos/landscape.bin": big,
        "empty.txt": b"",
        "docs/sub/deep.txt": b"nested file\n",
    }


def _find(uc, path):
    for p, e in cont.walk_entries(uc):
        if p == path:
            return e
    raise SystemExit("entry not found: %r" % path)


def main():
    crypto.selftest()
    print("crypto selftest OK")

    tmp = make_tmpdir()
    try:
        container_path = os.path.join(tmp, "demo.astbox")
        totp_code = "123456"
        files = make_demo_files()
        expected = {k: v for k, v in files.items()}

        # --- create with TOTP (sole credential type) ---
        uc = create.create_container(container_path, totp_code=totp_code,
                                     files=files)
        assert uc.parsed.header.generation == 0
        assert len(uc.parsed.slots) == 1 and uc.parsed.slots[0].is_totp
        print("created TOTP-only container (%d bytes)"
              % os.path.getsize(container_path))

        # --- unlock with wrong TOTP must fail ---
        try:
            cont.unlock_container(container_path, totp="999999")
            raise SystemExit("ERROR: wrong TOTP accepted")
        except AstboxError as exc:
            assert exc.code == 0x0300, hex(exc.code)
            print("wrong TOTP rejected OK (%s)" % exc.code_name)

        # --- unlock with correct TOTP ---
        uc = cont.unlock_container(container_path, totp=totp_code)
        paths = sorted(p for p, _ in cont.walk_entries(uc))
        print("entries:", paths)
        for p, e in cont.walk_entries(uc):
            if e.is_file:
                data = cont.read_file(uc, e)
                assert data == expected[p], "content mismatch for %r" % p
        print("all file contents verified")

        # --- password-slot containers are rejected at parse ---
        # craft a "legacy" container by patching the TOTP slot to PASSWORD
        with open(container_path, "rb") as f:
            raw = bytearray(f.read())
        slot_off = 128
        struct.pack_into(">H", raw, slot_off + 16, C.CRED_TYPE_PASSWORD)
        raw[slot_off + 18] = 0x00  # password CredentialParameters
        legacy = os.path.join(tmp, "legacy-pw.astbox")
        with open(legacy, "wb") as f:
            f.write(raw)
        try:
            cont.parse_container(legacy)
            raise SystemExit("ERROR: password-slot container accepted")
        except AstboxError as exc:
            assert exc.code == 0x0305, hex(exc.code)  # E_UNSUPPORTED_CREDENTIAL
            print("password-slot container rejected OK (%s)" % exc.code_name)

        # --- add files to an unlocked container (modification) ---
        from astbox import modify
        from astbox.errors import E_ALREADY_EXISTS
        c5 = os.path.join(tmp, "added.astbox")
        create.create_container(c5, totp_code="654321", files={"a.txt": b"A"})
        uc5 = cont.unlock_container(c5, totp="654321")
        added = modify.add_files(
            uc5, {"b.txt": b"B" * 3000, "sub/c.txt": b"C",
                  "sub/deep/d.txt": b"D" * (1048576 + 10)},
            c5, totp="654321")
        assert added.parsed.header.generation == 1, "generation must be 1"
        assert cont.read_file(added, _find(added, "b.txt")) == b"B" * 3000
        assert cont.read_file(added, _find(added, "sub/deep/d.txt")) \
            == b"D" * (1048576 + 10)
        # old file still there and intact
        assert cont.read_file(added, _find(added, "a.txt")) == b"A"
        # duplicate add must fail
        try:
            modify.add_files(added, {"a.txt": b"X"}, c5, totp="654321")
            raise SystemExit("ERROR: duplicate add accepted")
        except AstboxError as exc:
            assert exc.code == E_ALREADY_EXISTS
        # full verification of the modified container
        cont.verify_full(added)
        print("add-files modification OK (generation 0 -> 1, old data intact)")

        # --- tamper detection ---
        with open(container_path, "rb") as f:
            raw2 = bytearray(f.read())
        raw2[1000] ^= 0xFF  # corrupt a byte in the Data region
        tpath = os.path.join(tmp, "tampered.astbox")
        with open(tpath, "wb") as f:
            f.write(raw2)
        try:
            cont.unlock_container(tpath, totp=totp_code)
            raise SystemExit("ERROR: tampered container unlocked")
        except AstboxError as exc:
            print("tampered container rejected OK (%s)" % exc.code_name)

        # --- full verification ---
        cont.verify_full(uc)
        print("full (level-5) verification OK")

        print("\nALL ROUND-TRIP TESTS PASSED")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
