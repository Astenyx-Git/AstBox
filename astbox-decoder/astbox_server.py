#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Copyright 2026 Astenyx-Git
# SPDX-License-Identifier: Apache-2.0
"""ASTBOX v1.0 容器管理器 - Liquid Glass Web UI 本地服务.

用 Python 标准库 http.server 起一个仅监听 127.0.0.1 的本地服务,
把现有 astbox 包(解析/解锁/浏览/提取/封装/修改/自检)以 JSON API
暴露给 gui/ 目录下的液态玻璃前端。零第三方依赖(qrcode 可选,用于二维码矩阵)。

运行:  python astbox_server.py [--port N] [--no-browser]
       或双击 run_gui.bat
"""
import argparse
import hmac
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

_HERE = os.path.dirname(os.path.abspath(__file__))
_DEPS = os.path.join(_HERE, "deps")
if os.path.isdir(_DEPS):
    sys.path.insert(0, _DEPS)
sys.path.insert(0, _HERE)

from astbox import container as cont          # noqa: E402
from astbox import create                     # noqa: E402
from astbox import crypto                     # noqa: E402
from astbox import extract                    # noqa: E402
from astbox import modify                     # noqa: E402
from astbox import passbox as passbox_mod     # noqa: E402
from astbox import qrutil                     # noqa: E402
from astbox import constants as C             # noqa: E402
from astbox.errors import AstboxError         # noqa: E402

GUI_DIR = os.path.join(_HERE, "gui")
UPLOAD_DIR = os.path.join(_HERE, "tmp", "uploads")
MAX_UPLOAD = 4 * 1024 * 1024 * 1024          # 4 GiB

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}

# API 层面的输入校验错误码
E_NO_CONTAINER = "E_NO_CONTAINER"
E_NOT_UNLOCKED = "E_NOT_UNLOCKED"
E_BAD_DIR = "E_BAD_DIR"
E_BAD_OUT = "E_BAD_OUT"
E_NO_FILES = "E_NO_FILES"
E_BROWSE = "E_BROWSE"


class ApiError(Exception):
    """服务器级用户可见错误(符号码为字符串，区别于核心库的整数码)。"""

    def __init__(self, code, message):
        self.code = code
        self.message = message
        super().__init__("%s: %s" % (code, message))


E_AUTH_CODE = "E_AUTH_CODE"

# --------------------------------------------------------------- 密钥持久化
# 已知 TOTP 密钥注册表以 DPAPI(CurrentUser) 加密落盘，使应用重启后
# 仍可对已创建/已导入容器执行时钟偏移窗口解锁。文件位于
# %LOCALAPPDATA%\ASTBOX\secrets.bin，卸载/换机后自动不可解密。
# 测试可通过环境变量 ASTBOX_SECRETS_PATH 重定向，避免污染真实密钥库。
_SECRETS_DIR = os.path.join(
    os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "ASTBOX")
_SECRETS_PATH = os.environ.get("ASTBOX_SECRETS_PATH") or os.path.join(
    _SECRETS_DIR, "secrets.bin")
_SECRETS_MAGIC = b"ASTBOX1\x00"


def _dpapi_protect(data):
    import ctypes
    from ctypes import wintypes

    class BLOB(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD), ("pb", ctypes.c_void_p)]

    crypt32 = ctypes.WinDLL("crypt32")
    kernel32 = ctypes.WinDLL("kernel32")
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    buf = ctypes.create_string_buffer(data, len(data))
    inp = BLOB(len(data), ctypes.cast(buf, ctypes.c_void_p).value)
    out = BLOB()
    if not crypt32.CryptProtectData(ctypes.byref(inp), "ASTBOX",
                                    None, None, None,
                                    0x1, ctypes.byref(out)):   # UI_FORBIDDEN
        raise OSError("CryptProtectData failed")
    try:
        return ctypes.string_at(out.pb, out.cb)
    finally:
        kernel32.LocalFree(out.pb)


def _dpapi_unprotect(blob):
    import ctypes
    from ctypes import wintypes

    class BLOB(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD), ("pb", ctypes.c_void_p)]

    crypt32 = ctypes.WinDLL("crypt32")
    kernel32 = ctypes.WinDLL("kernel32")
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    buf = ctypes.create_string_buffer(blob, len(blob))
    inp = BLOB(len(blob), ctypes.cast(buf, ctypes.c_void_p).value)
    out = BLOB()
    if not crypt32.CryptUnprotectData(ctypes.byref(inp), None,
                                      None, None, None,
                                      0x1, ctypes.byref(out)):
        raise OSError("CryptUnprotectData failed")
    try:
        return ctypes.string_at(out.pb, out.cb)
    finally:
        kernel32.LocalFree(out.pb)


def load_secrets():
    try:
        with open(_SECRETS_PATH, "rb") as f:
            blob = f.read()
        if not blob.startswith(_SECRETS_MAGIC):
            return {}
        raw = _dpapi_unprotect(blob[len(_SECRETS_MAGIC):])
        obj = json.loads(raw.decode("utf-8"))
        return obj if isinstance(obj, dict) else {}
    except Exception:
        return {}          # 损坏/换机: 静默降级为空注册表


def save_secrets(store):
    try:
        os.makedirs(_SECRETS_DIR, exist_ok=True)
        raw = json.dumps(store, ensure_ascii=False).encode("utf-8")
        blob = _SECRETS_MAGIC + _dpapi_protect(raw)
        tmp = _SECRETS_PATH + ".tmp"
        with open(tmp, "wb") as f:
            f.write(blob)
        os.replace(tmp, _SECRETS_PATH)
    except Exception as exc:
        print("  [warn] 密钥注册表落盘失败: %r" % exc)


_browse_lock = threading.Lock()   # 同一时刻只弹一个系统文件对话框


def _human(n):
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if n < 1024 or unit == "TiB":
            return "%d B" % n if unit == "B" else "%.1f %s" % (n, unit)
        n /= 1024.0


def _fmt_time(t):
    try:
        return time.strftime("%Y-%m-%d %H:%M", time.localtime(t))
    except (OverflowError, OSError, ValueError):
        return str(t)


