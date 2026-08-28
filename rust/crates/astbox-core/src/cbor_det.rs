// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
//! Deterministic (canonical) CBOR encode/decode for ASTBOX v1 metadata.
//! Port of Astbox.Core/CborDet.cs (ASTBOX-v1.0-03 §13-19):
//! RFC 8949 deterministic encoding restricted to unsigned ints, byte strings,
//! UTF-8 text, arrays and maps; floats/tags/indefinite lengths/non-minimal
//! integers/duplicate or out-of-canonical-order map keys are rejected.

use crate::errors::{AstboxError, E};
use crate::Result;

/// Decoded CBOR value model (UInt | Bytes | Text | Array | Map).
/// Map entries are kept in decoded (canonical) order.
#[derive(Debug, Clone, PartialEq)]
pub enum CborValue {
    UInt(u64),
    Bytes(Vec<u8>),
    Text(String),
    Array(Vec<CborValue>),
    Map(Vec<(CborValue, CborValue)>),
}

impl CborValue {
    pub fn uint(v: u64) -> CborValue {
        CborValue::UInt(v)
    }
    pub fn bytes(b: impl Into<Vec<u8>>) -> CborValue {
        CborValue::Bytes(b.into())
    }
    pub fn text(s: impl Into<String>) -> CborValue {
        CborValue::Text(s.into())
    }
    pub fn arr(items: Vec<CborValue>) -> CborValue {
        CborValue::Array(items)
    }
    /// Map from (uint key, value) pairs, port of CborValue.Map(params (ulong, CborValue)[]).
    pub fn map_u(pairs: &[(u64, CborValue)]) -> CborValue {
        CborValue::Map(
            pairs
                .iter()
                .map(|(k, v)| (CborValue::UInt(*k), v.clone()))
                .collect(),
        )
    }

    pub fn is_uint(&self) -> bool {
        matches!(self, CborValue::UInt(_))
    }
    pub fn is_bytes(&self) -> bool {
        matches!(self, CborValue::Bytes(_))
    }
    pub fn is_text(&self) -> bool {
        matches!(self, CborValue::Text(_))
    }
    pub fn is_array(&self) -> bool {
        matches!(self, CborValue::Array(_))
    }
    pub fn is_map(&self) -> bool {
        matches!(self, CborValue::Map(_))
    }

    pub fn as_uint(&self) -> u64 {
        match self {
            CborValue::UInt(v) => *v,
            _ => 0,
        }
    }
    pub fn as_bytes(&self) -> &[u8] {
        match self {
            CborValue::Bytes(b) => b,
            _ => &[],
        }
    }
    pub fn as_text(&self) -> &str {
        match self {
            CborValue::Text(s) => s,
            _ => "",
        }
    }
    pub fn items(&self) -> &[CborValue] {
        match self {
            CborValue::Array(v) => v,
            _ => &[],
        }
    }
    pub fn entries(&self) -> &[(CborValue, CborValue)] {
        match self {
            CborValue::Map(m) => m,
            _ => &[],
        }
    }
}

pub struct CborDet;

const MAX_DEPTH: usize = 64;

struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn remaining(&self) -> usize {
        self.data.len() - self.pos
    }

    fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        if self.pos + n > self.data.len() {
            return Err(AstboxError::new(E::InvalidCbor, "truncated CBOR item"));
        }
        let s = &self.data[self.pos..self.pos + n];
        self.pos += n;
        Ok(s)
    }
}

/// (major, additionalInfo, length)
fn read_head(r: &mut Reader) -> Result<(u8, u8, u64)> {
    if r.remaining() < 1 {
        return Err(AstboxError::new(E::InvalidCbor, "truncated CBOR item"));
    }
    let b0 = r.data[r.pos];
    r.pos += 1;
    let major = b0 >> 5;
    let ai = b0 & 0x1F;
    let length: u64 = match ai {
        0..=23 => ai as u64,
        24 => r.take(1)?[0] as u64,
        25 => {
            let b = r.take(2)?;
            u16::from_be_bytes([b[0], b[1]]) as u64
        }
        26 => {
            let b = r.take(4)?;
            u32::from_be_bytes([b[0], b[1], b[2], b[3]]) as u64
        }
        27 => {
            let b = r.take(8)?;
            u64::from_be_bytes([
                b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
            ])
        }
        _ => {
            return Err(AstboxError::new(
                E::InvalidCbor,
                "indefinite-length item forbidden",
            ))
        }
    };
    Ok((major, ai, length))
}

