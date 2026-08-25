# -*- coding: utf-8 -*-
# Copyright 2026 Astenyx-Git
# SPDX-License-Identifier: Apache-2.0
"""ASTBOX v1.0 container parsing, unlocking and extraction.

Implements the binary layout of ASTBOX-v1.0-01-Core-Format.txt, the
cryptographic flows of ASTBOX-v1.0-02-Key-Crypto.txt and the metadata /
data / footer rules of ASTBOX-v1.0-03-Data-Container.txt.
"""
import base64
import os
import struct
from dataclasses import dataclass, field

from . import constants as C
from . import cbor_det
from . import crypto
from .errors import (
    AstboxError,
    E_INVALID_MAGIC,
    E_UNSUPPORTED_VERSION,
    E_INVALID_HEADER,
    E_INVALID_FOOTER,
    E_INVALID_LENGTH,
    E_INVALID_OFFSET,
    E_INTEGER_OVERFLOW,
    E_RESERVED_FIELD,
    E_INVALID_ENTRY,
    E_INVALID_DIRECTORY_TREE,
    E_INVALID_FILE_NAME,
    E_INVALID_DATA_RECORD,
    E_AUTHENTICATION_FAILED,
    E_NO_VALID_CREDENTIAL,
    E_INVALID_TOTP,
    E_INVALID_TOTP_DIGITS,
    E_UNSUPPORTED_CREDENTIAL,
    E_HEADER_MAC_FAILURE,
    E_FOOTER_MAC_FAILURE,
    E_METADATA_DIGEST_FAILURE,
    E_DATA_DIGEST_FAILURE,
    E_METADATA_AEAD_FAILURE,
    E_DATA_AEAD_FAILURE,
    E_GENERATION_MISMATCH,
    E_CONTAINER_LENGTH_MISMATCH,
    E_INVALID_CBOR,
    E_UNKNOWN_FIELD,
    E_IO,
)

_HEADER_STRUCT = struct.Struct(">6s H I 16s 9Q I I 16s 4s")
_SLOT_STRUCT = struct.Struct(">16s H B B H H I I I 32s 24s 48s 16s 36s")
_FOOTER_STRUCT = struct.Struct(">8s H H Q Q 16s 16s 16s 36s")


def _u64(v):
    return v & 0xFFFFFFFFFFFFFFFF


def _checked_add(a, b, what):
    s = a + b
    if s > 0xFFFFFFFFFFFFFFFF:
        raise AstboxError(E_INTEGER_OVERFLOW, "%s overflows UINT64" % what)
    return s


def _checked_mul(a, b, what):
    p = a * b
    if p > 0xFFFFFFFFFFFFFFFF:
        raise AstboxError(E_INTEGER_OVERFLOW, "%s overflows UINT64" % what)
    return p


# ---------------------------------------------------------------------------
# Parsed structures
# ---------------------------------------------------------------------------

@dataclass
class Header:
    magic: bytes
    version: int
    flags: int
    vault_id: bytes
    generation: int
    key_slot_offset: int
    key_slot_length: int
    metadata_offset: int
    metadata_length: int
    data_offset: int
    data_length: int
    footer_offset: int
    footer_length: int
    key_slot_count: int
    header_length: int
    header_mac: bytes
    reserved: bytes


@dataclass
class KeySlot:
    index: int
    slot_id: bytes
    credential_type: int
    credential_parameters: int
    kdf_profile: int
    argon2_memory_kib: int
    argon2_time: int
    argon2_parallelism: int
    salt: bytes
    wrap_nonce: bytes
    wrapped_vault_key: bytes
    slot_mac: bytes

    @property
    def is_totp(self):
        return self.credential_type == C.CRED_TYPE_TOTP

    @property
    def totp_digits(self):
        return self.credential_parameters if self.is_totp else None

    @property
    def kdf_label(self):
        return {C.KDF_PROFILE_HIGH: "ARGON2ID_HIGH",
                C.KDF_PROFILE_MEMORY_CONSTRAINED: "ARGON2ID_MEMORY_CONSTRAINED"
                }.get(self.kdf_profile, "unknown")

    @property
    def kdf_params(self):
        return (self.argon2_memory_kib, self.argon2_time,
                self.argon2_parallelism)