class Session:
    """单用户本地会话:镜像原 tkinter 版 AstboxGui 的状态字段。"""

    def __init__(self):
        self._mutex = threading.RLock()
        self.pc = None            # ParsedContainer
        self.uc = None            # UnlockedContainer
        self.file_path = None
        self.cred = None          # 最近一次成功解锁的 TOTP
        self.current_dir = C.ROOT_DIRECTORY_ID
        self.history = []
        self.forward = []
        self.out_dir = ""
        # VaultID(hex) -> {"b32","digits","created"} 已知密钥注册表,
        # 供时钟偏移窗口(规范 §10/§67)与创建窗口重试；DPAPI 加密持久化
        self.secrets = load_secrets()

    # ------------------------------------------------------------ helpers
    @staticmethod
    def _vid_key(vault_id):
        """VaultID 统一为 hex 字符串(兼容 bytes / str，JSON 往返安全)。"""
        if isinstance(vault_id, (bytes, bytearray)):
            return bytes(vault_id).hex()
        return str(vault_id)

    def remember_secret(self, b32, digits, created=None):
        """记录当前打开容器的已知密钥(合并保留已有 created 时间戳)。"""
        if not b32 or self.pc is None:
            return
        key = self._vid_key(self.pc.header.vault_id)
        old = self.secrets.get(key)
        self.secrets[key] = {
            "b32": b32,
            "digits": int(digits),
            "created": (old or {}).get("created") or
                       (int(created) if created else None),
        }
        save_secrets(self.secrets)

    def register_secret(self, vault_id, b32, digits, created=None):
        """直接以 VaultID 注册密钥(封装完成后调用)。"""
        if b32:
            key = self._vid_key(vault_id)
            old = self.secrets.get(key)
            self.secrets[key] = {
                "b32": b32,
                "digits": int(digits),
                "created": (old or {}).get("created") or
                           (int(created) if created else None),
            }
            save_secrets(self.secrets)

    def _window_candidates(self, vault_id, digits_hint):
        """规范 §10/§67: 允许相邻时间步补偿时钟偏移。

        已知密钥且位数匹配时, 生成"当前时刻"与"容器创建时刻"
        各 ±5 个时间步(±150 秒)的候选码(去重保序)。
        """
        key = self._vid_key(vault_id)
        entry = self.secrets.get(key)
        if not entry:
            return []
        if digits_hint and entry["digits"] != digits_hint:
            return []
        now = int(time.time())
        bases = [now]
        if entry["created"]:
            bases.append(entry["created"])
        seen = set()
        out = []
        for base in bases:
            for step in range(-5, 6):
                t = base + step * C.TOTP_PERIOD
                try:
                    code = crypto.totp_at(entry["b32"], entry["digits"], t)
                except AstboxError:
                    continue
                if code not in seen:
                    seen.add(code)
                    out.append(code)
        return out

    def phase(self):
        if self.uc is not None:
            return "unlocked"
        if self.pc is not None:
            return "locked"
        return "empty"

    def current_path(self):
        if self.uc is None:
            return "/"
        if self.current_dir == C.ROOT_DIRECTORY_ID:
            return "/"
        parts = []
        cur = self.uc.entries[self.current_dir]
        while cur.parent_id != C.ROOT_DIRECTORY_ID:
            parts.append(cur.name)
            cur = self.uc.entries[cur.parent_id]
        parts.append(cur.name)
        return "/" + "/".join(reversed(parts))

    def listing(self):
        if self.uc is None:
            return []
        children = list(self.uc.children.get(self.current_dir, []))
        children.sort(key=lambda e: (e.is_file, e.name.lower()))
        return [{
            "id": e.file_id.hex(),
            "name": e.name,
            "is_dir": e.is_dir,
            "size": 0 if e.is_dir else e.size,
            "size_h": "" if e.is_dir else _human(e.size),
            "modified": e.modified,
            "modified_h": _fmt_time(e.modified),
        } for e in children]

    def info(self):
        if self.uc is not None:
            h = self.uc.parsed.header
            n = sum(1 for e in self.uc.entries.values() if e.is_file)
            return {
                "name": os.path.basename(self.uc.parsed.path),
                "path": self.uc.parsed.path,
                "vault_id": h.vault_id.hex(),
                "generation": h.generation,
                "files": n,
                "slots_digits": [s.totp_digits for s in self.uc.parsed.slots
                                 if s.is_totp],
                "status": "已解锁",
            }
        if self.pc is not None:
            h = self.pc.header
            return {
                "name": os.path.basename(self.pc.path),
                "path": self.pc.path,
                "vault_id": h.vault_id.hex(),
                "generation": h.generation,
                "files": None,
                "slots_digits": [s.totp_digits for s in self.pc.slots
                                 if s.is_totp],
                "status": "未解锁",
            }
        return None

    def snapshot(self):
        return {
            "phase": self.phase(),
            "info": self.info(),
            "path": self.current_path() if self.uc else "/",
            "can_back": bool(self.history),
            "can_forward": bool(self.forward),
            "can_up": bool(self.uc) and
                      self.current_dir != C.ROOT_DIRECTORY_ID,
            "items": self.listing(),
            "out_dir": self.out_dir,
            "home": os.path.expanduser("~"),
            "qr_ok": qrutil.available(),
        }

    # ------------------------------------------------------------ actions
    def open_path(self, path):
        self.pc = cont.parse_container(path)
        self.uc = None
        self.cred = None
        self.file_path = path
        self.current_dir = C.ROOT_DIRECTORY_ID
        self.history.clear()
        self.forward.clear()

    def unlock(self, totp):
        """解锁当前容器(仅验证码路径)。

        安全模型: 验证码先在 now±5 / created±5 窗口内常量时间校验,
        通过后用注册表中的 Base32 密钥解码字节完成 KDF 解锁。
        不提供"粘贴密钥直接解锁"入口, 密钥不经过前端。
        """
        if self.pc is None:
            raise ApiError(E_NO_CONTAINER, "尚未打开容器")
        parsed = self.pc
        vid = parsed.header.vault_id

        entry = self.secrets.get(self._vid_key(vid))
        if not entry or not (totp or "").strip():
            raise ApiError(
                E_AUTH_CODE,
                "本机没有该容器的密钥记录，无法校验验证码。"
                "请在封装该容器的设备上解锁，或重新封装。")

        slots_digits = [s.totp_digits for s in parsed.slots if s.is_totp]
        digits_hint = slots_digits[0] if slots_digits else None
        expected = self._window_candidates(vid, digits_hint)
        typed = (totp or "").strip().encode("ascii", "ignore")
        verified = any(hmac.compare_digest(typed, c.encode("ascii"))
                       for c in expected)
        if not verified:
            hint = ("容器为 %d 位验证码" % digits_hint
                    if digits_hint else "位数未知")
            raise ApiError(
                E_AUTH_CODE,
                "验证码不匹配（%s）。请核对：① 验证器时间已与本机同步"
                "(±150 秒内可自动补偿) ② 使用的是该容器对应的密钥"
                % hint)
        try:
            uc = cont.unlock_parsed(parsed,
                                    secret_b32=entry["b32"])
        except AstboxError as exc:
            raise ApiError(E_AUTH_CODE,
                           "验证码正确但容器解锁失败: %s" % exc)
        self._finish_unlock(uc, cred=totp)

    def _finish_unlock(self, uc, cred):
        self.uc = uc
        self.cred = cred
        self.pc = uc.parsed
        self.file_path = uc.parsed.path
        self.current_dir = C.ROOT_DIRECTORY_ID
        self.history.clear()
        self.forward.clear()

    def lock(self):
        self.uc = None
        self.cred = None
        self.current_dir = C.ROOT_DIRECTORY_ID
        self.history.clear()
        self.forward.clear()

    def nav_to(self, target):
        """target: {'dir': hex-or-'root'} 或 {'path': '/a/b'}"""
        if self.uc is None:
            return
        if "dir" in target and target["dir"] is not None:
            raw = target["dir"]
            if raw in ("root", "/", ""):
                new_dir = C.ROOT_DIRECTORY_ID
            else:
                new_dir = bytes.fromhex(raw)
                ent = self.uc.entries.get(new_dir)
                if ent is None or not ent.is_dir:
                    raise ApiError(E_BAD_DIR, "目录不存在")
        else:
            path = (target.get("path") or "/").strip()
            if path in ("", "/", "\\"):
                new_dir = C.ROOT_DIRECTORY_ID
            else:
                parts = [p for p in path.strip("/\\").split("/") if p]
                cur = C.ROOT_DIRECTORY_ID
                for p in parts:
                    found = None
                    for e in self.uc.children.get(cur, []):
                        if e.is_dir and e.name == p:
                            found = e
                            break
                    if found is None:
                        raise ApiError(E_BAD_DIR, "未找到目录: %s" % path)
                    cur = found.file_id
                new_dir = cur
        if new_dir != self.current_dir:
            self.history.append(self.current_dir)
            self.forward.clear()
        self.current_dir = new_dir

    def nav_back(self):
        if self.history and self.uc is not None:
            self.forward.append(self.current_dir)
            self.current_dir = self.history.pop()

    def nav_forward(self):
        if self.forward and self.uc is not None:
            self.history.append(self.current_dir)
            self.current_dir = self.forward.pop()

    def nav_up(self):
        if self.uc is not None and \
                self.current_dir != C.ROOT_DIRECTORY_ID:
            parent = self.uc.entries[self.current_dir].parent_id
            self.nav_to({"dir": parent.hex()})

    def extract(self, ids, out):
        if self.uc is None:
            raise ApiError(E_NOT_UNLOCKED, "请先解锁容器")
        if not out:
            raise ApiError(E_BAD_OUT, "请指定输出目录")
        os.makedirs(out, exist_ok=True)
        if ids is None:
            results = extract.extract_all(self.uc, out)
            return len(results)
        targets = []
        for hx in ids:
            ent = self.uc.entries.get(bytes.fromhex(hx))
            if ent is not None and ent.is_file:
                targets.append(ent)
        if not targets:
            raise ApiError(E_NO_FILES, "所选项目中没有文件")
        for ent in targets:
            extract.extract_entry(self.uc, ent, out)
        return len(targets)

    def add_paths(self, paths):
        if self.uc is None:
            raise ApiError(E_NOT_UNLOCKED, "请先解锁容器")
        prefix = "" if self.current_dir == C.ROOT_DIRECTORY_ID \
            else self.current_path().lstrip("/")
        files = {}
        for p in paths:
            p = p.strip().strip('"')
            if not p:
                continue
            if os.path.isdir(p):
                base = p
                for root, _dirs, fnames in os.walk(p):
                    for fn in fnames:
                        full = os.path.join(root, fn)
                        rel = os.path.relpath(full, base).replace("\\", "/")
                        logical = rel if not prefix else prefix + "/" + rel
                        with open(full, "rb") as f:
                            files[logical] = f.read()
            elif os.path.isfile(p):
                rel = os.path.basename(p)
                logical = rel if not prefix else prefix + "/" + rel
                with open(p, "rb") as f:
                    files[logical] = f.read()
        if not files:
            raise ApiError(E_NO_FILES, "没有可添加的文件")
        uc2 = modify.add_files(self.uc, files, self.file_path,
                               totp=self.cred)
        self.uc = uc2
        self.pc = uc2.parsed
        # 新一代容器中条目 ID 可能变化:若当前目录失效则回到根目录
        if self.current_dir != C.ROOT_DIRECTORY_ID and \
                self.current_dir not in self.uc.entries:
            self.current_dir = C.ROOT_DIRECTORY_ID
            self.history.clear()
            self.forward.clear()
        return len(files)