fn check_minimal(ai: u8, length: u64) -> Result<()> {
    // Reject non-minimal integer encodings (RFC 8949 4.2.1).
    if ai == 24 && length < 24 {
        return Err(AstboxError::new(E::NonCanonicalCbor, "non-minimal uint encoding"));
    }
    if ai == 25 && length < 0x100 {
        return Err(AstboxError::new(E::NonCanonicalCbor, "non-minimal uint encoding"));
    }
    if ai == 26 && length < 0x1_0000 {
        return Err(AstboxError::new(E::NonCanonicalCbor, "non-minimal uint encoding"));
    }
    if ai == 27 && length < 0x1_0000_0000 {
        return Err(AstboxError::new(E::NonCanonicalCbor, "non-minimal uint encoding"));
    }
    Ok(())
}

fn decode_item(r: &mut Reader, depth: usize) -> Result<CborValue> {
    if depth > MAX_DEPTH {
        return Err(AstboxError::new(E::InvalidCbor, "CBOR nesting too deep"));
    }
    if r.remaining() < 1 {
        return Err(AstboxError::new(E::InvalidCbor, "truncated CBOR item"));
    }
    let (major, ai, length) = read_head(r)?;

    if major == 0 {
        check_minimal(ai, length)?;
        return Ok(CborValue::UInt(length));
    }

    match major {
        1 => Err(AstboxError::new(
            E::InvalidCbor,
            "negative CBOR integer forbidden",
        )),

        2 => {
            if length > usize::MAX as u64 {
                return Err(AstboxError::new(E::InvalidCbor, "byte string too large"));
            }
            Ok(CborValue::Bytes(r.take(length as usize)?.to_vec()))
        }

        3 => {
            if length > usize::MAX as u64 {
                return Err(AstboxError::new(E::InvalidCbor, "text string too large"));
            }
            let raw = r.take(length as usize)?;
            let text = std::str::from_utf8(raw).map_err(|_| {
                AstboxError::new(E::InvalidCbor, "text string is not UTF-8")
            })?;
            Ok(CborValue::Text(text.to_string()))
        }

        4 => {
            if length > usize::MAX as u64 {
                return Err(AstboxError::new(E::InvalidCbor, "array too large"));
            }
            let n = length as usize;
            let mut arr = Vec::with_capacity(n.min(1024));
            for _ in 0..n {
                arr.push(decode_item(r, depth + 1)?);
            }
            Ok(CborValue::Array(arr))
        }

        5 => {
            if length > usize::MAX as u64 {
                return Err(AstboxError::new(E::InvalidCbor, "map too large"));
            }
            let n = length as usize;
            let mut result: Vec<(CborValue, CborValue)> = Vec::with_capacity(n.min(1024));
            let mut prev_encoded: Option<(usize, Vec<u8>)> = None;
            for _ in 0..n {
                let key_start = r.pos;
                let key = decode_item(r, depth + 1)?;
                let key_end = r.pos;
                let value = decode_item(r, depth + 1)?;
                if result.iter().any(|(k, _)| *k == key) {
                    return Err(AstboxError::new(
                        E::DuplicateCborKey,
                        format!("duplicate map key {}", cbor_debug(&key)),
                    ));
                }
                result.push((key, value));
                // canonical key order: keys sorted by (encoded length, bytes)
                let key_len = key_end - key_start;
                let key_bytes = r.data[key_start..key_end].to_vec();
                if let Some((prev_len, prev_bytes)) = &prev_encoded {
                    if key_len < *prev_len
                        || (key_len == *prev_len && key_bytes.as_slice() <= prev_bytes.as_slice())
                    {
                        return Err(AstboxError::new(
                            E::NonCanonicalCbor,
                            "map keys not in canonical order",
                        ));
                    }
                }
                prev_encoded = Some((key_len, key_bytes));
            }
            Ok(CborValue::Map(result))
        }

        // majors 6 (tags) and 7 (floats/specials) are forbidden
        _ => Err(AstboxError::new(
            E::InvalidCbor,
            format!("CBOR major type {} forbidden in ASTBOX metadata", major),
        )),
    }
}

