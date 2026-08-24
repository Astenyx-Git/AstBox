# -*- coding: utf-8 -*-
"""ASTBOX v1.0 container writer.

Used to create test/demo containers (and to round-trip verify the
decoder).  Follows ASTBOX-v1.0-03-Data-Container.txt creation rules:
fresh VaultID/VaultKey/salts/nonces, canonical CBOR metadata, chunked
encrypted Data Records ordered by FileID then ChunkIndex, footer digests
and MACs, header MAC last, Generation 0.
"""
import os
import struct
import time
import unicodedata

from . import constants as C
from . import cbor_det
from . import container as cont
from . import crypto
from .errors import AstboxError, E_INVALID_ARGUMENT, E_INVALID_FILE_NAME

_HEADER_STRUCT = cont._HEADER_STRUCT
_SLOT_STRUCT = cont._SLOT_STRUCT
_FOOTER_STRUCT = cont._FOOTER_STRUCT


def _validate_path_entry(name):
    if not name or name in (".", ".."):
        raise AstboxError(E_INVALID_FILE_NAME, "bad entry name %r" % name)
    if "/" in name or "\\" in name or "\x00" in name:
        raise AstboxError(E_INVALID_FILE_NAME,
                          "entry name must not contain separators")


def build_entry_map(files):
    """Turn {logical_path: bytes} into a nested structure with FileIDs.

    Returns (entries, file_order) where entries is a list of dicts ready
    for CBOR encoding and file_order is the list of file paths whose data
    must be encrypted (sorted by FileID later).
    """
    root_id = C.ROOT_DIRECTORY_ID
    nodes = {}          # path -> node dict
    dirs = {""}         # set of directory paths
    used_ids = set()
    now = int(time.time())

    def new_id():
        while True:
            fid = os.urandom(16)
            if fid != root_id and fid not in used_ids:
                used_ids.add(fid)
                return fid

    for path, data in files.items():
        parts = [p for p in path.split("/") if p]
        if not parts:
            raise AstboxError(E_INVALID_ARGUMENT, "empty path %r" % path)
        for i in range(len(parts) - 1):
            dpath = "/".join(parts[:i + 1])
            _validate_path_entry(parts[i])
            dirs.add(dpath)
        _validate_path_entry(parts[-1])

    # create directory nodes first (parents before children)
    for dpath in sorted(dirs, key=lambda p: (p.count("/"), p)):
        if not dpath:
            continue
        parts = dpath.split("/")
        parent = root_id
        if len(parts) > 1:
            parent = nodes["/".join(parts[:-1])]["_id"]
        nodes[dpath] = {
            "_id": new_id(),
            "_parent": parent,
            "_name": parts[-1],
            "_type": C.TYPE_DIRECTORY,
            "_size": 0,
        }

    file_order = []
    for path, data in files.items():
        parts = [p for p in path.split("/") if p]
        parent = root_id
        if len(parts) > 1:
            dpath = "/".join(parts[:-1])
            if dpath not in nodes:
                raise AstboxError(E_INVALID_ARGUMENT,
                                  "parent %r missing" % dpath)
            parent = nodes[dpath]["_id"]
        if path in nodes:
            raise AstboxError(E_INVALID_ARGUMENT,
                              "path %r is both file and directory" % path)
        fid = new_id()
        nodes[path] = {
            "_id": fid,
            "_parent": parent,
            "_name": parts[-1],
            "_type": C.TYPE_FILE,
            "_size": len(data),
            "_data": data,
        }
        file_order.append(path)

    entries = list(nodes.values())
    return entries, file_order


def build_metadata_cbor(entries, created=None, modified=None):
    now = int(time.time()) if created is None else int(created)
    mod = now if modified is None else int(modified)
    entry_list = []
    for node in entries:
        entry_list.append({
            C.ENTRY_KEY_FILEID: node["_id"],
            C.ENTRY_KEY_PARENT: node["_parent"],
            C.ENTRY_KEY_TYPE: node["_type"],
            C.ENTRY_KEY_NAME: unicodedata.normalize("NFC", node["_name"]),
            C.ENTRY_KEY_SIZE: node["_size"],
            C.ENTRY_KEY_DATA_START: node.get("_data_start", 0),
            C.ENTRY_KEY_DATA_LENGTH: node.get("_data_length", 0),
            C.ENTRY_KEY_MODIFIED: node.get("_modified", mod),
            C.ENTRY_KEY_MODE: 0,
        })
    return cbor_det.dumps({
        C.META_KEY_VERSION: 1,
        C.META_KEY_ROOT: C.ROOT_DIRECTORY_ID,
        C.META_KEY_ENTRIES: entry_list,
        C.META_KEY_CREATED: now,
        C.META_KEY_MODIFIED: mod,
    })


