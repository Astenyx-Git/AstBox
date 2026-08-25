#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Copyright 2026 Astenyx-Git
# SPDX-License-Identifier: Apache-2.0
"""ASTBOX v1.0 command-line decoder.

Subcommands:
    selftest                      run cryptographic self-tests
    info   FILE                   structural info (no credentials)
    unlock FILE [--totp C] [--list]
                                  unlock and verify the container
    extract FILE --out DIR [--totp C] [--path P] [--verify]
                                  decrypt files to a local directory
    create FILE [--totp-code C | --totp-secret B32] [--qr PNG]
                  [--totp-digits N] [--seed-dir DIR] [--demo]
                  [--profile high|constrained]
                                  create a TOTP-only container
    add    FILE --from-dir DIR [--totp C] [--out NEW]
                                  add files to a container
"""
import argparse
import os
import sys
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
_DEPS = os.path.join(_HERE, "deps")
if os.path.isdir(_DEPS):
    sys.path.insert(0, _DEPS)
sys.path.insert(0, _HERE)

from astbox import container as cont  # noqa: E402
from astbox import create  # noqa: E402
from astbox import crypto  # noqa: E402
from astbox import extract  # noqa: E402
from astbox import constants as C  # noqa: E402
from astbox.errors import AstboxError  # noqa: E402


def _human(n):
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if n < 1024 or unit == "TiB":
            return "%.1f %s" % (n, unit) if unit != "B" else "%d B" % n
        n /= 1024.0


def _fmt_time(t):
    try:
        return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(t))
    except (OverflowError, OSError, ValueError):
        return str(t)


def _slot_desc(slot):
    return "slot[%d] TOTP-%d %s (m=%d KiB, t=%d, p=%d)" % (
        slot.index, slot.totp_digits, slot.kdf_label,
        slot.argon2_memory_kib, slot.argon2_time, slot.argon2_parallelism)


def cmd_selftest(args):
    for line in crypto.selftest():
        print("  OK  " + line)
    print("cryptographic self-tests passed")


def cmd_info(args):
    pc = cont.parse_container(args.file)
    h = pc.header
    print("file        : %s" % os.path.abspath(args.file))
    print("size        : %s (%d bytes)" % (_human(len(pc.raw)), len(pc.raw)))
    print("magic       : %s" % h.magic.decode("ascii", "replace"))
    print("version     : %d" % h.version)
    print("vault id    : %s" % h.vault_id.hex())
    print("generation  : %d" % h.generation)
    print("key slots   : %d (region %d..%d)"
          % (h.key_slot_count, h.key_slot_offset,
             h.key_slot_offset + h.key_slot_length))
    for slot in pc.slots:
        print("    " + _slot_desc(slot))
        print("        slot id : %s" % slot.slot_id.hex())
    print("metadata    : offset %d length %d" % (h.metadata_offset,
                                                 h.metadata_length))
    print("data        : offset %d length %d" % (h.data_offset, h.data_length))
    print("footer      : offset %d length %d" % (h.footer_offset,
                                                 h.footer_length))
    print("footer mac  : %s" % pc.footer.footer_mac.hex())
    print("metadata dg : %s" % pc.footer.metadata_digest.hex())
    print("data dg     : %s" % pc.footer.data_digest.hex())


def _gather_totp(args):
    totp = args.totp
    if totp is None:
        try:
            totp = input("TOTP code: ").strip()
        except (EOFError, OSError):
            totp = None
    if not totp:
        raise AstboxError(C.E_NO_VALID_CREDENTIAL,
                          "a TOTP code is required (use --totp or run "
                          "interactively)")
    return totp


