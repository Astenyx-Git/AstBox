# -*- coding: utf-8 -*-
"""GUI smoke test for the Explorer-style UI: parse -> unlock -> navigate
-> extract -> package wizard -> add files -> lock."""
import os
import shutil
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (ROOT, os.path.join(ROOT, "deps")):
    if p not in sys.path:
        sys.path.insert(0, p)

import tkinter as tk  # noqa: E402

import astbox_gui  # noqa: E402
from astbox import container as cont  # noqa: E402
from astbox import create  # noqa: E402
from astbox import crypto  # noqa: E402
from astbox.errors import AstboxError  # noqa: E402
from astbox_gui import AstboxGui, PackageDialog, _demo_files  # noqa: E402

# messageboxes are modal; make them no-ops in the automated test
astbox_gui.messagebox.showinfo = lambda *a, **k: None
astbox_gui.messagebox.showwarning = lambda *a, **k: None
astbox_gui.messagebox.showerror = lambda *a, **k: None


def _pump(root, cond, timeout=90.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        root.update()
        if cond():
            return True
        time.sleep(0.05)
    return False


def _find_item(gui, name, is_dir=None):
    for iid, entry in gui.item_entry.items():
        if entry.name == name and (is_dir is None
                                   or entry.is_dir == is_dir):
            return iid, entry
    return None, None


def main():
    base = os.path.join(ROOT, "tmp", "gui_smoke2")
    shutil.rmtree(base, ignore_errors=True)
    os.makedirs(base, exist_ok=True)

    # prepare a source folder for the packaging test
    src_dir = os.path.join(base, "source")
    os.makedirs(os.path.join(src_dir, "sub"), exist_ok=True)
    with open(os.path.join(src_dir, "hello.txt"), "wb") as f:
        f.write(b"packaged content\n")
    with open(os.path.join(src_dir, "sub", "nested.bin"), "wb") as f:
        f.write(bytes(range(256)) * 5)

    container = os.path.join(base, "demo.astbox")
    create.create_container(container, totp_code="654321", files=_demo_files())
    print("demo container created")

    root = tk.Tk()
    root.withdraw()
    gui = AstboxGui(root)

    # --- parse ---
    gui._open_path(container)
    assert _pump(root, lambda: gui.pc is not None and not gui.busy), "parse"
    print("parse OK; slots:", len(gui.pc.slots))

    # --- unlock ---
    gui.totp_var.set("654321")
    gui.do_unlock()
    assert _pump(root, lambda: gui.uc is not None and not gui.busy), "unlock"
    assert len(gui.tree.get_children()) > 0
    print("unlock OK; root items:", len(gui.tree.get_children()))

    # --- navigate into docs, back up ---
    iid, entry = _find_item(gui, "docs", is_dir=True)
    assert entry, "docs dir not listed"
    gui._navigate(entry.file_id)
    assert gui.addr_var.get() == "/docs", gui.addr_var.get()
    gui.nav_up()
    assert gui.addr_var.get() == "/"
    gui.nav_back()
    assert gui.addr_var.get() == "/docs"
    gui.nav_forward()
    assert gui.addr_var.get() == "/"
    print("navigation (up/back/forward) OK")

    # --- extract all ---
    out1 = os.path.join(base, "out1")
    gui.out_var.set(out1)
    gui.extract_all()
    assert _pump(root, lambda: not gui.busy
                 and "已提取" in gui.status_left.get()), "extract all"
    n_written = sum(len(files) for _, _, files in os.walk(out1))
    assert n_written == 5, "expected 5 extracted files, got %d" % n_written
    print("extract all OK; %d files" % n_written)

    # --- extract single file ---
    gui._navigate(gui.current_dir, push_history=False)
    iid, entry = _find_item(gui, "readme.txt", is_dir=False)
    assert entry, "readme.txt not listed"
    out2 = os.path.join(base, "out2")
    gui.out_var.set(out2)
    gui.tree.selection_set(iid)
    gui.extract_selected()
    assert _pump(root, lambda: not gui.busy
                 and "已提取" in gui.status_left.get()), "extract single"
    assert os.path.exists(os.path.join(out2, "readme.txt"))
    print("extract single OK")

    # --- add files via _add_paths ---
    extra = os.path.join(base, "extra.txt")
    with open(extra, "w", encoding="utf-8") as f:
        f.write("added later\n")
    gui._add_paths([extra])
    assert _pump(root, lambda: not gui.busy
                 and "已添加" in gui.status_left.get()), "add files"
    assert gui.uc.parsed.header.generation == 1
    found = any(e.name == "extra.txt" for e in gui.uc.entries.values())
    assert found, "extra.txt missing after add"
    print("add files OK (generation 1, extra.txt present)")

    # --- package wizard (folder -> .astbox, TOTP-only + QR popup) ---
    pkg = os.path.join(base, "packed.astbox")
    secret = "JBSWY3DPEHPK3PXP"   # RFC 6238 test secret
    dlg = PackageDialog(gui)
    dlg.src_var.set(src_dir)
    dlg.dst_var.set(pkg)
    dlg.b32_var.set(secret)       # deterministic secret -> deterministic code
    dlg._run()
    assert _pump(root, lambda: not gui.busy
                 and gui.status_left.get() == "封装完成"), "package"
    assert os.path.exists(pkg)
    # QR dialog must have popped up
    qr_wins = [w for w in root.winfo_children()
               if isinstance(w, tk.Toplevel) and "二维码" in w.title()]
    assert qr_wins, "QR dialog did not appear"
    for w in qr_wins:
        w.destroy()
    # unlock via TOTP (code may roll over a 30 s boundary; try 3 steps)
    uc = None
    t = int(time.time())
    for tt in (t, t - 30, t + 30):
        code = crypto.totp_at(secret, 6, t=tt)
        try:
            uc = cont.unlock_container(pkg, totp=code)
            break
        except AstboxError:
            continue
    assert uc is not None, "packaged container did not unlock via TOTP"
    hello = [e for p, e in cont.walk_entries(uc) if p == "hello.txt"]
    assert hello and cont.read_file(uc, hello[0]) == b"packaged content\n"
    nested = [e for p, e in cont.walk_entries(uc) if p == "sub/nested.bin"]
    assert nested and cont.read_file(uc, nested[0]) == bytes(range(256)) * 5
    assert all(s.is_totp for s in uc.parsed.slots), \
        "packaged container must be TOTP-only"
    print("package wizard OK (TOTP-only, QR popped, contents verified)")

    # --- lock ---
    gui.do_lock()
    assert gui.uc is None and not gui.tree.get_children()
    print("lock OK")

    root.destroy()
    print("\nGUI SMOKE TEST 2 PASSED")
    shutil.rmtree(base, ignore_errors=True)


if __name__ == "__main__":
    main()