@dataclass
class Footer:
    magic: bytes
    version: int
    flags: int
    generation: int
    container_length: int
    metadata_digest: bytes
    data_digest: bytes
    footer_mac: bytes
    reserved: bytes


@dataclass
class ParsedContainer:
    path: str
    raw: bytes
    header: Header
    slots: list
    footer: Footer


@dataclass
class Entry:
    file_id: bytes
    parent_id: bytes
    entry_type: int
    name: str
    size: int
    data_start: int
    data_length: int
    modified: int
    file_mode: int

    @property
    def is_dir(self):
        return self.entry_type == C.TYPE_DIRECTORY

    @property
    def is_file(self):
        return self.entry_type == C.TYPE_FILE


@dataclass
class DataChunk:
    file_id: bytes
    chunk_index: int
    plaintext_length: int
    nonce: bytes
    ciphertext: bytes
    tag: bytes
    record_offset: int  # absolute file offset of this record


@dataclass
class UnlockedContainer:
    parsed: ParsedContainer
    vault_key: bytes
    keys: dict
    metadata: dict
    created: int
    modified: int
    entries: dict = field(default_factory=dict)      # FileID -> Entry
    children: dict = field(default_factory=dict)     # ParentID -> [Entry]
    chunks: dict = field(default_factory=dict)       # FileID -> [DataChunk]


# ---------------------------------------------------------------------------
# Structural parsing
# ---------------------------------------------------------------------------

def _check_reserved(cond, what, code=E_RESERVED_FIELD):
    if cond:
        raise AstboxError(code, "%s must be zero" % what)


def parse_header(raw):
    if len(raw) < C.HEADER_SIZE:
        raise AstboxError(E_INVALID_HEADER, "file shorter than 128-byte header")
    (magic, version, flags, vault_id, generation,
     key_slot_offset, key_slot_length,
     metadata_offset, metadata_length,
     data_offset, data_length,
     footer_offset, footer_length,
     key_slot_count, header_length, header_mac, reserved) = \
        _HEADER_STRUCT.unpack_from(raw, 0)

    if magic != C.HEADER_MAGIC:
        raise AstboxError(E_INVALID_MAGIC,
                          "bad header magic %s" % magic.hex())
    if version != C.VERSION:
        raise AstboxError(E_UNSUPPORTED_VERSION,
                          "unsupported format version %d" % version)
    if flags != 0:
        raise AstboxError(E_INVALID_HEADER, "non-zero header Flags")
    if header_length != C.HEADER_SIZE:
        raise AstboxError(E_INVALID_HEADER,
                          "HeaderLength %d != 128" % header_length)
    if key_slot_offset != C.HEADER_SIZE:
        raise AstboxError(E_INVALID_OFFSET,
                          "KeySlotOffset %d != 128" % key_slot_offset)
    if not (C.MIN_KEY_SLOT_COUNT <= key_slot_count <= C.MAX_KEY_SLOT_COUNT):
        raise AstboxError(E_INVALID_HEADER,
                          "KeySlotCount %d outside 1..16" % key_slot_count)
    if footer_length != C.FOOTER_SIZE:
        raise AstboxError(E_INVALID_LENGTH,
                          "FooterLength %d != 112" % footer_length)
    _check_reserved(reserved != b"\x00" * 4, "Header Reserved")

    expect_ksl = _checked_mul(key_slot_count, C.KEY_SLOT_SIZE, "KeySlotLength")
    if key_slot_length != expect_ksl:
        raise AstboxError(E_INVALID_LENGTH,
                          "KeySlotLength %d != count*192" % key_slot_length)
    expect_mo = _checked_add(key_slot_offset, key_slot_length, "MetadataOffset")
    if metadata_offset != expect_mo:
        raise AstboxError(E_INVALID_OFFSET,
                          "MetadataOffset %d != %d" % (metadata_offset, expect_mo))
    if metadata_length < C.METADATA_NONCE_SIZE + C.METADATA_TAG_SIZE:
        raise AstboxError(E_INVALID_LENGTH, "MetadataLength too small")
    expect_do = _checked_add(metadata_offset, metadata_length, "DataOffset")
    if data_offset != expect_do:
        raise AstboxError(E_INVALID_OFFSET,
                          "DataOffset %d != %d" % (data_offset, expect_do))
    expect_fo = _checked_add(data_offset, data_length, "FooterOffset")
    if footer_offset != expect_fo:
        raise AstboxError(E_INVALID_OFFSET,
                          "FooterOffset %d != %d" % (footer_offset, expect_fo))
    expect_size = _checked_add(footer_offset, footer_length, "FileSize")
    if expect_size != len(raw):
        raise AstboxError(E_CONTAINER_LENGTH_MISMATCH,
                          "file size %d != FooterOffset+112 (%d)"
                          % (len(raw), expect_size))
    if footer_offset + footer_length > len(raw):
        raise AstboxError(E_INVALID_OFFSET, "Footer beyond end of file")

    return Header(magic, version, flags, vault_id, generation,
                  key_slot_offset, key_slot_length,
                  metadata_offset, metadata_length,
                  data_offset, data_length,
                  footer_offset, footer_length,
                  key_slot_count, header_length, header_mac, reserved)