/// Debug formatting mirroring CborValue.ToString() for error messages.
fn cbor_debug(v: &CborValue) -> String {
    match v {
        CborValue::UInt(u) => format!("uint({})", u),
        CborValue::Bytes(b) => format!("bytes[{}]", b.len()),
        CborValue::Text(s) => format!("text({})", s.chars().count()),
        CborValue::Array(a) => format!("array[{}]", a.len()),
        CborValue::Map(m) => format!("map[{}]", m.len()),
    }
}

fn encode_uint(value: u64) -> Vec<u8> {
    if value < 24 {
        vec![value as u8]
    } else if value < 0x100 {
        vec![0x18, value as u8]
    } else if value < 0x1_0000 {
        let mut b = vec![0x19];
        b.extend_from_slice(&(value as u16).to_be_bytes());
        b
    } else if value < 0x1_0000_0000 {
        let mut b = vec![0x1A];
        b.extend_from_slice(&(value as u32).to_be_bytes());
        b
    } else {
        let mut b = vec![0x1B];
        b.extend_from_slice(&value.to_be_bytes());
        b
    }
}

fn encode_head(major: u8, length: u64) -> Vec<u8> {
    let m = major << 5;
    if length < 24 {
        vec![(m | length as u8)]
    } else if length < 0x100 {
        vec![m | 24, length as u8]
    } else if length < 0x1_0000 {
        let mut b = vec![m | 25];
        b.extend_from_slice(&(length as u16).to_be_bytes());
        b
    } else if length < 0x1_0000_0000 {
        let mut b = vec![m | 26];
        b.extend_from_slice(&(length as u32).to_be_bytes());
        b
    } else {
        let mut b = vec![m | 27];
        b.extend_from_slice(&length.to_be_bytes());
        b
    }
}

fn encode_key(k: &CborValue) -> Result<Vec<u8>> {
    match k {
        CborValue::UInt(v) => Ok(encode_uint(*v)),
        _ => Err(AstboxError::new(E::InvalidCbor, "map keys must be integers")),
    }
}

fn append_item(acc: &mut Vec<u8>, obj: &CborValue) -> Result<()> {
    match obj {
        CborValue::UInt(v) => {
            acc.extend_from_slice(&encode_uint(*v));
        }

        CborValue::Bytes(b) => {
            acc.extend_from_slice(&encode_head(2, b.len() as u64));
            acc.extend_from_slice(b);
        }

        CborValue::Text(s) => {
            // metadata strings are NFC-normalized
            use unicode_normalization::UnicodeNormalization;
            let norm: String = s.nfc().collect();
            let data = norm.as_bytes();
            acc.extend_from_slice(&encode_head(3, data.len() as u64));
            acc.extend_from_slice(data);
        }

        CborValue::Array(items) => {
            acc.extend_from_slice(&encode_head(4, items.len() as u64));
            for item in items {
                append_item(acc, item)?;
            }
        }

        CborValue::Map(entries) => {
            let mut ordered: Vec<(&CborValue, &CborValue, Vec<u8>)> = entries
                .iter()
                .map(|(k, v)| Ok((k, v, encode_key(k)?)))
                .collect::<Result<Vec<_>>>()?;
            ordered.sort_by(|a, b| a.2.cmp(&b.2));
            acc.extend_from_slice(&encode_head(5, ordered.len() as u64));
            for (_, value, enc_key) in ordered {
                acc.extend_from_slice(&enc_key);
                append_item(acc, value)?;
            }
        }
    }
    Ok(())
}

impl CborDet {
    /// Strictly decode canonical CBOR; trailing bytes forbidden.
    pub fn loads(data: &[u8]) -> Result<CborValue> {
        let mut r = Reader { data, pos: 0 };
        let obj = decode_item(&mut r, 0)?;
        if r.remaining() != 0 {
            return Err(AstboxError::new(
                E::InvalidCbor,
                "trailing bytes after CBOR item",
            ));
        }
        Ok(obj)
    }

    /// Canonically encode an ASTBOX metadata object.
    pub fn dumps(obj: &CborValue) -> Result<Vec<u8>> {
        let mut acc = Vec::with_capacity(256);
        append_item(&mut acc, obj)?;
        Ok(acc)
    }
}