def cmd_unlock(args):
    pc = cont.parse_container(args.file)
    totp = _gather_totp(args)
    uc = cont.unlock_container(args.file, totp=totp)
    print("unlocked OK")
    print("vault id   : %s" % uc.parsed.header.vault_id.hex())
    print("generation : %d" % uc.parsed.header.generation)
    print("created    : %s" % _fmt_time(uc.created))
    print("modified   : %s" % _fmt_time(uc.modified))
    n_files = sum(1 for e in uc.entries.values() if e.is_file)
    n_dirs = sum(1 for e in uc.entries.values() if e.is_dir)
    total = sum(e.size for e in uc.entries.values() if e.is_file)
    print("entries    : %d files (%s), %d directories"
          % (n_files, _human(total), n_dirs))
    if args.verify:
        cont.verify_full(uc)
        print("verify     : all Data Records authenticated OK")
    if args.list:
        print("\ncontents:")
        for path, e in sorted(cont.walk_entries(uc)):
            if e.is_dir:
                print("    %-40s <dir>" % (path + "/"))
            else:
                print("    %-40s %s" % (path, _human(e.size)))


def cmd_extract(args):
    pc = cont.parse_container(args.file)
    totp = _gather_totp(args)
    uc = cont.unlock_container(args.file, totp=totp)
    if args.verify:
        cont.verify_full(uc)
        print("verify: all Data Records authenticated OK")
    os.makedirs(args.out, exist_ok=True)
    last = [0.0]

    def progress(msg, done, total):
        now = time.time()
        if now - last[0] > 0.5 or done == total:
            last[0] = now
            print("[%d/%d] %s" % (done, total, msg), flush=True)

    results = extract.extract_path(uc, args.path or "", args.out)
    print("extracted %d file(s) to %s" % (len(results),
                                          os.path.abspath(args.out)))


def cmd_create(args):
    profile = C.KDF_PROFILE_HIGH
    if args.profile == "constrained":
        profile = C.KDF_PROFILE_MEMORY_CONSTRAINED
    files = None
    if args.demo:
        files = _demo_files()
    totp_code = args.totp_code
    provision = None
    qr_secret = None
    digits = args.totp_digits or 6
    if args.totp_secret:
        import base64 as _b64
        qr_secret = _b64.b32encode(_b64.b32decode(
            args.totp_secret.strip().upper().replace(" ", ""),
            casefold=True)).decode().rstrip("=")
        totp_code = crypto.totp_at(qr_secret, digits)
        provision = (qr_secret, digits, args.file)
    elif args.qr or totp_code is None:
        # TOTP 为唯一凭据：没有给密钥/验证码就自动生成一个
        from astbox import qrutil
        qr_secret = qrutil.generate_secret()
        totp_code = crypto.totp_at(qr_secret, digits)
        provision = (qr_secret, digits, args.file)
    if qr_secret:
        uc = create.create_container(
            args.file, totp_secret=qr_secret, totp_digits=digits,
            files=files, seed_dir=args.seed_dir, kdf_profile=profile)
    else:
        uc = create.create_container(
            args.file, totp_code=totp_code, totp_digits=digits, files=files,
            seed_dir=args.seed_dir, kdf_profile=profile)
    print("created %s (%s), %d entries, generation %d"
          % (os.path.abspath(args.file), _human(os.path.getsize(args.file)),
             len(uc.entries), uc.parsed.header.generation))
    if provision:
        secret, digits, dst = provision
        print("TOTP provisioning (add to your authenticator):")
        print("  Base32: %s" % secret)
        print("  otpauth://totp/ASTBOX:%s?secret=%s&issuer=ASTBOX"
              "&algorithm=SHA1&digits=%d&period=30"
              % (os.path.basename(dst), secret, digits))
    if args.qr and qr_secret:
        from astbox import qrutil
        uri = qrutil.build_otpauth_uri(
            qr_secret, digits, "ASTBOX:%s" % os.path.basename(args.file))
        qrutil.save_qr_png(uri, args.qr)
        print("QR code saved to %s" % os.path.abspath(args.qr))
    print("self-verification: OK")