def parse_key_slots(raw, header):
    slots = []
    base = header.key_slot_offset
    for i in range(header.key_slot_count):
        off = base + i * C.KEY_SLOT_SIZE
        if off + C.KEY_SLOT_SIZE > len(raw):
            raise AstboxError(E_INVALID_HEADER, "Key Slot region truncated")
        (slot_id, cred_type, cred_params, r1, kdf_profile, r2,
         mem_kib, time_cost, parallelism, salt, wrap_nonce,
         wrapped_key, slot_mac, r3) = _SLOT_STRUCT.unpack_from(raw, off)
        _check_reserved(r1 != 0, "Key Slot Reserved1")
        _check_reserved(r2 != 0, "Key Slot Reserved2")
        _check_reserved(r3 != b"\x00" * 36, "Key Slot Reserved3")
        if cred_type == C.CRED_TYPE_PASSWORD:
            raise AstboxError(
                E_UNSUPPORTED_CREDENTIAL,
                "password Key Slots are not part of the ASTBOX v1 design; "
                "container rejected")
        if cred_type != C.CRED_TYPE_TOTP:
            raise AstboxError(E_UNSUPPORTED_CREDENTIAL,
                              "unknown CredentialType 0x%04X" % cred_type)
        if cred_params not in (6, 8):
            raise AstboxError(E_INVALID_TOTP_DIGITS,
                              "TOTP digits %d not in (6, 8)" % cred_params)
        profile = C.ARGON2_PROFILES.get(kdf_profile)
        if profile is None:
            raise AstboxError(E_UNSUPPORTED_CREDENTIAL,
                              "unknown KDFProfile 0x%04X" % kdf_profile)
        if (mem_kib, time_cost, parallelism) != profile:
            raise AstboxError(
                E_INVALID_HEADER,
                "Argon2 parameters do not match KDFProfile 0x%04X"
                % kdf_profile)
        slots.append(KeySlot(i, slot_id, cred_type, cred_params, kdf_profile,
                             mem_kib, time_cost, parallelism, salt, wrap_nonce,
                             wrapped_key, slot_mac))
    ids = [s.slot_id for s in slots]
    if len(set(ids)) != len(ids):
        raise AstboxError(E_INVALID_HEADER, "duplicate SlotID in container")
    return slots


def parse_footer(raw, header):
    off = header.footer_offset
    if off + C.FOOTER_SIZE > len(raw):
        raise AstboxError(E_INVALID_FOOTER, "footer truncated")
    (magic, version, flags, generation, container_length,
     meta_digest, data_digest, footer_mac, reserved) = \
        _FOOTER_STRUCT.unpack_from(raw, off)
    if magic != C.FOOTER_MAGIC:
        raise AstboxError(E_INVALID_FOOTER,
                          "bad footer magic %s" % magic.hex())
    if version != C.VERSION:
        raise AstboxError(E_UNSUPPORTED_VERSION,
                          "unsupported footer version %d" % version)
    if flags != 0:
        raise AstboxError(E_INVALID_FOOTER, "non-zero FooterFlags")
    if generation != header.generation:
        raise AstboxError(E_GENERATION_MISMATCH,
                          "FooterGeneration %d != Header.Generation %d"
                          % (generation, header.generation))
    if container_length != len(raw):
        raise AstboxError(E_CONTAINER_LENGTH_MISMATCH,
                          "ContainerLength %d != file size %d"
                          % (container_length, len(raw)))
    _check_reserved(reserved != b"\x00" * 36, "Footer Reserved")
    return Footer(magic, version, flags, generation, container_length,
                  meta_digest, data_digest, footer_mac, reserved)