SESSION = Session()


# ---------------------------------------------------------------------------
# demo / pack helpers
# ---------------------------------------------------------------------------

def _demo_files():
    text = (b"ASTBOX v1.0 demo file.\n\n"
            b"This container was created by the demo button.\n")
    big = bytes((i * 131 + 7) % 256 for i in range(2 * 1048576 + 12345))
    return {
        "readme.txt": text * 20,
        "docs/guide.md": b"# ASTBOX decoder guide\n\n"
                         b"Unlock -> browse -> extract.\n" * 40,
        "assets/random.bin": big,
        "empty.txt": b"",
        "docs/notes/测试.txt": "unicode file name test\n".encode("utf-8"),
    }


def _qr_payload(secret, digits, label):
    uri = qrutil.build_otpauth_uri(secret, digits, label)
    matrix = [[1 if cell else 0 for cell in row]
              for row in qrutil.qr_matrix(uri)] if qrutil.available() else None
    return {"b32": secret, "digits": digits, "uri": uri, "matrix": matrix}


def make_demo(dst, digits=6, profile=C.KDF_PROFILE_HIGH):
    """在用户指定位置生成内置示例内容的 .astbox 容器并打开(锁定态)。"""
    dst = (dst or "").strip().strip('"')
    if not dst:
        raise ApiError(E_BAD_OUT, "请指定保存位置")
    parent = os.path.dirname(os.path.abspath(dst))
    if parent:
        os.makedirs(parent, exist_ok=True)
    digits = 6 if int(digits) == 6 else 8
    if profile != C.KDF_PROFILE_MEMORY_CONSTRAINED:
        profile = C.KDF_PROFILE_HIGH
    secret = qrutil.generate_secret()
    uc = create.create_container(dst, totp_secret=secret,
                                 totp_digits=digits, files=_demo_files(),
                                 kdf_profile=profile)
    SESSION.register_secret(uc.parsed.header.vault_id, secret, digits,
                            uc.created)
    SESSION.open_path(dst)
    SESSION.remember_secret(secret, digits, uc.created)
    payload = _qr_payload(secret, digits,
                          "ASTBOX:%s" % os.path.basename(dst))
    payload["dst"] = dst
    return payload


