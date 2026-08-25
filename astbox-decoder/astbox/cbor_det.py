# -*- coding: utf-8 -*-
# Copyright 2026 Astenyx-Git
# SPDX-License-Identifier: Apache-2.0
"""Deterministic (canonical) CBOR encode/decode for ASTBOX v1 metadata.

ASTBOX-v1.0-03-Data-Container.txt section 13-19 requires RFC 8949
deterministic encoding restricted to:
  - unsigned integers (major 0)
  - byte strings (major 2)
  - UTF-8 text strings (major 3)
  - arrays (major 4)
  - maps (major 5)
and prohibits floats, tags, indefinite lengths, non-minimal integers,
duplicate map keys and non-canonical key ordering.
"""
import struct
import unicodedata

from .errors import (
    AstboxError,
    E_INVALID_CBOR,
    E_NON_CANONICAL_CBOR,
    E_DUPLICATE_CBOR_KEY,
)

_MAX_HEAD = 8


class _Reader:
    __slots__ = ("data", "pos", "end")

    def __init__(self, data):
        self.data = data
        self.pos = 0
        self.end = len(data)

    def take(self, n):
        if self.pos + n > self.end:
            raise AstboxError(E_INVALID_CBOR, "truncated CBOR item")
        out = self.data[self.pos:self.pos + n]
        self.pos += n
        return out

    def remaining(self):
        return self.end - self.pos


def _read_head(r):
    """Read initial byte; return (major, additional_info, length)."""
    if r.remaining() < 1:
        raise AstboxError(E_INVALID_CBOR, "truncated CBOR item")
    b0 = r.data[r.pos]
    r.pos += 1
    major = b0 >> 5
    ai = b0 & 0x1F
    if ai < 24:
        return major, ai, ai
    if ai == 24:
        return major, ai, r.take(1)[0]
    if ai == 25:
        return major, ai, struct.unpack(">H", r.take(2))[0]
    if ai == 26:
        return major, ai, struct.unpack(">I", r.take(4))[0]
    if ai == 27:
        return major, ai, struct.unpack(">Q", r.take(8))[0]
    raise AstboxError(E_INVALID_CBOR, "indefinite-length item forbidden")


def _check_minimal(initial, ai, length):
    """Reject non-minimal integer encodings (RFC 8949 4.2.1)."""
    if ai == 24 and length < 24:
        raise AstboxError(E_NON_CANONICAL_CBOR, "non-minimal uint encoding")
    if ai == 25 and length < 0x100:
        raise AstboxError(E_NON_CANONICAL_CBOR, "non-minimal uint encoding")
    if ai == 26 and length < 0x10000:
        raise AstboxError(E_NON_CANONICAL_CBOR, "non-minimal uint encoding")
    if ai == 27 and length < 0x100000000:
        raise AstboxError(E_NON_CANONICAL_CBOR, "non-minimal uint encoding")


def _decode_item(r, depth):
    if depth > 64:
        raise AstboxError(E_INVALID_CBOR, "CBOR nesting too deep")
    if r.remaining() < 1:
        raise AstboxError(E_INVALID_CBOR, "truncated CBOR item")
    b0 = r.data[r.pos]
    major, ai, length = _read_head(r)

    if major == 0:  # unsigned integer
        _check_minimal(b0, ai, length)
        return length
    if major == 1:  # negative integer: not permitted by ASTBOX metadata
        raise AstboxError(E_INVALID_CBOR, "negative CBOR integer forbidden")
    if major == 2:  # byte string
        data = r.take(length)
        return data
    if major == 3:  # text string
        data = r.take(length)
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            raise AstboxError(E_INVALID_CBOR, "text string is not UTF-8")
        return text
    if major == 4:  # array
        arr = []
        for _ in range(length):
            arr.append(_decode_item(r, depth + 1))
        return arr
    if major == 5:  # map
        prev_encoded = None
        result = {}
        for _ in range(length):
            key_start = r.pos
            key = _decode_item(r, depth + 1)
            key_end = r.pos
            value = _decode_item(r, depth + 1)
            if key in result:
                raise AstboxError(E_DUPLICATE_CBOR_KEY,
                                  "duplicate map key %r" % (key,))
            result[key] = value
            # canonical key order: keys sorted by (encoded length, bytes)
            key_bytes = r.data[key_start:key_end]
            cmp_key = (key_end - key_start, key_bytes)
            if prev_encoded is not None and cmp_key <= prev_encoded:
                raise AstboxError(E_NON_CANONICAL_CBOR,
                                  "map keys not in canonical order")
            prev_encoded = cmp_key
        return result
    # majors 6 (tags) and 7 (floats/specials) are forbidden
    raise AstboxError(E_INVALID_CBOR,
                      "CBOR major type %d forbidden in ASTBOX metadata" % major)