def parse_container(path, raw=None):
    """Structurally parse a container (no credentials needed)."""
    if raw is None:
        try:
            with open(path, "rb") as f:
                raw = f.read()
        except OSError as exc:
            raise AstboxError(E_IO, "cannot read %s: %s" % (path, exc))
    header = parse_header(raw)
    slots = parse_key_slots(raw, header)
    footer = parse_footer(raw, header)
    return ParsedContainer(path, raw, header, slots, footer)


# ---------------------------------------------------------------------------
# Unlock
# ---------------------------------------------------------------------------

def _wrap_associated_data(header, slot):
    return (C.LABEL_WRAP
            + header.vault_id
            + slot.slot_id
            + struct.pack(">H", slot.credential_type)
            + bytes([slot.credential_parameters])
            + struct.pack(">H", slot.kdf_profile)
            + struct.pack(">I", slot.argon2_memory_kib)
            + struct.pack(">I", slot.argon2_time)
            + struct.pack(">I", slot.argon2_parallelism)
            + slot.salt
            + slot.wrap_nonce)


def derive_unlock_key(slot, credential_bytes):
    arg_input = crypto.build_argon2_input(
        slot.credential_type, slot.credential_parameters, credential_bytes)
    mem_kib, t, p = slot.kdf_params
    return crypto.argon2id_raw(arg_input, slot.salt, mem_kib, t, p, 32)


def _unwrap_vault_key(header, slot, unlock_key):
    """Return the 32-byte VaultKey or raise AstboxError on auth failure."""
    return crypto.aead_decrypt(
        unlock_key, slot.wrap_nonce, slot.wrapped_vault_key,
        _wrap_associated_data(header, slot))


def _verify_header_mac(parsed, header_key):
    h = parsed.header
    header_without_mac = (parsed.raw[0:108]
                          + b"\x00" * 16
                          + parsed.raw[124:128])
    expect = crypto.hmac_sha256_trunc16(
        header_key, C.LABEL_HEADER_MAC + header_without_mac)
    if not _const_eq(expect, h.header_mac):
        raise AstboxError(E_HEADER_MAC_FAILURE, "HeaderMAC verification failed")


def _verify_slot_macs(parsed, slotmac_key):
    for slot in parsed.slots:
        off = parsed.header.key_slot_offset + slot.index * C.KEY_SLOT_SIZE
        slot_bytes = parsed.raw[off:off + C.KEY_SLOT_SIZE]
        mac_input = C.LABEL_SLOT_MAC + slot_bytes[0:140] + slot_bytes[156:192]
        expect = crypto.hmac_sha256_trunc16(slotmac_key, mac_input)
        if not _const_eq(expect, slot.slot_mac):
            raise AstboxError(E_HEADER_MAC_FAILURE,
                              "SlotMAC verification failed for slot %d"
                              % slot.index)


def _verify_footer(parsed, footer_key):
    f = parsed.footer
    off = parsed.header.footer_offset
    footer_bytes = parsed.raw[off:off + C.FOOTER_SIZE]
    without_mac = footer_bytes[0:60] + b"\x00" * 16 + footer_bytes[76:112]
    expect = crypto.hmac_sha256_trunc16(
        footer_key, C.LABEL_FOOTER_MAC + without_mac)
    if not _const_eq(expect, f.footer_mac):
        raise AstboxError(E_FOOTER_MAC_FAILURE, "FooterMAC verification failed")
    # digests
    meta_record = parsed.raw[parsed.header.metadata_offset:
                             parsed.header.metadata_offset
                             + parsed.header.metadata_length]
    if not _const_eq(crypto.sha256_first16(meta_record), f.metadata_digest):
        raise AstboxError(E_METADATA_DIGEST_FAILURE,
                          "MetadataDigest mismatch")
    data_region = parsed.raw[parsed.header.data_offset:
                             parsed.header.data_offset
                             + parsed.header.data_length]
    if not _const_eq(crypto.sha256_first16(data_region), f.data_digest):
        raise AstboxError(E_DATA_DIGEST_FAILURE, "DataDigest mismatch")