def _native_browse(args):
    """弹出 Windows 原生文件/文件夹对话框(Win32 comdlg32/shell32)。

    args.mode: 'file' | 'files' | 'dir' | 'save'
    返回选中路径列表(可能为空)。对话框失败时抛 E_BROWSE。
    不依赖 tkinter —— 嵌入式 Python 运行时同样可用。
    """
    mode = args.get("mode") or "file"
    title = str(args.get("title") or "")
    initial = (args.get("initial") or "").strip().strip('"')
    initial_dir = os.path.dirname(initial) \
        if os.path.isdir(os.path.dirname(initial)) else None
    ft = [(str(a), str(b)) for a, b in (args.get("filetypes") or [])]
    with _browse_lock:
        try:
            return _win_dialog(mode, title, initial_dir, ft,
                               str(args.get("defaultext") or ""), initial)
        except ApiError:
            raise
        except Exception as exc:
            raise ApiError(E_BROWSE,
                              "无法打开系统对话框(%r)，请手动输入路径" % exc)


_OFN_READONLY = 0x1
_OFN_OVERWRITEPROMPT = 0x2
_OFN_HIDEREADONLY = 0x4
_OFN_NOCHANGEDIR = 0x8
_OFN_PATHMUSTEXIST = 0x800
_OFN_FILEMUSTEXIST = 0x1000
_OFN_ALLOWMULTISELECT = 0x200
_OFN_EXPLORER = 0x80000

_BUF_CHARS = 65536


def _win_dialog(mode, title, initial_dir, filetypes, defaultext,
                initial=""):
    import ctypes
    from ctypes import wintypes

    ole32 = ctypes.WinDLL("ole32")
    comdlg = ctypes.WinDLL("comdlg32")
    shell32 = ctypes.WinDLL("shell32")

    # 显式原型：x64 下缺省 restype=int 会截断 64 位指针(如 PIDL)
    comdlg.GetOpenFileNameW.argtypes = [ctypes.c_void_p]
    comdlg.GetOpenFileNameW.restype = ctypes.c_int
    comdlg.GetSaveFileNameW.argtypes = [ctypes.c_void_p]
    comdlg.GetSaveFileNameW.restype = ctypes.c_int
    shell32.SHBrowseForFolderW.argtypes = [ctypes.c_void_p]
    shell32.SHBrowseForFolderW.restype = ctypes.c_void_p
    shell32.SHGetPathFromIDListW.argtypes = [ctypes.c_void_p,
                                             ctypes.c_wchar_p]
    shell32.SHGetPathFromIDListW.restype = ctypes.c_int
    ole32.CoTaskMemFree.argtypes = [ctypes.c_void_p]
    ole32.CoTaskMemFree.restype = None
    ole32.CoInitializeEx.argtypes = [ctypes.c_void_p, wintypes.DWORD]
    ole32.CoInitializeEx.restype = ctypes.c_long
    user32 = ctypes.WinDLL("user32")
    user32.GetForegroundWindow.restype = ctypes.c_void_p
    # 对话框挂到当前前台窗口(即应用窗口)名下：始终显示在其上层
    owner_hwnd = user32.GetForegroundWindow()

    class OPENFILENAMEW(ctypes.Structure):
        _fields_ = [
            ("lStructSize", wintypes.DWORD),
            ("hwndOwner", wintypes.HWND),
            ("hInstance", wintypes.HINSTANCE),
            ("lpstrFilter", ctypes.c_void_p),
            ("lpstrCustomFilter", ctypes.c_void_p),
            ("nMaxCustFilter", wintypes.DWORD),
            ("nFilterIndex", wintypes.DWORD),
            ("lpstrFile", ctypes.c_void_p),
            ("nMaxFile", wintypes.DWORD),
            ("lpstrFileTitle", ctypes.c_void_p),
            ("nMaxFileTitle", wintypes.DWORD),
            ("lpstrInitialDir", ctypes.c_void_p),
            ("lpstrTitle", ctypes.c_void_p),
            ("Flags", wintypes.DWORD),
            ("nFileOffset", wintypes.WORD),
            ("nFileExtension", wintypes.WORD),
            ("lpstrDefExt", ctypes.c_void_p),
            ("lCustData", wintypes.LPARAM),
            ("lpfnHook", ctypes.c_void_p),
            ("lpTemplateName", ctypes.c_void_p),
        ]

    # COM STA：文件夹选择器(IFileDialog 样式)需要；对 comdlg 无副作用
    hr = ole32.CoInitializeEx(None, 2)          # COINIT_APARTMENTTHREADED
    com_inited = hr in (0, 0x80010106)           # S_OK / RPC_E_CHANGED_MODE
    try:
        cast = ctypes.cast
        buf_w = lambda n: ctypes.create_unicode_buffer(n)
        ft_str = "".join("%s\0%s\0" % (a, b) for a, b in filetypes) + "\0"
        ft_buf = buf_w(ft_str + "\0") if ft_str.strip("\0") else None
        init_buf = buf_w(initial_dir) if initial_dir else None
        title_buf = buf_w(title) if title else None

        if mode == "dir":
            class BROWSEINFOW(ctypes.Structure):
                _fields_ = [
                    ("hwndOwner", wintypes.HWND),
                    ("pidlRoot", ctypes.c_void_p),
                    ("pszDisplayName", ctypes.c_void_p),
                    ("lpszTitle", ctypes.c_void_p),
                    ("ulFlags", wintypes.UINT),
                    ("lpfn", ctypes.c_void_p),
                    ("lParam", wintypes.LPARAM),
                    ("iImage", wintypes.INT),
                ]
            disp = buf_w(260)
            bi = BROWSEINFOW()
            bi.hwndOwner = owner_hwnd
            bi.lpszTitle = cast(title_buf, ctypes.c_void_p).value \
                if title_buf else None
            bi.pszDisplayName = cast(disp, ctypes.c_void_p).value
            bi.ulFlags = 0x1 | 0x40      # BIF_RETURNONLYFSDIRS|NEWDIALOGSTYLE
            pidl = shell32.SHBrowseForFolderW(ctypes.byref(bi))
            if not pidl:
                return []
            out = buf_w(260)
            ok = shell32.SHGetPathFromIDListW(pidl, out)
            ole32.CoTaskMemFree(pidl)
            return [out.value] if ok and out.value else []

        ofn = OPENFILENAMEW()
        ofn.hwndOwner = owner_hwnd
        ofn.lStructSize = ctypes.sizeof(OPENFILENAMEW)
        ofn.lpstrFilter = cast(ft_buf, ctypes.c_void_p).value if ft_buf else None
        ofn.lpstrInitialDir = cast(init_buf, ctypes.c_void_p).value \
            if init_buf else None
        ofn.lpstrTitle = cast(title_buf, ctypes.c_void_p).value if title_buf else None
        file_buf = buf_w(_BUF_CHARS)
        ofn.lpstrFile = cast(file_buf, ctypes.c_void_p).value
        ofn.nMaxFile = _BUF_CHARS
        base_flags = (_OFN_HIDEREADONLY | _OFN_NOCHANGEDIR)
        if mode == "save":
            de = (defaultext or "").lstrip(".")
            defext_buf = buf_w(de) if de else None
            ofn.lpstrDefExt = cast(defext_buf, ctypes.c_void_p).value \
                if defext_buf else None
            if initial and os.path.basename(initial):
                file_buf.value = os.path.basename(initial)  # 预填文件名
            ofn.Flags = base_flags | _OFN_OVERWRITEPROMPT \
                | _OFN_PATHMUSTEXIST
            ok = comdlg.GetSaveFileNameW(ctypes.byref(ofn))
        elif mode == "files":
            ofn.Flags = base_flags | _OFN_ALLOWMULTISELECT \
                | _OFN_EXPLORER | _OFN_FILEMUSTEXIST | _OFN_PATHMUSTEXIST
            ok = comdlg.GetOpenFileNameW(ctypes.byref(ofn))
        else:
            ofn.Flags = base_flags | _OFN_FILEMUSTEXIST \
                | _OFN_PATHMUSTEXIST
            ok = comdlg.GetOpenFileNameW(ctypes.byref(ofn))
        if not ok:
            return []
        raw = ctypes.wstring_at(file_buf, _BUF_CHARS)
        parts = [p for p in raw.split("\x00") if p]
        if len(parts) > 1:                      # 多选: 首项为目录前缀
            folder = parts[0].rstrip("\\")
            return ["%s\\%s" % (folder, p) for p in parts[1:]]
        return parts
    finally:
        if com_inited:
            try:
                ole32.CoUninitialize()
            except Exception:
                pass


