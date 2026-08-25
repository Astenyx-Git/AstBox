# -*- coding: utf-8 -*-
# Copyright 2026 Astenyx-Git
# SPDX-License-Identifier: Apache-2.0
"""ASTBOX 传播包 (.passbox) —— 自携带凭据的容器包裹格式。

布局:
    MAGIC       16B   b"ASTPASSBX1" + 6x\\x00
    HDRLEN       4B   big-endian, JSON 头字节数
    HEADER      JSON   {v, digits, created?, name, csha(容器SHA256hex),
                        wrap:"none"|"pass", salt/snonce/kdf(仅pass)}
    SECRETLEN    4B   big-endian
    SECRET_BLK         wrap=none: Base32 ASCII 原文
                       wrap=pass: XChaCha20-Poly1305(
                            key=Argon2id("ASTBOX-PASSBOX-v1"+口令,
                                         salt, constrained 参数, 32B),
                            aad=MAGIC)
    CONTAINER          完整 .astbox 字节(原样)
    TRAILER     32B    以上全部内容的 SHA-256

安全模型: 包在密码学上等价于容器钥匙。明文模式靠传输与文件权限保护;
口令模式为丢失/误传加一道 Argon2id 闸。
"""
import base64
import hashlib
import hmac as _hmac
import json
import os
import struct

from . import constants as C
from . import crypto
from .errors import AstboxError

MAGIC = b"ASTPASSBX1\x00\x00\x00\x00\x00\x00"
PB_DOMAIN = b"ASTBOX-PASSBOX-v1"
_SALT_LEN = 16


def _err(msg):
    return AstboxError(0x0399, msg)


def _derive_wrap_key(passphrase, salt, mem_kib, t, p):
    return crypto.argon2id_raw(
        PB_DOMAIN + str(passphrase).encode("utf-8"),
        salt, mem_kib, t, p, 32)


def pack_passbox(astbox_path, secret_b32, digits, created, out_path,
                 passphrase=None):
    """把容器与其 Base32 密钥打包为 .passbox。

    passphrase=None 生成免口令快速包。流式拷贝, 内存占用 O(1MiB)。
    """
    if not os.path.isfile(astbox_path):
        raise _err("容器文件不存在: %s" % astbox_path)
    norm = secret_b32.strip().upper().replace(" ", "")
    try:
        raw = base64.b32decode(norm + "=" * ((-len(norm)) % 8),
                               casefold=True)
        if len(raw) < 10:
            raise ValueError
    except Exception:
        raise _err("无效的 Base32 密钥")

    hdr = {
        "v": 1,
        "digits": int(digits),
        "created": int(created) if created else None,
        "name": os.path.basename(astbox_path),
        "wrap": "pass" if passphrase else "none",
    }
    if passphrase:
        salt = os.urandom(_SALT_LEN)
        snonce = os.urandom(24)
        mem_kib, t, p = C.ARGON2_PROFILES[C.KDF_PROFILE_MEMORY_CONSTRAINED]
        wk = _derive_wrap_key(passphrase, salt, mem_kib, t, p)
        blk = crypto.aead_encrypt(wk, snonce, norm.encode("ascii"), MAGIC)
        hdr["salt"] = salt.hex()
        hdr["snonce"] = snonce.hex()
        hdr["kdf"] = {"mem_kib": mem_kib, "t": t, "p": p}
    else:
        blk = norm.encode("ascii")

    header_bytes = json.dumps(hdr, ensure_ascii=False,
                              sort_keys=True).encode("utf-8")

    h = hashlib.sha256()
    tmp = out_path + ".part"
    try:
        with open(astbox_path, "rb") as fsrc, open(tmp, "wb") as fdst:
            def feed(b):
                h.update(b)
                fdst.write(b)
            feed(MAGIC)
            feed(struct.pack(">I", len(header_bytes)))
            feed(header_bytes)
            feed(struct.pack(">I", len(blk)))
            feed(blk)
            while True:
                chunk = fsrc.read(1024 * 1024)
                if not chunk:
                    break
                feed(chunk)
            fdst.write(h.digest())
        os.replace(tmp, out_path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    return out_path


def read_info(path):
    """读取包头信息(不解密密钥块)。返回 (header_dict, needs_pass)。"""
    with open(path, "rb") as f:
        if f.read(16) != MAGIC:
            raise _err("不是有效的 .passbox 文件")
        (hlen,) = struct.unpack(">I", f.read(4))
        header = json.loads(f.read(hlen).decode("utf-8"))
    return header, header.get("wrap") == "pass"


def unwrap_secret(path, passphrase=None):
    """校验整体 SHA-256 → 解出密钥 → 落下内嵌容器。

    返回 (secret_b32, header, container_path)。容器写到传播包同目录、
    同主名、.astbox 后缀。任何失败统一抛 AstboxError。
    """
    base = os.path.basename(path)
    stem = base[:-len(".passbox")] if base.lower().endswith(".passbox") \
        else base
    dir_ = os.path.dirname(os.path.abspath(path))
    container_path = os.path.join(dir_, stem + ".astbox")

    with open(path, "rb") as f:
        data = f.read()
    if len(data) < 16 + 4 + 2 + 4 + 32:
        raise _err(".passbox 文件过短或损坏")
    body, trailer = data[:-32], data[-32:]
    if not _hmac.compare_digest(hashlib.sha256(body).digest(), trailer):
        raise _err(".passbox 完整性校验失败(文件被截断或篡改)")

    off = 0
    if body[off:off + 16] != MAGIC:
        raise _err("不是有效的 .passbox 文件")
    off += 16
    (hlen,) = struct.unpack(">I", body[off:off + 4])
    off += 4
    header = json.loads(body[off:off + hlen].decode("utf-8"))
    off += hlen
    (blen,) = struct.unpack(">I", body[off:off + 4])
    off += 4
    blk = body[off:off + blen]
    off += blen
    container_bytes = body[off:]

    csha = hashlib.sha256(container_bytes).hexdigest()
    if header.get("csha") and csha != header.get("csha"):
        raise _err("内嵌容器校验和不匹配")

    if header.get("wrap") == "pass":
        if not passphrase:
            raise _err("该传播包受口令保护，需要输入口令")
        kdf = header.get("kdf", {})
        wk = _derive_wrap_key(passphrase,
                              bytes.fromhex(header.get("salt", "")),
                              int(kdf.get("mem_kib", 65536)),
                              int(kdf.get("t", 3)),
                              int(kdf.get("p", 1)))
        snonce = bytes.fromhex(header.get("snonce", ""))
        try:
            plain = crypto.aead_decrypt(wk, snonce, blk, MAGIC).decode(
                "ascii")
        except AstboxError:
            raise _err("口令错误或传播包已损坏")
    else:
        plain = blk.decode("ascii")

    norm = plain.strip().upper().replace(" ", "")
    try:
        raw = base64.b32decode(norm + "=" * ((-len(norm)) % 8),
                               casefold=True)
        if len(raw) < 10:
            raise ValueError
    except Exception:
        raise _err("传播包内的密钥块无效")

    with open(container_path, "wb") as f:
        f.write(container_bytes)
    return norm, header, container_path