def _const_eq(a, b):
    import hmac as _hmac
    return _hmac.compare_digest(a, b)


def _decrypt_metadata(parsed, metadata_key):
    h = parsed.header
    record = parsed.raw[h.metadata_offset:h.metadata_offset + h.metadata_length]
    nonce = record[0:24]
    tag = record[-16:]
    ct = record[24:-16]
    ad = C.LABEL_METADATA + h.vault_id + struct.pack(">Q", h.generation)
    try:
        plain = crypto.aead_decrypt(metadata_key, nonce, ct + tag, ad)
    except AstboxError as exc:
        raise AstboxError(E_METADATA_AEAD_FAILURE,
                          "metadata authentication failed (%s)" % exc.message)
    try:
        return cbor_det.loads(plain)
    except AstboxError:
        raise


def _validate_name(name):
    if not isinstance(name, str) or not name:
        raise AstboxError(E_INVALID_FILE_NAME, "empty entry name")
    if name == "." or name == "..":
        raise AstboxError(E_INVALID_FILE_NAME, "name '.'/'..' forbidden")
    if "/" in name or "\\" in name or "\x00" in name:
        raise AstboxError(E_INVALID_FILE_NAME,
                          "name contains path separator or NUL")


def validate_metadata(meta):
    """Validate the decrypted metadata object; return (entries, children)."""
    if not isinstance(meta, dict):
        raise AstboxError(E_INVALID_CBOR, "metadata root must be a map")
    if set(meta.keys()) != {1, 2, 3, 4, 5}:
        raise AstboxError(E_UNKNOWN_FIELD,
                          "metadata top-level keys must be exactly 1..5")
    if meta[1] != 1:
        raise AstboxError(E_UNSUPPORTED_VERSION,
                          "MetadataVersion %r != 1" % (meta[1],))
    if meta[2] != C.ROOT_DIRECTORY_ID:
        raise AstboxError(E_INVALID_ENTRY,
                          "RootDirectoryID must be 16 zero bytes")
    if not isinstance(meta[3], list):
        raise AstboxError(E_INVALID_CBOR, "Entries must be an array")
    created, modified = meta[4], meta[5]
    if not isinstance(created, int) or not isinstance(modified, int):
        raise AstboxError(E_INVALID_CBOR,
                          "ContainerCreated/Modified must be integers")

    entries = {}
    children = {C.ROOT_DIRECTORY_ID: []}
    for item in meta[3]:
        if not isinstance(item, dict):
            raise AstboxError(E_INVALID_ENTRY, "entry must be a map")
        if set(item.keys()) != {1, 2, 3, 4, 5, 6, 7, 8, 9}:
            raise AstboxError(E_UNKNOWN_FIELD,
                              "entry keys must be exactly 1..9")
        file_id = item[1]
        parent_id = item[2]
        etype = item[3]
        name = item[4]
        size = item[5]
        data_start = item[6]
        data_length = item[7]
        modified_t = item[8]
        mode = item[9]
        if not isinstance(file_id, bytes) or len(file_id) != 16:
            raise AstboxError(E_INVALID_ENTRY, "FileID must be 16 bytes")
        if not isinstance(parent_id, bytes) or len(parent_id) != 16:
            raise AstboxError(E_INVALID_ENTRY, "ParentID must be 16 bytes")
        if file_id == C.ROOT_DIRECTORY_ID:
            raise AstboxError(E_INVALID_ENTRY,
                              "root FileID must not appear as an entry")
        if etype not in (C.TYPE_DIRECTORY, C.TYPE_FILE):
            raise AstboxError(E_INVALID_ENTRY, "unknown entry type %r" % etype)
        for v, what in ((size, "Size"), (data_start, "DataStart"),
                        (data_length, "DataLength"), (modified_t, "Modified"),
                        (mode, "FileMode")):
            if not isinstance(v, int) or v < 0:
                raise AstboxError(E_INVALID_ENTRY,
                                  "%s must be a non-negative integer" % what)
        _validate_name(name)
        if file_id in entries:
            raise AstboxError(E_INVALID_ENTRY, "duplicate FileID")
        entry = Entry(file_id, parent_id, etype, name, size, data_start,
                      data_length, modified_t, mode)
        if entry.is_dir:
            if size != 0 or data_start != 0 or data_length != 0:
                raise AstboxError(E_INVALID_ENTRY,
                                  "directory must have Size/DataStart/"
                                  "DataLength == 0")
        else:
            if size == 0:
                if data_length != 0 or data_start != 0:
                    raise AstboxError(
                        E_INVALID_ENTRY,
                        "empty file must have DataStart/DataLength == 0")
            elif data_length <= 0:
                raise AstboxError(E_INVALID_ENTRY,
                                  "non-empty file must have DataLength > 0")
        entries[file_id] = entry
        children.setdefault(parent_id, []).append(entry)

    # tree validation
    for file_id, entry in entries.items():
        _walk_parent(entries, file_id, depth=0)
        if entry.parent_id not in entries and entry.parent_id != C.ROOT_DIRECTORY_ID:
            raise AstboxError(E_INVALID_DIRECTORY_TREE,
                              "ParentID of %r does not reference a directory"
                              % entry.name)
        if entry.parent_id in entries and not entries[entry.parent_id].is_dir:
            raise AstboxError(E_INVALID_DIRECTORY_TREE,
                              "parent of %r is not a directory" % entry.name)
        if entry.parent_id == file_id:
            raise AstboxError(E_INVALID_DIRECTORY_TREE,
                              "entry %r is its own parent" % entry.name)
    for parent_id, siblings in children.items():
        names = [s.name for s in siblings]
        if len(set(names)) != len(names):
            raise AstboxError(E_INVALID_DIRECTORY_TREE,
                              "duplicate sibling name under one parent")
    return entries, children