def do_pack(args):
    src = (args.get("src") or "").strip().strip('"')
    dst = (args.get("dst") or "").strip().strip('"')
    digits = int(args.get("digits") or 6)
    b32 = (args.get("b32") or "").strip() or None
    profile = C.KDF_PROFILE_HIGH if args.get("profile", "high") == "high" \
        else C.KDF_PROFILE_MEMORY_CONSTRAINED
    if not dst:
        raise ApiError(E_BAD_OUT, "请指定目标文件")
    if src and not os.path.isdir(src):
        raise ApiError(E_BAD_DIR, "源文件夹不存在: %s" % src)
    parent = os.path.dirname(os.path.abspath(dst))
    if parent:
        os.makedirs(parent, exist_ok=True)
    files = {}
    if src:
        for root, _dirs, fnames in os.walk(src):
            for fn in fnames:
                full = os.path.join(root, fn)
                rel = os.path.relpath(full, src).replace("\\", "/")
                with open(full, "rb") as f:
                    files[rel] = f.read()
    elif SESSION.uc is not None:
        # 留空且当前已解锁容器：封装容器内全部内容
        for path, ent in cont.walk_entries(SESSION.uc):
            if ent.is_file:
                files[path] = cont.read_file(SESSION.uc, ent)
    else:
        raise ApiError(E_BAD_DIR,
                          "请先打开并解锁要封装的容器，或指定源文件夹")
    b32_used = b32 or qrutil.generate_secret()
    uc = create.create_container(dst, totp_secret=b32_used,
                                 totp_digits=digits, files=files,
                                 kdf_profile=profile)
    # 注册密钥(含创建时刻), 使本会话内的"打开->解锁"可靠可用
    SESSION.register_secret(uc.parsed.header.vault_id, b32_used, digits,
                            uc.created)
    payload = _qr_payload(b32_used, digits,
                          "ASTBOX:%s" % os.path.basename(dst))
    payload.update({
        "dst": dst,
        "vault_id": uc.parsed.header.vault_id.hex(),
        "generation": uc.parsed.header.generation,
        "entries": len(uc.entries),
    })
    return payload


