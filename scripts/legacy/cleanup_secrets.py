# -*- coding: utf-8 -*-
"""Safely inspect/remove entries from the REAL %LOCALAPPDATA%\\ASTBOX\\secrets.bin.

Uses the reference implementation's own DPAPI load/save so the format stays
byte-compatible. A timestamped backup is written before any modification.

Usage:
    python scripts/cleanup_secrets.py            # list entries
    python scripts/cleanup_secrets.py --remove <vault_id>
"""
import os
import shutil
import sys
import time

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

# 确保使用真实密钥库(清掉可能存在的重定向)
os.environ.pop("ASTBOX_SECRETS_PATH", None)

from astbox_server import load_secrets, save_secrets, _SECRETS_PATH  # noqa: E402


def main():
    argv = sys.argv[1:]
    remove_vid = None
    if argv and argv[0] == "--remove" and len(argv) >= 2:
        remove_vid = argv[1].strip().lower()

    store = load_secrets()
    print("store: %s" % _SECRETS_PATH)
    print("entries: %d" % len(store))
    for vid, e in sorted(store.items(),
                         key=lambda kv: kv[1].get("created") or 0):
        created = e.get("created")
        when = time.strftime("%Y-%m-%d %H:%M:%S",
                             time.localtime(created)) if created else "?"
        print("  vid=%s  digits=%s  created=%s (%s)  b32=%s..."
              % (vid[:16], e.get("digits"), when, created,
                 str(e.get("b32"))[:10]))

    if remove_vid is None:
        return 0

    matches = [k for k in store if k.startswith(remove_vid)]
    if len(matches) != 1:
        print("prefix %r matches %d keys; nothing removed"
              % (remove_vid, len(matches)))
        return 1
    remove_vid = matches[0]

    backup = _SECRETS_PATH + ".bak-" + time.strftime("%Y%m%d-%H%M%S")
    if os.path.exists(_SECRETS_PATH):
        shutil.copy2(_SECRETS_PATH, backup)
        print("backup written: %s" % backup)

    removed = store.pop(remove_vid)
    save_secrets(store)

    check = load_secrets()
    ok = remove_vid not in check and len(check) == len(store)
    print("removed vid=%s (b32=%s...) ; post-check entries=%d ok=%s"
          % (remove_vid[:16], str(removed.get("b32"))[:10],
             len(check), ok))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