def _walk_parent(entries, file_id, depth=0):
    if depth > C.MAX_DIRECTORY_DEPTH:
        raise AstboxError(E_INVALID_DIRECTORY_TREE, "directory tree too deep")
    entry = entries[file_id]
    if entry.parent_id == C.ROOT_DIRECTORY_ID:
        return
    if entry.parent_id == file_id or entry.parent_id not in entries:
        raise AstboxError(E_INVALID_DIRECTORY_TREE,
                          "cycle or missing parent for %r" % entry.name)
    _walk_parent(entries, entry.parent_id, depth + 1)


# ---------------------------------------------------------------------------
# Data region
# ---------------------------------------------------------------------------

def index_data(parsed, entries):
    """Structurally walk the Data region and cross-check with metadata."""
    h = parsed.header
    region = parsed.raw[h.data_offset:h.data_offset + h.data_length]
    chunks = {}
    pos = 0
    while pos < len(region):
        rec_start_abs = h.data_offset + pos
        if pos + 52 > len(region):
            raise AstboxError(E_INVALID_DATA_RECORD,
                              "truncated Data Record header")
        file_id = region[pos:pos + 16]
        chunk_index = struct.unpack(">Q", region[pos + 16:pos + 24])[0]
        plaintext_length = struct.unpack(">I", region[pos + 24:pos + 28])[0]
        nonce = region[pos + 28:pos + 52]
        if plaintext_length < 1 or plaintext_length > C.MAX_CHUNK_PLAINTEXT:
            raise AstboxError(
                E_INVALID_DATA_RECORD,
                "PlaintextLength %d out of range 1..1048576"
                % plaintext_length)
        rec_len = C.DATA_RECORD_OVERHEAD + plaintext_length
        if pos + rec_len > len(region):
            raise AstboxError(E_INVALID_DATA_RECORD,
                              "Data Record extends past Data region")
        ct = region[pos + 52:pos + 52 + plaintext_length]
        tag = region[pos + 52 + plaintext_length:pos + rec_len]
        chunks.setdefault(file_id, []).append(
            DataChunk(file_id, chunk_index, plaintext_length, nonce, ct, tag,
                      rec_start_abs))
        pos += rec_len
    if pos != len(region):
        raise AstboxError(E_INVALID_DATA_RECORD,
                          "unaccounted bytes in Data region")

    for file_id, clist in chunks.items():
        entry = entries.get(file_id)
        if entry is None or not entry.is_file:
            raise AstboxError(E_INVALID_DATA_RECORD,
                              "Data Record references unknown FileID")
        clist.sort(key=lambda c: c.chunk_index)
        indexes = [c.chunk_index for c in clist]
        if indexes != list(range(len(clist))):
            raise AstboxError(E_INVALID_DATA_RECORD,
                              "non-contiguous ChunkIndex for %s"
                              % file_id.hex())
        if entry.size == 0:
            raise AstboxError(E_INVALID_DATA_RECORD,
                              "Data Records for a zero-size file")
        expect_count = (entry.size + C.MAX_CHUNK_PLAINTEXT - 1) \
            // C.MAX_CHUNK_PLAINTEXT
        if len(clist) != expect_count:
            raise AstboxError(E_INVALID_DATA_RECORD,
                              "chunk count %d != ceil(size/chunk) %d"
                              % (len(clist), expect_count))
        for i, c in enumerate(clist):
            if i < len(clist) - 1 and c.plaintext_length != C.MAX_CHUNK_PLAINTEXT:
                raise AstboxError(E_INVALID_DATA_RECORD,
                                  "non-final chunk is not 1048576 bytes")
        total = sum(c.plaintext_length for c in clist)
        if total != entry.size:
            raise AstboxError(E_INVALID_DATA_RECORD,
                              "sum of chunk plaintext %d != Size %d"
                              % (total, entry.size))
        first_abs = clist[0].record_offset
        region_len = sum(C.DATA_RECORD_OVERHEAD + c.plaintext_length
                         for c in clist)
        if first_abs != entry.data_start or region_len != entry.data_length:
            raise AstboxError(
                E_INVALID_DATA_RECORD,
                "metadata DataStart/DataLength do not match records")
        if first_abs + region_len > h.footer_offset:
            raise AstboxError(E_INVALID_DATA_RECORD,
                              "DataStart+DataLength exceeds FooterOffset")
    # every non-empty FILE must have records; every record belongs to one FILE
    for file_id, entry in entries.items():
        if entry.is_file and entry.size > 0:
            if file_id not in chunks:
                raise AstboxError(E_INVALID_DATA_RECORD,
                                  "missing Data Records for file %r"
                                  % entry.name)
    return chunks