def _make_slot(credential_type, credential_parameters, credential_bytes,
               vault_id, vault_key, kdf_profile):
    slot_id = os.urandom(16)
    salt = os.urandom(32)
    wrap_nonce = os.urandom(24)
    mem_kib, t, p = C.ARGON2_PROFILES[kdf_profile]
    arg_input = crypto.build_argon2_input(
        credential_type, credential_parameters, credential_bytes)
    unlock_key = crypto.argon2id_raw(arg_input, salt, mem_kib, t, p, 32)
    ad = (C.LABEL_WRAP + vault_id + slot_id
          + struct.pack(">H", credential_type)
          + bytes([credential_parameters])
          + struct.pack(">H", kdf_profile)
          + struct.pack(">I", mem_kib) + struct.pack(">I", t)
          + struct.pack(">I", p)
          + salt + wrap_nonce)
    wrapped = crypto.aead_encrypt(unlock_key, wrap_nonce, vault_key, ad)
    return {
        "slot_id": slot_id,
        "credential_type": credential_type,
        "credential_parameters": credential_parameters,
        "kdf_profile": kdf_profile,
        "mem_kib": mem_kib, "t": t, "p": p,
        "salt": salt, "wrap_nonce": wrap_nonce,
        "wrapped_vault_key": wrapped,
    }