# ---------------------------------------------------------------------------
# HTTP layer
# ---------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "AstboxLocal/1.0"

    def _export_passbox(self, args):
        """从已解锁容器生成 .passbox 传播包(工具菜单入口)。

        需要本机注册表持有该容器密钥; 口令留空生成免口令快速包。
        """
        if SESSION.uc is None:
            self._fail("请先解锁容器")
            return
        out = (args.get("out") or "").strip().strip('"')
        passphrase = args.get("passphrase")
        passphrase = None if not passphrase else str(passphrase)
        if not out:
            self._fail("请指定输出路径")
            return
        vid = SESSION.uc.parsed.header.vault_id
        entry = SESSION.secrets.get(SESSION._vid_key(vid))
        if not entry:
            self._fail(
                "本机没有该容器的密钥记录，无法生成传播包")
            return
        try:
            passbox_mod.pack_passbox(
                SESSION.uc.parsed.path, entry["b32"],
                entry.get("digits") or 6, SESSION.uc.created,
                out, passphrase=passphrase)
        except AstboxError as exc:
            self._fail("生成失败: %s" % exc)
            return
        except OSError as exc:
            self._fail("写入失败: %s" % exc)
            return
        self._ok(out=out)

    # -------------------------------------------------------------- output
    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type",
                         "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _ok(self, **kw):
        kw["ok"] = True
        with SESSION._mutex:
            kw.setdefault("state", SESSION.snapshot())
        self._send_json(kw)

    def _fail(self, msg, status=400):
        self._send_json({"ok": False, "error": str(msg)}, status=status)

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > 4 * 1048576:
            raise ValueError("请求体过大")
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8")) if raw.strip() else {}

    def _drain_body(self, length):
        """读掉并丢弃请求体，避免未读数据触发 RST 使浏览器只看到
        'Failed to fetch' 而拿不到真正的错误 JSON。"""
        try:
            remain = length
            while remain > 0:
                chunk = self.rfile.read(min(remain, 1048576))
                if not chunk:
                    break
                remain -= len(chunk)
        except Exception:
            pass

    def _handle_upload(self):
        """接收浏览器上传的 .astbox 字节流并存为服务器本地副本后解析。

        契约: 无论成功失败，都必须消费完请求体后再应答——否则未读
        数据触发 TCP RST, 浏览器只能显示 'Failed to fetch'。
        """
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self._drain_body(0)      # 无法确定长度: 尽力读到连接结束
            self._drain_to_end()
            self._fail("Content-Length 无效")
            return
        if length <= 0 or length > MAX_UPLOAD:
            self._drain_body(length)
            self._fail("文件为空或过大(上限 4 GiB)")
            return
        try:
            du = shutil.disk_usage(os.path.dirname(UPLOAD_DIR)
                                   or os.sep)
            if du.free < length + 256 * 1048576:
                self._drain_body(length)
                self._fail("磁盘空间不足：需要约 %.1f GiB，剩余 %.1f GiB"
                           % ((length + 268435456) / 1073741824.0,
                              du.free / 1073741824.0))
                return
        except Exception:
            pass                      # 空间探测失败不阻塞上传
        name = self.headers.get("X-Filename") or "upload.astbox"
        try:
            name = os.path.basename(
                urllib.parse.unquote(name)).replace("\\", "_") \
                .replace("/", "_") or "upload.astbox"
            if not name.lower().endswith(".astbox"):
                name += ".astbox"
        except Exception:
            name = "upload.astbox"
        stamp = time.strftime("%Y%m%d-%H%M%S")
        dest = os.path.join(UPLOAD_DIR, "%s_%s" % (stamp, name))
        tmpf = dest + ".part"
        # ---- 阶段一: 不持锁接收字节流(临时名), 失败则排空+可读报错
        remain = length
        try:
            os.makedirs(UPLOAD_DIR, exist_ok=True)
            with open(tmpf, "wb") as f:
                while remain > 0:
                    chunk = self.rfile.read(min(remain, 1048576))
                    if not chunk:
                        break
                    f.write(chunk)
                    remain -= len(chunk)
            if remain:
                raise IOError("客户端提前断开(缺 %d 字节)" % remain)
            os.replace(tmpf, dest)    # 原子落位, 杀软半锁也不影响后续
        except Exception as exc:
            try:
                if os.path.exists(tmpf):
                    os.remove(tmpf)
            except Exception:
                pass
            self._drain_body(remain)
            self._fail("保存上传副本失败: %s" % exc)
            return
        # ---- 阶段二: 持会话锁解析
        try:
            with SESSION._mutex:
                SESSION.open_path(dest)
        except ApiError as exc:
            self._fail("%s: %s" % (exc.code, exc.message))
            return
        except AstboxError as exc:
            self._fail("%s: %s" % (exc.code_name, exc.message))
            return
        self._ok(saved_to=dest)

    def _drain_to_end(self):
        """Content-Length 不可信时读到对端关闭为止。"""
        try:
            while True:
                if not self.rfile.read(1048576):
                    break
        except Exception:
            pass

    def log_message(self, fmt, *args):  # 安静模式
        pass

    # -------------------------------------------------------------- static
    def _serve_static(self, rel):
        path = os.path.normpath(os.path.join(GUI_DIR, rel))
        if not path.startswith(GUI_DIR) or not os.path.isfile(path):
            self._fail("not found", 404)
            return
        ext = os.path.splitext(path)[1].lower()
        with open(path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(ext,
                         "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    # -------------------------------------------------------------- GET
    def do_GET(self):
        route = self.path.split("?", 1)[0]
        try:
            if route in ("/", "/index.html"):
                self._serve_static("index.html")
            elif route in ("/app.css", "/app.js"):
                self._serve_static(route.lstrip("/"))
            elif route == "/icon.png":
                self._serve_static("icon.png")
            elif route == "/api/state":
                with SESSION._mutex:
                    self._ok(state=SESSION.snapshot())
            elif route == "/api/selftest":
                lines = crypto.selftest()
                self._ok(lines=list(lines))
            else:
                self._fail("not found", 404)
        except ApiError as exc:
            self._fail("%s: %s" % (exc.code, exc.message))
        except AstboxError as exc:
            self._fail("%s: %s" % (exc.code_name, exc.message))
        except Exception as exc:  # pragma: no cover
            traceback.print_exc()
            self._fail("服务器内部错误: %r" % exc, 500)

    # -------------------------------------------------------------- POST
    def do_POST(self):
        route = self.path.split("?", 1)[0]
        try:
            if route == "/api/open_upload":
                self._handle_upload()
                return
            if route == "/api/browse":
                # 原生对话框期间不持有会话锁，避免阻塞其他请求
                self._ok(paths=_native_browse(self._read_json()))
                return
            if route == "/api/shutdown":
                # 红点退出：先应答前端，再优雅关闭服务进程
                self._ok(message="ASTBOX 服务即将退出")
                threading.Timer(0.3, _graceful_exit).start()
                return
            args = self._read_json()
            with SESSION._mutex:
                if route == "/api/open":
                    path = (args.get("path") or "").strip().strip('"')
                    if not path or not os.path.isfile(path):
                        self._fail("文件不存在: %s" % path)
                        return
                    SESSION.open_path(path)
                    self._ok()
                elif route == "/api/unlock":
                    SESSION.unlock(totp=(args.get("totp") or "").strip())
                    self._ok()
                elif route == "/api/export_passbox":
                    self._export_passbox(args)
                elif route == "/api/lock":
                    SESSION.lock()
                    self._ok()
                elif route == "/api/nav":
                    SESSION.nav_to(args)
                    self._ok()
                elif route == "/api/back":
                    SESSION.nav_back()
                    self._ok()
                elif route == "/api/forward":
                    SESSION.nav_forward()
                    self._ok()
                elif route == "/api/up":
                    SESSION.nav_up()
                    self._ok()
                elif route == "/api/outdir":
                    SESSION.out_dir = (args.get("path") or "").strip()
                    self._ok()
                elif route == "/api/extract":
                    ids = args.get("ids")
                    out = (args.get("out") or SESSION.out_dir or "").strip()
                    n = SESSION.extract(ids, out)
                    SESSION.out_dir = out
                    self._ok(count=n, out=out)
                elif route == "/api/verify":
                    if SESSION.uc is None:
                        raise ApiError(E_NOT_UNLOCKED, "请先解锁容器")
                    cont.verify_full(SESSION.uc)
                    self._ok(message="完整性验证通过：全部数据记录认证成功")
                elif route == "/api/totp":
                    b32 = (args.get("b32") or "").strip()
                    digits = int(args.get("digits") or 6)
                    code = crypto.totp_at(b32, digits)
                    SESSION.remember_secret(b32, digits)
                    self._ok(code=code)
                elif route == "/api/pack":
                    self._ok(pack=do_pack(args))
                elif route == "/api/demo":
                    self._ok(demo=make_demo(
                        args.get("dst"),
                        digits=args.get("digits") or 6,
                        profile=C.KDF_PROFILE_MEMORY_CONSTRAINED
                        if args.get("profile") == "constrained"
                        else C.KDF_PROFILE_HIGH))
                elif route == "/api/add":
                    paths = args.get("paths") or []
                    n = SESSION.add_paths(paths)
                    self._ok(count=n)
                else:
                    self._fail("not found", 404)
        except ApiError as exc:
            self._fail("%s: %s" % (exc.code, exc.message))
        except AstboxError as exc:
            self._fail("%s: %s" % (exc.code_name, exc.message))
        except ValueError as exc:
            self._fail(str(exc))
        except Exception as exc:  # pragma: no cover
            traceback.print_exc()
            self._fail("服务器内部错误: %r" % exc, 500)


# ---------------------------------------------------------------------------

class _NullIO:
    """pythonw(无控制台)启动时 sys.stdout/stderr 为 None 的兜底。"""

    def write(self, *_args):
        return 0

    def flush(self):
        pass


def _crash_log(exc):
    """把致命错误写入脚本旁的日志文件(pythonw 下用户看不到控制台)。"""
    try:
        with open(os.path.join(_HERE, "server_error.log"), "a",
                  encoding="utf-8") as f:
            f.write("[%s] ASTBOX server crash:\n" % time.strftime(
                "%Y-%m-%d %H:%M:%S"))
            traceback.print_exc(file=f)
            f.write("\n")
    except Exception:
        pass


def main():
    # pythonw 下 stdout/stderr 为 None: print 会直接抛 AttributeError
    if sys.stdout is None:
        sys.stdout = _NullIO()
    if sys.stderr is None:
        sys.stderr = _NullIO()
    try:
        for stream in (sys.stdout, sys.stderr):
            if hasattr(stream, "reconfigure"):
                try:
                    stream.reconfigure(encoding="utf-8", errors="replace")
                except Exception:
                    pass
    except Exception:
        pass
    try:
        _run_server()
    except SystemExit:
        raise
    except Exception:
        _crash_log(None)
        raise


def _find_app_host():
    """寻找支持 --app 独立窗口模式的浏览器(优先 Edge，其次 Chrome)。"""
    cands = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        os.path.join(os.environ.get("LOCALAPPDATA", ""),
                     r"Google\Chrome\Application\chrome.exe"),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ]
    for p in cands:
        if p and os.path.isfile(p):
            return p
    return None


_APP_TITLE = "ASTBOX"


def _kiosk_url(url):
    """应用窗口通道的 URL：携带 ui=app，前端据此禁用 F12/右键。"""
    return url + ("&" if "?" in url else "?") + "ui=app"


def _app_window_visible(title_substr):
    """枚举顶层可见窗口，判断应用窗口是否已经出现(健康检查用)。"""
    if os.name != "nt":
        return False
    try:
        import ctypes
        from ctypes import wintypes
        user32 = ctypes.windll.user32
        hits = []

        def _cb(hwnd, _lparam):
            n = user32.GetWindowTextLengthW(hwnd)
            if n:
                buf = ctypes.create_unicode_buffer(n + 1)
                user32.GetWindowTextW(hwnd, buf, n + 1)
                if title_substr in buf.value \
                        and user32.IsWindowVisible(hwnd):
                    hits.append(buf.value)
            return True

        CB = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND,
                                wintypes.LPARAM)
        user32.EnumWindows(CB(_cb), 0)
        return bool(hits)
    except Exception:
        return False