# ---------------------------------------------------------------------------
# Unlock entry point
# ---------------------------------------------------------------------------

def _credential_bytes(slot, totp_value):
    """TOTP credential bytes: the exact decimal ASCII code (leading zeros
    significant), matching the slot's configured digit count."""
    digits = slot.credential_parameters
    s = str(totp_value).strip()
    if not s or not s.isdigit() or len(s) != digits:
        return None
    return s.encode("ascii")


def unlock_container(path, totp=None, raw=None, secret_b32=None):
    """Unlock a container with a TOTP code or a Base32 secret.

    TOTP is the sole credential type of ASTBOX v1.  Returns an
    UnlockedContainer with verified Header/Slot/Footer MACs and
    authenticated, validated metadata plus a structural index of Data
    Records (chunks are decrypted lazily on extraction).
    """
    return unlock_parsed(parse_container(path, raw), totp,
                         secret_b32=secret_b32)


def unlock_parsed(parsed, totp=None, secret_b32=None):
    """在已解析结构上尝试解锁(供多候选码复用, 避免重复整读大文件)。

    secret_b32: 直接以 Base32 密钥解码字节作为 KDF 凭据(新封装容器)。
                提供时忽略 totp。
    """
    header = parsed.header
    if secret_b32:
        norm = secret_b32.strip().upper().replace(" ", "")
        try:
            cred = base64.b32decode(norm + "=" * ((-len(norm)) % 8),
                                    casefold=True)
        except Exception:
            raise AstboxError(E_AUTHENTICATION_FAILED,
                              "invalid Base32 TOTP secret")
        last_error = None
        for slot in parsed.slots:
            try:
                unlock_key = derive_unlock_key(slot, cred)
                vault_key = _unwrap_vault_key(header, slot, unlock_key)
            except AstboxError as exc:
                last_error = exc
                continue
            return _finalize_unlock(parsed, slot, vault_key)
        raise AstboxError(E_AUTHENTICATION_FAILED,
                          "unlock failed: secret does not match "
                          "this container")
    if totp is None:
        raise AstboxError(E_NO_VALID_CREDENTIAL,
                          "a TOTP code is required to unlock")

    last_error = None
    for slot in parsed.slots:
        try:
            cred = _credential_bytes(slot, totp)
        except AstboxError as exc:
            last_error = exc
            continue
        if cred is None:
            continue
        try:
            unlock_key = derive_unlock_key(slot, cred)
            vault_key = _unwrap_vault_key(header, slot, unlock_key)
        except AstboxError as exc:
            last_error = exc
            continue
        return _finalize_unlock(parsed, slot, vault_key)
    if last_error is not None:
        raise AstboxError(E_AUTHENTICATION_FAILED,
                          "unlock failed: no valid TOTP code for this "
                          "container")
    raise AstboxError(E_AUTHENTICATION_FAILED,
                      "unlock failed: no matching TOTP code provided")


