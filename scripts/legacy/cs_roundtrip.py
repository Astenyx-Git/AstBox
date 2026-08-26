# -*- coding: utf-8 -*-
"""Cross-implementation verification: unlock a C#-created .astbox container
with the Python reference implementation and dump per-file SHA-256.

Usage:
    python scripts/cs_roundtrip.py <container.astbox> <secret_b32> [totp_code]
"""
import hashlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def _ref_dir():
    """定位 python 参考实现(python 文件已从本工作区移除)。

    优先级: 环境变量 ASTBOX_REF > 工作区内 astbox-decoder/。
    需要时临时克隆: git clone https://github.com/Astenyx-Git/AstBox.git
    """
    cand = os.environ.get("ASTBOX_REF") or os.path.join(ROOT,
                                                        "astbox-decoder")
    if not os.path.isdir(cand):
        raise SystemExit(
            "未找到 python 参考实现。请临时克隆仓库并设置 ASTBOX_REF:\n"
            "  git clone https://github.com/Astenyx-Git/AstBox.git\n"
            "  set ASTBOX_REF=<克隆目录>\\astbox-decoder")
    return cand


_REF = _ref_dir()
sys.path.insert(0, _REF)
sys.path.insert(0, os.path.join(_REF, "deps"))

from astbox import container as rcont   # noqa: E402


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    path = sys.argv[1]
    secret = sys.argv[2]
    totp = sys.argv[3] if len(sys.argv) > 3 else None
    if secret in ("", "-", "none"):
        secret = None

    uc = rcont.unlock_container(path, secret_b32=secret, totp=totp)
    print("unlock OK: generation=%d created=%d modified=%d entries=%d" % (
        uc.parsed.header.generation, uc.created, uc.modified,
        len(uc.entries)))
    for rel, entry in rcont.walk_entries(uc):
        if entry.is_dir:
            print("DIR  %-40s" % rel)
            continue
        data = rcont.read_file(uc, entry)
        print("FILE %-40s %8d  %s" % (rel, len(data),
                                      hashlib.sha256(data).hexdigest()))
    # full Level-5 verification with the reference implementation
    rcont.verify_full(uc)
    print("verify_full OK (python reference)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
