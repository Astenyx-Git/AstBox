# -*- coding: utf-8 -*-
# Copyright 2026 Astenyx-Git
# SPDX-License-Identifier: Apache-2.0
"""ASTBOX v1.0 container modification: add files to an unlocked container.

Implements ASTBOX-v1.0-03-Data-Container.txt sections 67/76/77/79-83:
  - caller must pass an UnlockedContainer (container was verified on unlock)
  - new random FileIDs and fresh nonces for every encrypted chunk
  - every Data Record is re-encrypted under the NEW generation with a fresh
    DataNonce (doc 03 s43: the Data AEAD associated data binds Generation;
    doc 03 s77: any Data Record modification must use fresh nonces)
  - the whole Data region is re-laid-out in canonical order (FileID
    ascending, then ChunkIndex) so every entry's absolute DataStart stays
    consistent with the new file layout
  - metadata re-encoded with deterministic CBOR and a fresh MetadataNonce
  - Generation increases by exactly one (no wrap)
  - Footer and Header regenerated; committed atomically (temp + replace)
"""
import os
import struct
import time
import unicodedata

from . import constants as C
from . import cbor_det
from . import container as cont
from . import crypto
from .errors import (
    AstboxError,
    E_INVALID_ARGUMENT,
    E_INVALID_FILE_NAME,
    E_ALREADY_EXISTS,
    E_STALE_GENERATION,
    E_IO,
)


def _validate_name(name):
    if not isinstance(name, str) or not name:
        raise AstboxError(E_INVALID_FILE_NAME, "empty entry name")
    if name in (".", ".."):
        raise AstboxError(E_INVALID_FILE_NAME, "name '.'/'..' forbidden")
    if "/" in name or "\\" in name or "\x00" in name:
        raise AstboxError(E_INVALID_FILE_NAME,
                          "name contains path separator or NUL")


def _entry_cbor(entry, modified, start, length):
    return {
        C.ENTRY_KEY_FILEID: entry.file_id,
        C.ENTRY_KEY_PARENT: entry.parent_id,
        C.ENTRY_KEY_TYPE: entry.entry_type,
        C.ENTRY_KEY_NAME: unicodedata.normalize("NFC", entry.name),
        C.ENTRY_KEY_SIZE: entry.size,
        C.ENTRY_KEY_DATA_START: start,
        C.ENTRY_KEY_DATA_LENGTH: length,
        C.ENTRY_KEY_MODIFIED: entry.modified,
        C.ENTRY_KEY_MODE: entry.file_mode,
    }


def _node_cbor(node, modified, start, length):
    return {
        C.ENTRY_KEY_FILEID: node["_id"],
        C.ENTRY_KEY_PARENT: node["_parent"],
        C.ENTRY_KEY_TYPE: node["_type"],
        C.ENTRY_KEY_NAME: unicodedata.normalize("NFC", node["_name"]),
        C.ENTRY_KEY_SIZE: node["_size"],
        C.ENTRY_KEY_DATA_START: start,
        C.ENTRY_KEY_DATA_LENGTH: length,
        C.ENTRY_KEY_MODIFIED: node.get("_modified", modified),
        C.ENTRY_KEY_MODE: 0,
    }


def _file_record_length(size, offset):
    return C.DATA_RECORD_OVERHEAD + min(C.MAX_CHUNK_PLAINTEXT,
                                       size - offset)