def _wait_app_window(proc, timeout=8.0):
    """等待应用窗口出现；内核立即崩溃且无窗口视为故障。"""
    end = time.time() + timeout
    exit_at = None
    while time.time() < end:
        if _app_window_visible(_APP_TITLE):
            return True
        if proc.poll() is not None:
            if exit_at is None:
                exit_at = time.time()
            elif time.time() - exit_at > 1.5:
                return False   # 进程已退出且再无窗口出现
        time.sleep(0.25)
    return False


def _find_portable_chromium():
    """定位便携 Chromium: <app>/chromium/ 下常见布局的有界搜索。"""
    root = os.path.join(_HERE, "chromium")
    if not os.path.isdir(root):
        return None
    rel_cands = [
        "chrome.exe", r"Chrome-bin\chrome.exe", r"App\chrome.exe",
        r"App\Chrome-bin\chrome.exe", r"bin\chrome.exe",
    ]
    for rel in rel_cands:
        p = os.path.join(root, rel)
        if os.path.isfile(p):
            return p
    count = 0
    for dirpath, dirs, files in os.walk(root):
        if os.path.relpath(dirpath, root).count(os.sep) >= 3:
            dirs[:] = []
            continue
        if "chrome.exe" in files:
            return os.path.join(dirpath, "chrome.exe")
        count += len(files)
        if count > 2000:
            break
    return None


def _open_portable_window(url):
    """最高优先级通道：便携 Chromium --app 窗口 + 健康检查。"""
    exe = _find_portable_chromium()
    if not exe:
        return False
    profile = os.path.join(_HERE, "chromium-profile")
    try:
        proc = subprocess.Popen(
            [exe, "--app=" + _kiosk_url(url), "--user-data-dir=" + profile,
             "--no-first-run", "--no-default-browser-check",
             "--window-size=1280,880"],
            close_fds=True, cwd=os.path.dirname(exe))
    except Exception:
        print("  便携 Chromium 启动失败，回退系统浏览器窗口")
        return False
    if _wait_app_window(proc):
        print("  UI: 便携 Chromium 应用窗口（已启用应用锁定）")
        return True
    print("  便携 Chromium 内核故障（无窗口），回退 Edge/系统浏览器")
    return False


def _open_app_window(url):
    """以独立应用窗口(--app 模式)打开界面；无标签页/地址栏。"""
    exe = _find_app_host()
    if not exe:
        return False
    try:
        subprocess.Popen([exe, "--app=" + _kiosk_url(url),
                          "--window-size=1280,880"],
                         close_fds=True)
        print("  UI: 应用窗口 (%s)" % os.path.basename(exe))
        return True
    except Exception:
        return False