def create_container(path, totp_code=None, totp_digits=6,
                     files=None, seed_dir=None, kdf_profile=C.KDF_PROFILE_HIGH,
                     created=None, modified=None, totp_secret=None):
    """Create an ASTBOX v1 container at ``path``.

    TOTP is the sole credential type of ASTBOX v1:
      totp_secret: Base32 密钥(推荐)。KDF 凭据使用其解码字节 —— 稳定、
                   高熵, 容器可在任意时间/设备用该密钥打开。
      totp_code:   兼容参数。未提供 totp_secret 时, 以该 6/8 位码作为
                   KDF 凭据(旧行为: 仅封装窗口内可解锁)。
    """
    if files is None:
        files = {}
    if seed_dir is not None:
        for root, _dirs, fnames in os.walk(seed_dir):
            for fn in fnames:
                full = os.path.join(root, fn)
                rel = os.path.relpath(full, seed_dir).replace("\\", "/")
                with open(full, "rb") as f:
                    files[rel] = f.read()
    if totp_secret is None and totp_code is None:
        raise AstboxError(E_INVALID_ARGUMENT,
                          "a TOTP secret or code is required "
                          "(sole credential type)")

    vault_id = os.urandom(16)
    vault_key = os.urandom(32)
    if totp_secret is not None:
        # 稳定凭据: Base32 密钥解码字节(高熵, 任意时间可解锁)
        import base64 as _b64
        norm = totp_secret.strip().upper().replace(" ", "")
        try:
            cred_bytes = _b64.b32decode(
                norm + "=" * ((-len(norm)) % 8), casefold=True)
        except Exception:
            raise AstboxError(E_INVALID_ARGUMENT,
                              "invalid Base32 TOTP secret")
        if len(cred_bytes) < 10:
            raise AstboxError(E_INVALID_ARGUMENT,
                              "TOTP secret too short")
    else:
        code = str(totp_code).strip()
        if len(code) != totp_digits or not code.isdigit():
            raise AstboxError(E_INVALID_ARGUMENT,
                              "TOTP code must be %d digits" % totp_digits)
        cred_bytes = code.encode("ascii")
    slots = [_make_slot(C.CRED_TYPE_TOTP, totp_digits, cred_bytes,
                        vault_id, vault_key, kdf_profile)]

    entries, file_order = build_entry_map(files)
    now = int(time.time()) if created is None else int(created)
    mod = now if modified is None else int(modified)
    for node in entries:
        node["_modified"] = mod

    keys = crypto.hkdf_derive(vault_key, vault_id)

    # ---- data region (iterative layout) ----
    key_slot_length = len(slots) * C.KEY_SLOT_SIZE
    metadata_offset = C.HEADER_SIZE + key_slot_length
    data_offset = None
    meta_cbor = None
    for _ in range(8):
        meta_cbor = build_metadata_cbor(entries, now, mod)
        metadata_length = len(meta_cbor) + 24 + 16
        candidate_data_offset = metadata_offset + metadata_length
        if data_offset is not None and candidate_data_offset == data_offset:
            break
        data_offset = candidate_data_offset
        # lay out records sorted by FileID
        file_nodes = [n for n in entries if n["_type"] == C.TYPE_FILE]
        file_nodes.sort(key=lambda n: n["_id"])
        pos = 0
        for node in file_nodes:
            if node["_size"] == 0:
                node["_data_start"] = 0
                node["_data_length"] = 0
                continue
            node["_data_start"] = data_offset + pos
            n_chunks = (node["_size"] + C.MAX_CHUNK_PLAINTEXT - 1) \
                // C.MAX_CHUNK_PLAINTEXT
            node["_data_length"] = sum(
                C.DATA_RECORD_OVERHEAD
                + min(C.MAX_CHUNK_PLAINTEXT,
                      node["_size"] - i * C.MAX_CHUNK_PLAINTEXT)
                for i in range(n_chunks))
            pos += node["_data_length"]
        data_length = pos
    else:
        raise AstboxError(E_INVALID_ARGUMENT, "layout did not converge")
    footer_offset = data_offset + data_length

    # ---- encrypt chunks (FileID ascending, then ChunkIndex) ----
    data_region = bytearray()
    for node in sorted((n for n in entries if n["_type"] == C.TYPE_FILE),
                       key=lambda n: n["_id"]):
        if node["_size"] == 0:
            continue
        data = node["_data"]
        for idx in range(0, len(data), C.MAX_CHUNK_PLAINTEXT):
            chunk = data[idx:idx + C.MAX_CHUNK_PLAINTEXT]
            nonce = os.urandom(24)
            ad = (C.LABEL_DATA + vault_id
                  + struct.pack(">Q", 0)
                  + node["_id"]
                  + struct.pack(">Q", idx // C.MAX_CHUNK_PLAINTEXT)
                  + struct.pack(">I", len(chunk)))
            ct = crypto.aead_encrypt(keys["data"], nonce, chunk, ad)
            data_region += (node["_id"]
                            + struct.pack(">Q", idx // C.MAX_CHUNK_PLAINTEXT)
                            + struct.pack(">I", len(chunk))
                            + nonce + ct)

    # ---- metadata record ----
    meta_cbor = build_metadata_cbor(entries, now, mod)
    meta_nonce = os.urandom(24)
    meta_ad = C.LABEL_METADATA + vault_id + struct.pack(">Q", 0)
    meta_ct = crypto.aead_encrypt(keys["metadata"], meta_nonce, meta_cbor,
                                  meta_ad)
    metadata_record = meta_nonce + meta_ct

    # ---- footer ----
    footer = bytearray(C.FOOTER_SIZE)
    _FOOTER_STRUCT.pack_into(
        footer, 0, C.FOOTER_MAGIC, C.VERSION, 0, 0,
        footer_offset + C.FOOTER_SIZE,
        crypto.sha256_first16(bytes(metadata_record)),
        crypto.sha256_first16(bytes(data_region)),
        b"\x00" * 16, b"\x00" * 36)
    footer_without_mac = bytes(footer[0:60]) + b"\x00" * 16 \
        + bytes(footer[76:112])
    footer[60:76] = crypto.hmac_sha256_trunc16(
        keys["footer"], C.LABEL_FOOTER_MAC + footer_without_mac)

    # ---- key slots (SlotMAC after SlotMACKey is known) ----
    slot_blobs = []
    for s in slots:
        blob = bytearray(C.KEY_SLOT_SIZE)
        _SLOT_STRUCT.pack_into(
            blob, 0, s["slot_id"], s["credential_type"],
            s["credential_parameters"], 0, s["kdf_profile"], 0,
            s["mem_kib"], s["t"], s["p"], s["salt"], s["wrap_nonce"],
            s["wrapped_vault_key"], b"\x00" * 16, b"\x00" * 36)
        mac_input = C.LABEL_SLOT_MAC + bytes(blob[0:140]) + bytes(blob[156:192])
        blob[140:156] = crypto.hmac_sha256_trunc16(keys["slotmac"], mac_input)
        slot_blobs.append(bytes(blob))

    # ---- header ----
    header = bytearray(C.HEADER_SIZE)
    _HEADER_STRUCT.pack_into(
        header, 0, C.HEADER_MAGIC, C.VERSION, 0, vault_id, 0,
        C.HEADER_SIZE, key_slot_length, metadata_offset, len(metadata_record),
        data_offset, data_length, footer_offset, C.FOOTER_SIZE,
        len(slots), C.HEADER_SIZE, b"\x00" * 16, b"\x00" * 4)
    header_without_mac = bytes(header[0:108]) + b"\x00" * 16 \
        + bytes(header[124:128])
    header[108:124] = crypto.hmac_sha256_trunc16(
        keys["header"], C.LABEL_HEADER_MAC + header_without_mac)

    container_bytes = (bytes(header) + b"".join(slot_blobs)
                       + bytes(metadata_record) + bytes(data_region)
                       + bytes(footer))

    with open(path, "wb") as f:
        f.write(container_bytes)

    # self-verification
    if totp_secret is not None:
        uc = cont.unlock_container(path, secret_b32=totp_secret)
    else:
        uc = cont.unlock_container(path, totp=totp_code)
    return uc