def add_files(uc, files, out_path, totp=None):
    """Add ``files`` ({logical_path: bytes}) to an unlocked container and
    write the new generation to ``out_path``.

    Returns the re-opened UnlockedContainer (self-verified with the given
    TOTP code), or None if no TOTP code was supplied for verification.
    """
    if not files:
        raise AstboxError(E_INVALID_ARGUMENT, "no files to add")
    parsed = uc.parsed
    header = parsed.header

    new_gen = header.generation + 1
    if new_gen == 0:
        raise AstboxError(E_STALE_GENERATION,
                          "Generation is at the maximum representable value")

    now = int(time.time())
    used_ids = set(uc.entries.keys()) | {C.ROOT_DIRECTORY_ID}

    def new_id():
        while True:
            fid = os.urandom(16)
            if fid != C.ROOT_DIRECTORY_ID and fid not in used_ids:
                used_ids.add(fid)
                return fid

    # --- existing logical path map ----------------------------------------
    existing_paths = {}   # logical path -> Entry
    for e in uc.entries.values():
        existing_paths["/".join(cont.entry_path_parts(uc, e))] = e

    # --- plan new nodes ----------------------------------------------------
    new_nodes = {}        # logical path -> node dict
    file_order = []

    def ensure_dir(dpath):
        if not dpath:
            return C.ROOT_DIRECTORY_ID
        if dpath in existing_paths:
            e = existing_paths[dpath]
            if not e.is_dir:
                raise AstboxError(E_INVALID_FILE_NAME,
                                  "%r is not a directory" % dpath)
            return e.file_id
        if dpath in new_nodes:
            n = new_nodes[dpath]
            if n["_type"] != C.TYPE_DIRECTORY:
                raise AstboxError(E_INVALID_FILE_NAME,
                                  "%r is not a directory" % dpath)
            return n["_id"]
        parts = dpath.split("/")
        parent = ensure_dir("/".join(parts[:-1]))
        _validate_name(parts[-1])
        node = {
            "_id": new_id(), "_parent": parent, "_name": parts[-1],
            "_type": C.TYPE_DIRECTORY, "_size": 0, "_modified": now,
        }
        new_nodes[dpath] = node
        return node["_id"]

    for path, data in files.items():
        parts = [p for p in path.split("/") if p]
        if not parts:
            raise AstboxError(E_INVALID_ARGUMENT, "empty path %r" % path)
        parent_id = ensure_dir("/".join(parts[:-1]))
        full = "/".join(parts)
        if full in existing_paths:
            raise AstboxError(E_ALREADY_EXISTS,
                              "%r already exists in the container" % full)
        if full in new_nodes:
            raise AstboxError(E_ALREADY_EXISTS, "duplicate path %r" % full)
        _validate_name(parts[-1])
        node = {
            "_id": new_id(), "_parent": parent_id, "_name": parts[-1],
            "_type": C.TYPE_FILE, "_size": len(data), "_data": data,
            "_modified": now,
        }
        new_nodes[full] = node
        file_order.append(full)

    # --- record-bearing files ----------------------------------------------
    # each item: (kind, file_id, entry_or_node, chunks_or_None)
    record_files = []
    for e in uc.entries.values():
        if e.is_file and e.size > 0:
            record_files.append(("old", e.file_id, e, uc.chunks[e.file_id]))
    for path in file_order:
        node = new_nodes[path]
        if node["_size"] > 0:
            record_files.append(("new", node["_id"], node, None))

    meta_offset = header.metadata_offset  # unchanged (KeySlotCount fixed)

    def build_metadata(data_offset):
        """Build metadata CBOR + layout for the given data region offset."""
        layout = {}
        pos = 0
        for kind, fid, ref, chunks in sorted(record_files,
                                             key=lambda x: x[1]):
            if kind == "old":
                length = sum(C.DATA_RECORD_OVERHEAD + c.plaintext_length
                             for c in chunks)
            else:
                length = sum(_file_record_length(ref["_size"], i)
                             for i in range(0, ref["_size"],
                                            C.MAX_CHUNK_PLAINTEXT))
            layout[fid] = (data_offset + pos, length)
            pos += length
        entry_list = []
        for e in sorted(uc.entries.values(), key=lambda x: x.file_id):
            s, l = layout.get(e.file_id, (0, 0))
            entry_list.append(_entry_cbor(e, e.modified, s, l))
        for path in sorted(new_nodes, key=lambda p: (p.count("/"), p)):
            node = new_nodes[path]
            s, l = layout.get(node["_id"], (0, 0))
            entry_list.append(_node_cbor(node, now, s, l))
        return cbor_det.dumps({
            C.META_KEY_VERSION: 1,
            C.META_KEY_ROOT: C.ROOT_DIRECTORY_ID,
            C.META_KEY_ENTRIES: entry_list,
            C.META_KEY_CREATED: uc.created,
            C.META_KEY_MODIFIED: now,
        }), layout

    # --- iterative layout (metadata length depends on DataStart values) ----
    data_offset = None
    for _ in range(8):
        meta_cbor, layout = build_metadata(
            data_offset if data_offset is not None else 0)
        meta_length = len(meta_cbor) + 24 + 16
        candidate = meta_offset + meta_length
        if data_offset is not None and candidate == data_offset:
            break
        data_offset = candidate
    else:
        raise AstboxError(E_INVALID_ARGUMENT, "layout did not converge")

    # --- assemble the new Data region --------------------------------------
    new_region = bytearray()
    keys = uc.keys
    vault_id = header.vault_id
    old_gen = header.generation  # generation the existing records were bound to

    def data_ad(gen, fid, cidx, plen):
        return (C.LABEL_DATA + vault_id + struct.pack(">Q", gen) + fid
                + struct.pack(">Q", cidx) + struct.pack(">I", plen))

    for kind, fid, ref, chunks in sorted(record_files,
                                         key=lambda x: x[1]):
        if kind == "old":
            # Re-encrypt existing records under the NEW generation with
            # fresh nonces (doc 03 s43: the Data AD binds Generation; doc 03
            # s77: any Data Record modification must use fresh DataNonce).
            for c in sorted(chunks, key=lambda c: c.chunk_index):
                plain = crypto.aead_decrypt(
                    keys["data"], c.nonce, c.ciphertext + c.tag,
                    data_ad(old_gen, fid, c.chunk_index,
                            c.plaintext_length))
                nonce = os.urandom(24)
                ct = crypto.aead_encrypt(
                    keys["data"], nonce, plain,
                    data_ad(new_gen, fid, c.chunk_index,
                            c.plaintext_length))
                new_region += (fid + struct.pack(">Q", c.chunk_index)
                               + struct.pack(">I", c.plaintext_length)
                               + nonce + ct)
        else:
            data = ref["_data"]
            for idx in range(0, len(data), C.MAX_CHUNK_PLAINTEXT):
                chunk = data[idx:idx + C.MAX_CHUNK_PLAINTEXT]
                nonce = os.urandom(24)
                cidx = idx // C.MAX_CHUNK_PLAINTEXT
                ct = crypto.aead_encrypt(
                    keys["data"], nonce, chunk,
                    data_ad(new_gen, fid, cidx, len(chunk)))
                new_region += (fid + struct.pack(">Q", cidx)
                               + struct.pack(">I", len(chunk)) + nonce + ct)

    data_length = len(new_region)
    footer_offset = data_offset + data_length

    # --- metadata record ----------------------------------------------------
    meta_cbor, layout = build_metadata(data_offset)
    meta_nonce = os.urandom(24)
    meta_ad = C.LABEL_METADATA + vault_id + struct.pack(">Q", new_gen)
    meta_ct = crypto.aead_encrypt(keys["metadata"], meta_nonce, meta_cbor,
                                  meta_ad)
    metadata_record = meta_nonce + meta_ct

    # --- footer --------------------------------------------------------------
    footer = bytearray(C.FOOTER_SIZE)
    cont._FOOTER_STRUCT.pack_into(
        footer, 0, C.FOOTER_MAGIC, C.VERSION, 0, new_gen,
        footer_offset + C.FOOTER_SIZE,
        crypto.sha256_first16(metadata_record),
        crypto.sha256_first16(bytes(new_region)),
        b"\x00" * 16, b"\x00" * 36)
    footer_without_mac = bytes(footer[0:60]) + b"\x00" * 16 \
        + bytes(footer[76:112])
    footer[60:76] = crypto.hmac_sha256_trunc16(
        keys["footer"], C.LABEL_FOOTER_MAC + footer_without_mac)

    # --- header (slots byte-identical to the original) ----------------------
    slot_bytes = parsed.raw[header.key_slot_offset:header.metadata_offset]
    header_blob = bytearray(C.HEADER_SIZE)
    cont._HEADER_STRUCT.pack_into(
        header_blob, 0, C.HEADER_MAGIC, C.VERSION, 0, vault_id, new_gen,
        C.HEADER_SIZE, len(slot_bytes), meta_offset, len(metadata_record),
        data_offset, data_length, footer_offset, C.FOOTER_SIZE,
        header.key_slot_count, C.HEADER_SIZE, b"\x00" * 16, b"\x00" * 4)
    header_without_mac = bytes(header_blob[0:108]) + b"\x00" * 16 \
        + bytes(header_blob[124:128])
    header_blob[108:124] = crypto.hmac_sha256_trunc16(
        keys["header"], C.LABEL_HEADER_MAC + header_without_mac)

    container_bytes = (bytes(header_blob) + slot_bytes + metadata_record
                       + bytes(new_region) + bytes(footer))

    # --- atomic commit --------------------------------------------------------
    tmp_path = out_path + ".tmp"
    try:
        with open(tmp_path, "wb") as f:
            f.write(container_bytes)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, out_path)
    except OSError as exc:
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except OSError:
            pass
        raise AstboxError(E_IO, "cannot commit %s: %s" % (out_path, exc))

    # --- self-verification -----------------------------------------------------
    if totp is not None:
        return cont.unlock_container(out_path, totp=totp)
    cont.parse_container(out_path)  # structural sanity check
    return None