def cmd_add(args):
    pc = cont.parse_container(args.file)
    totp = _gather_totp(args)
    uc = cont.unlock_container(args.file, totp=totp)
    files = {}
    for root, _dirs, fnames in os.walk(args.from_dir):
        for fn in fnames:
            full = os.path.join(root, fn)
            rel = os.path.relpath(full, args.from_dir).replace("\\", "/")
            with open(full, "rb") as f:
                files[rel] = f.read()
    if not files:
        raise AstboxError(C.E_INVALID_ARGUMENT,
                          "no files found in %s" % args.from_dir)
    out = args.out or args.file
    from astbox import modify
    uc2 = modify.add_files(uc, files, out, totp=totp)
    print("added %d file(s); new generation %d -> %s"
          % (len(files), uc.parsed.header.generation,
             uc2.parsed.header.generation))
    print("written to %s" % os.path.abspath(out))


def _demo_files():
    text = (b"ASTBOX v1.0 demo file.\n\n"
            b"This container was created by astbox-cli create --demo.\n")
    big = bytes((i * 131 + 7) % 256 for i in range(2 * 1048576 + 12345))
    return {
        "readme.txt": text * 20,
        "docs/guide.md": b"# ASTBOX decoder guide\n\n"
                         b"Unlock -> browse -> extract.\n" * 40,
        "assets/random.bin": big,
        "empty.txt": b"",
        "docs/notes/测试.txt": "unicode file name test\n".encode("utf-8"),
    }


def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="astbox-cli",
        description="ASTBOX v1.0 container decoder (CLI)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("selftest", help="run cryptographic self-tests")

    p = sub.add_parser("info", help="show structural info")
    p.add_argument("file")

    p = sub.add_parser("unlock", help="unlock and verify a container")
    p.add_argument("file")
    p.add_argument("--totp", help="TOTP code (sole credential type)")
    p.add_argument("--list", action="store_true", help="list contents")
    p.add_argument("--verify", action="store_true",
                   help="authenticate all Data Records")

    p = sub.add_parser("extract", help="extract files to a directory")
    p.add_argument("file")
    p.add_argument("--out", required=True)
    p.add_argument("--totp", help="TOTP code (sole credential type)")
    p.add_argument("--path", default="",
                   help="extract only this logical path ('' = all)")
    p.add_argument("--verify", action="store_true")

    p = sub.add_parser("create", help="create a test container")
    p.add_argument("file")
    p.add_argument("--totp-code")
    p.add_argument("--totp-secret",
                   help="Base32 TOTP secret: compute the current code and "
                        "print provisioning info")
    p.add_argument("--qr", metavar="PNG",
                   help="save a scannable QR code PNG of the otpauth URI "
                        "(generates a TOTP secret if none is given)")
    p.add_argument("--totp-digits", type=int, choices=(6, 8))
    p.add_argument("--seed-dir", help="import files from a directory")
    p.add_argument("--demo", action="store_true",
                   help="embed a built-in demo file set")
    p.add_argument("--profile", choices=("high", "constrained"),
                   default="high")

    p = sub.add_parser("add", help="add files from a directory to a "
                                   "container (generation transaction)")
    p.add_argument("file")
    p.add_argument("--from-dir", required=True,
                   help="directory whose files are added")
    p.add_argument("--out", help="output path (default: modify in place)")
    p.add_argument("--totp", help="TOTP code (sole credential type)")

    args = ap.parse_args(argv)
    try:
        # Console robustness: never crash on characters the local codepage
        # cannot encode; prefer UTF-8 where the terminal supports it.
        for stream in (sys.stdout, sys.stderr):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except (AttributeError, ValueError):
                pass
        if args.cmd == "selftest":
            cmd_selftest(args)
        elif args.cmd == "info":
            cmd_info(args)
        elif args.cmd == "unlock":
            cmd_unlock(args)
        elif args.cmd == "extract":
            cmd_extract(args)
        elif args.cmd == "create":
            cmd_create(args)
        elif args.cmd == "add":
            cmd_add(args)
        return 0
    except AstboxError as exc:
        print("error: %s: %s" % (exc.code_name, exc.message),
              file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("interrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