def loads(data):
    """Strictly decode canonical CBOR; return Python object."""
    if not isinstance(data, (bytes, bytearray)):
        raise AstboxError(E_INVALID_CBOR, "CBOR input must be bytes")
    r = _Reader(bytes(data))
    obj = _decode_item(r, 0)
    if r.remaining() != 0:
        raise AstboxError(E_INVALID_CBOR,
                          "trailing bytes after CBOR item")
    return obj


# ---------------------------------------------------------------------------
# Canonical encoder (subset used by ASTBOX metadata)
# ---------------------------------------------------------------------------

def _encode_uint(value):
    if value < 0:
        raise AstboxError(E_INVALID_CBOR, "negative integer forbidden")
    if value < 24:
        return bytes([value])
    if value < 0x100:
        return bytes([0x18, value])
    if value < 0x10000:
        return b"\x19" + struct.pack(">H", value)
    if value < 0x100000000:
        return b"\x1a" + struct.pack(">I", value)
    if value < 1 << 64:
        return b"\x1b" + struct.pack(">Q", value)
    raise AstboxError(E_INVALID_CBOR, "integer too large")


def _encode_bytes(data):
    n = len(data)
    head = _encode_head(2, n)
    return head + data


def _encode_head(major, length):
    if length < 24:
        return bytes([(major << 5) | length])
    if length < 0x100:
        return bytes([(major << 5) | 24, length])
    if length < 0x10000:
        return bytes([(major << 5) | 25]) + struct.pack(">H", length)
    if length < 0x100000000:
        return bytes([(major << 5) | 26]) + struct.pack(">I", length)
    if length < 1 << 64:
        return bytes([(major << 5) | 27]) + struct.pack(">Q", length)
    raise AstboxError(E_INVALID_CBOR, "item too large")


def _encode_text(text):
    if not isinstance(text, str):
        raise AstboxError(E_INVALID_CBOR, "expected text string")
    # metadata strings are NFC-normalized
    data = unicodedata.normalize("NFC", text).encode("utf-8")
    return _encode_head(3, len(data)) + data


def _encode_array(items):
    return _encode_head(4, len(items)) + b"".join(_encode_item(i) for i in items)


def _encode_map(mapping):
    items = sorted(mapping.items(), key=lambda kv: _encode_uint(kv[0]))
    out = _encode_head(5, len(items))
    for k, v in items:
        if not isinstance(k, int):
            raise AstboxError(E_INVALID_CBOR, "map keys must be integers")
        out += _encode_uint(k) + _encode_item(v)
    return out


def _encode_item(obj):
    if isinstance(obj, bool):
        raise AstboxError(E_INVALID_CBOR, "boolean forbidden in ASTBOX CBOR")
    if isinstance(obj, int):
        return _encode_uint(obj)
    if isinstance(obj, bytes):
        return _encode_bytes(obj)
    if isinstance(obj, str):
        return _encode_text(obj)
    if isinstance(obj, (list, tuple)):
        return _encode_array(list(obj))
    if isinstance(obj, dict):
        return _encode_map(obj)
    if obj is None:
        raise AstboxError(E_INVALID_CBOR, "null forbidden in ASTBOX CBOR")
    raise AstboxError(E_INVALID_CBOR,
                      "unsupported CBOR value type %s" % type(obj).__name__)


def dumps(obj):
    """Canonically encode an ASTBOX metadata object."""
    return _encode_item(obj)