def _finalize_unlock(parsed, slot, vault_key):
    header = parsed.header
    keys = crypto.hkdf_derive(vault_key, header.vault_id)
    _verify_header_mac(parsed, keys["header"])
    _verify_slot_macs(parsed, keys["slotmac"])
    _verify_footer(parsed, keys["footer"])
    meta = _decrypt_metadata(parsed, keys["metadata"])
    entries, children = validate_metadata(meta)
    chunks = index_data(parsed, entries)
    return UnlockedContainer(
        parsed=parsed,
        vault_key=vault_key,
        keys=keys,
        metadata=meta,
        created=meta[4],
        modified=meta[5],
        entries=entries,
        children=children,
        chunks=chunks,
    )


# ---------------------------------------------------------------------------
# Reading / extraction
# ---------------------------------------------------------------------------

def data_associated_data(uc, chunk):
    h = uc.parsed.header
    return (C.LABEL_DATA
            + h.vault_id
            + struct.pack(">Q", h.generation)
            + chunk.file_id
            + struct.pack(">Q", chunk.chunk_index)
            + struct.pack(">I", chunk.plaintext_length))


def iter_file_plaintext(uc, entry):
    """Yield plaintext chunks of a file, authenticating each record."""
    if entry.is_dir:
        raise AstboxError(E_INVALID_ENTRY, "%r is a directory" % entry.name)
    for chunk in sorted(uc.chunks.get(entry.file_id, []),
                        key=lambda c: c.chunk_index):
        try:
            yield crypto.aead_decrypt(
                uc.keys["data"], chunk.nonce,
                chunk.ciphertext + chunk.tag, data_associated_data(uc, chunk))
        except AstboxError as exc:
            raise AstboxError(E_DATA_AEAD_FAILURE,
                              "data record authentication failed for %r: %s"
                              % (entry.name, exc.message))


def read_file(uc, entry):
    return b"".join(iter_file_plaintext(uc, entry))


def entry_path_parts(uc, entry):
    parts = [entry.name]
    cur = entry
    while cur.parent_id != C.ROOT_DIRECTORY_ID:
        parent = uc.entries[cur.parent_id]
        parts.append(parent.name)
        cur = parent
    return tuple(reversed(parts))


def root_entries(uc):
    return sorted(uc.children.get(C.ROOT_DIRECTORY_ID, []),
                  key=lambda e: e.name)


def walk_entries(uc, parent_id=C.ROOT_DIRECTORY_ID, prefix=""):
    """Yield (path, Entry) tuples in depth-first order."""
    for entry in sorted(uc.children.get(parent_id, []), key=lambda e: e.name):
        path = entry.name if not prefix else prefix + "/" + entry.name
        yield path, entry
        if entry.is_dir:
            yield from walk_entries(uc, entry.file_id, path)


def verify_full(uc):
    """Level-5 verification: authenticate every Data Record."""
    for file_id, entry in uc.entries.items():
        if entry.is_file and entry.size > 0:
            for _ in iter_file_plaintext(uc, entry):
                pass