def _open_ui(url, mode):
    """降级阶梯: 便携Chromium -> Edge/Chrome 应用窗口。"""
    opened = False
    if mode in ("auto", "window"):
        opened = _open_portable_window(url)   # 最高优先级，故障自动回退
    if not opened and mode in ("auto", "window"):
        opened = _open_app_window(url)
    if not opened:
        msg = "未找到可用界面通道：请将便携 Chromium 放入 chromium\\ 目录，" \
              "或安装 Microsoft Edge / Google Chrome。"
        print("  " + msg)
        try:
            with open(os.path.join(_HERE, "server_error.log"), "a",
                      encoding="utf-8") as f:
                f.write("[%s] %s\n" % (time.strftime(
                    "%Y-%m-%d %H:%M:%S"), msg))
        except Exception:
            pass


_SERVER = None   # 运行中的 HTTPServer 引用(供 /api/shutdown 优雅退出)


def _graceful_exit():
    try:
        if _SERVER is not None:
            _SERVER.shutdown()
            _SERVER.server_close()
    finally:
        os._exit(0)   # 兜底：确保浏览对话框线程等不阻塞退出


def _tk_error(msg):
    """无头环境下的错误弹窗(导入失败等)。"""
    try:
        import tkinter as tk
        from tkinter import messagebox
        root = tk.Tk()
        root.withdraw()
        messagebox.showerror("ASTBOX 传播包", str(msg), parent=root)
        root.destroy()
    except Exception:
        print("  [passbox] 错误: %s" % msg)


def _import_passbox_boot(pb_path):
    """双击 .passbox 的导入流程: 校验→试锁→注册→返回容器路径。

    需要口令时用 tk 对话框收集(最多 3 次); 成败均不抛出,
    返回 (container_path or None, err_msg or None)。
    """
    try:
        header, needs_pass = passbox_mod.read_info(pb_path)
        passphrase = None
        if needs_pass:
            import tkinter as tk
            from tkinter import simpledialog
            root = tk.Tk()
            root.withdraw()
            try:
                for _ in range(3):
                    passphrase = simpledialog.askstring(
                        "ASTBOX 传播包",
                        "该传播包受口令保护，请输入口令：",
                        parent=root, show="*")
                    if passphrase is None:
                        return None, "已取消导入"
                    try:
                        b32, _hdr, cpath = passbox_mod.unwrap_secret(
                            pb_path, passphrase)
                        break
                    except AstboxError:
                        continue
                else:
                    return None, "口令连续错误，已放弃导入"
            finally:
                root.destroy()
        else:
            b32, _hdr, cpath = passbox_mod.unwrap_secret(pb_path, None)
        # 试锁判定: 密钥必须能解开内嵌容器才允许入库
        uc = cont.unlock_container(cpath, secret_b32=b32)
        vid = uc.parsed.header.vault_id
        with SESSION._mutex:
            SESSION.register_secret(vid, b32,
                                    int(header.get("digits") or 6),
                                    uc.created)
        # 规范 §4.2 h)/H3: 成功导入后消费传播包(直接删除, 不入回收站);
        # 删除失败非致命, 仅告警, 导入结果不受影响。
        try:
            os.remove(pb_path)
        except OSError as exc:
            print("  [passbox] 警告: 传播包删除失败(不影响导入): %s" % exc)
        print("  [passbox] 已导入并注册: %s" % cpath)
        return cpath, None
    except AstboxError as exc:
        return None, str(exc)
    except Exception as exc:                      # noqa: BLE001
        return None, repr(exc)


def _run_server():
    global _SERVER
    ap = argparse.ArgumentParser(description="ASTBOX Liquid Glass Web UI")
    ap.add_argument("container", nargs="?", default=None,
                    help="启动后立即打开的 .astbox 文件(文件关联用)")
    ap.add_argument("--port", type=int, default=0,
                    help="监听端口(默认按首选序列 11920>21524>6583>"
                         "8466>7988 依次尝试, 全忙则随机)")
    ap.add_argument("--no-browser", action="store_true",
                    help="不自动打开任何界面")
    ap.add_argument("--ui", choices=["auto", "window"], default="auto",
                    help="界面通道: auto=便携Chromium>Edge/Chrome应用窗口")
    ap.add_argument("--import-passbox", dest="import_passbox",
                    default=None,
                    help="双击 .passbox 入口: 导入密钥并落下容器后打开")
    ns = ap.parse_args()

    if ns.import_passbox:
        pb = os.path.abspath(ns.import_passbox.strip().strip('"'))
        if not os.path.isfile(pb):
            _tk_error("文件不存在: %s" % pb)
        else:
            cpath, err = _import_passbox_boot(pb)
            if err:
                _tk_error(err)
            elif cpath:
                ns.container = cpath

    # 上传副本卫生：清理 7 天前的历史上传，防止 tmp/uploads 无限增长
    try:
        if os.path.isdir(UPLOAD_DIR):
            cutoff = time.time() - 7 * 86400
            for fn in os.listdir(UPLOAD_DIR):
                fp = os.path.join(UPLOAD_DIR, fn)
                if os.path.isfile(fp) and os.path.getmtime(fp) < cutoff:
                    os.remove(fp)
    except Exception:
        pass

    # 端口策略: 显式 --port 单点绑定; 否则按首选序列降序尝试, 全忙随机
    preferred = [11920, 21524, 6583, 8466, 7988]
    candidates = [ns.port] if ns.port else preferred + [0]
    srv = None
    last_bind_err = None
    for cand in candidates:
        try:
            srv = ThreadingHTTPServer(("127.0.0.1", cand), Handler)
            break
        except OSError as exc:
            last_bind_err = exc
            continue
    if srv is None:
        raise last_bind_err or RuntimeError("无可用端口")
    _SERVER = srv
    port = srv.server_address[1]
    url = "http://127.0.0.1:%d/" % port
    print("=" * 56)
    print("  ASTBOX 容器管理器 · V2.0.1 · Liquid Glass Web UI")
    print("  %s" % url)
    print("  仅监听 127.0.0.1，关闭此进程即退出。Ctrl+C 退出。")
    print("=" * 56)
    if ns.container:
        cpath = os.path.abspath(ns.container.strip().strip('"'))
        try:
            if not os.path.isfile(cpath):
                raise ApiError(E_NO_CONTAINER, "文件不存在: %s" % cpath)
            with SESSION._mutex:
                SESSION.open_path(cpath)
            print("  已打开: %s" % cpath)
        except Exception as exc:
            print("  打开容器失败: %r" % exc)
    if not ns.no_browser:
        threading.Timer(0.4, lambda: _open_ui(url, ns.ui)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n再见。")


if __name__ == "__main__":
    main()
