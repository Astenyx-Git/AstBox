// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
//! ASTBOX v1.0 modification: add files to an unlocked container
//! (port of Astbox.Core/Modifier.cs; doc 03 §67/76/77/79-83).

use std::collections::HashMap;

use crate::bin::*;
use crate::cbor_det::CborValue;
use crate::constants::Constants;
use crate::container::{cmp_ordinal, Container, Entry, UnlockedContainer};
use crate::crypto::Crypto;
use crate::errors::{AstboxError, E};
use crate::rng::RandomSource;
use crate::Result;

#[derive(Debug, Clone)]
struct Node {
    id: Vec<u8>,
    parent: Vec<u8>,
    name: String,
    entry_type: u8,
    size: u64,
    data: Vec<u8>,
    modified: u64,
}

enum RecordFile {
    Old {
        file_id: Vec<u8>,
        #[allow(dead_code)] // parity with C# RecordFile.OldEntry (set, not read)
        entry: Entry,
        chunks: Vec<crate::container::DataChunk>,
    },
    New {
        file_id: Vec<u8>,
        node: Node,
    },
}

impl RecordFile {
    fn file_id(&self) -> &Vec<u8> {
        match self {
            RecordFile::Old { file_id, .. } => file_id,
            RecordFile::New { file_id, .. } => file_id,
        }
    }
}

fn validate_name(name: &str) -> Result<()> {
    if name.is_empty() {
        return Err(AstboxError::new(E::InvalidFileName, "empty entry name"));
    }
    if name == "." || name == ".." {
        return Err(AstboxError::new(
            E::InvalidFileName,
            "name '.'/'..' forbidden",
        ));
    }
    if name.contains('/') || name.contains('\\') || name.contains('\0') {
        return Err(AstboxError::new(
            E::InvalidFileName,
            "name contains path separator or NUL",
        ));
    }
    Ok(())
}

fn entry_cbor(
    file_id: &[u8],
    parent_id: &[u8],
    entry_type: u8,
    name: &str,
    size: u64,
    start: u64,
    length: u64,
    modified: u64,
    mode: u64,
) -> CborValue {
    use unicode_normalization::UnicodeNormalization;
    CborValue::Map(vec![
        (
            CborValue::UInt(Constants::ENTRY_KEY_FILE_ID),
            CborValue::Bytes(file_id.to_vec()),
        ),
        (
            CborValue::UInt(Constants::ENTRY_KEY_PARENT),
            CborValue::Bytes(parent_id.to_vec()),
        ),
        (
            CborValue::UInt(Constants::ENTRY_KEY_TYPE),
            CborValue::UInt(entry_type as u64),
        ),
        (
            CborValue::UInt(Constants::ENTRY_KEY_NAME),
            CborValue::Text(name.nfc().collect()),
        ),
        (
            CborValue::UInt(Constants::ENTRY_KEY_SIZE),
            CborValue::UInt(size),
        ),
        (
            CborValue::UInt(Constants::ENTRY_KEY_DATA_START),
            CborValue::UInt(start),
        ),
        (
            CborValue::UInt(Constants::ENTRY_KEY_DATA_LENGTH),
            CborValue::UInt(length),
        ),
        (CborValue::UInt(8), CborValue::UInt(modified)),
        (CborValue::UInt(9), CborValue::UInt(mode)),
    ])
}

pub struct Modifier;

impl Modifier {
    /// Add files ({logical_path: bytes}) to an unlocked container and write
    /// the new generation to out_path. Returns the re-opened
    /// UnlockedContainer (self-verified), or None without a TOTP code.
    pub fn add_files(
        uc: &UnlockedContainer,
        files: &[(String, Vec<u8>)],
        out_path: &str,
        totp: Option<&str>,
    ) -> Result<Option<UnlockedContainer>> {
        let mut rng = crate::rng::OsRandom;
        Self::add_files_with(&mut rng, uc, files, out_path, totp, None)
    }

    /// Byte-compat harness variant: explicit random source + timestamp.
    pub fn add_files_with(
        rng: &mut dyn RandomSource,
        uc: &UnlockedContainer,
        files: &[(String, Vec<u8>)],
        out_path: &str,
        totp: Option<&str>,
        now_override: Option<i64>,
    ) -> Result<Option<UnlockedContainer>> {
        if files.is_empty() {
            return Err(AstboxError::new(E::InvalidArgument, "no files to add"));
        }
        let header = &uc.parsed.header;

        let new_gen = header
            .generation
            .checked_add(1)
            .filter(|g| *g != 0)
            .ok_or_else(|| {
                AstboxError::new(
                    E::StaleGeneration,
                    "Generation is at the maximum representable value",
                )
            })?;

        let now = now_override.unwrap_or_else(crate::creator::now_unix) as u64;
        let mut used_ids: std::collections::HashSet<Vec<u8>> =
            uc.entries.keys().cloned().collect();
        used_ids.insert(Constants::ROOT_DIRECTORY_ID.to_vec());

        macro_rules! new_id {
            () => {{
                loop {
                    let fid = rng.bytes(16)?;
                    if fid.as_slice() != Constants::ROOT_DIRECTORY_ID.as_slice()
                        && used_ids.insert(fid.clone())
                    {
                        break fid;
                    }
                }
            }};
        }

        // --- existing logical path map ------------------------------------
        let mut existing_paths: HashMap<String, &Entry> = HashMap::new();
        for e in uc.entries.values() {
            existing_paths.insert(Container::entry_path_parts(uc, e).join("/"), e);
        }

        // --- plan new nodes -------------------------------------------------
        let mut new_nodes: HashMap<String, Node> = HashMap::new();
        let mut node_order: Vec<String> = Vec::new();
        let mut file_order: Vec<String> = Vec::new();

        // EnsureDir implemented as a closure-free recursive fn over the maps
        fn ensure_dir(
            dpath: &str,
            now: u64,
            existing_paths: &HashMap<String, &Entry>,
            new_nodes: &mut HashMap<String, Node>,
            node_order: &mut Vec<String>,
            new_id: &mut dyn FnMut() -> Result<Vec<u8>>,
        ) -> Result<Vec<u8>> {
            if dpath.is_empty() {
                return Ok(Constants::ROOT_DIRECTORY_ID.to_vec());
            }
            if let Some(ee) = existing_paths.get(dpath) {
                if !ee.is_dir() {
                    return Err(crate::err!(E::InvalidFileName, "'{}' is not a directory", dpath));
                }
                return Ok(ee.file_id.clone());
            }
            if let Some(nn) = new_nodes.get(dpath) {
                if nn.entry_type != Constants::TYPE_DIRECTORY {
                    return Err(crate::err!(E::InvalidFileName, "'{}' is not a directory", dpath));
                }
                return Ok(nn.id.clone());
            }
            let parts: Vec<&str> = dpath.split('/').collect();
            let parent = ensure_dir(
                &parts[..parts.len() - 1].join("/"),
                now,
                existing_paths,
                new_nodes,
                node_order,
                new_id,
            )?;
            validate_name(parts[parts.len() - 1])?;
            let node = Node {
                id: new_id()?,
                parent,
                name: parts[parts.len() - 1].to_string(),
                entry_type: Constants::TYPE_DIRECTORY,
                size: 0,
                data: Vec::new(),
                modified: now,
            };
            let id = node.id.clone();
            if !node_order.contains(&dpath.to_string()) {
                node_order.push(dpath.to_string());
            }
            new_nodes.insert(dpath.to_string(), node);
            Ok(id)
        }

        for (path, data) in files {
            let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
            if parts.is_empty() {
                return Err(crate::err!(E::InvalidArgument, "empty path '{}'", path));
            }
            let mut new_nodes_ref = &mut new_nodes;
            let mut node_order_ref = &mut node_order;
            let mut nid = || -> Result<Vec<u8>> {
                loop {
                    let fid = rng.bytes(16)?;
                    if fid.as_slice() != Constants::ROOT_DIRECTORY_ID.as_slice()
                        && used_ids.insert(fid.clone())
                    {
                        break Ok(fid);
                    }
                }
            };
            let parent_id = ensure_dir(
                &parts[..parts.len() - 1].join("/"),
                now,
                &existing_paths,
                &mut new_nodes_ref,
                &mut node_order_ref,
                &mut nid,
            )?;
            let full = parts.join("/");
            if existing_paths.contains_key(&full) {
                return Err(crate::err!(
                    E::AlreadyExists,
                    "'{}' already exists in the container",
                    full
                ));
            }
            if new_nodes.contains_key(&full) {
                return Err(crate::err!(E::AlreadyExists, "duplicate path '{}'", full));
            }
            validate_name(parts[parts.len() - 1])?;
            if !node_order.contains(&full) {
                node_order.push(full.clone());
            }
            new_nodes.insert(
                full.clone(),
                Node {
                    id: new_id!(),
                    parent: parent_id,
                    name: parts[parts.len() - 1].to_string(),
                    entry_type: Constants::TYPE_FILE,
                    size: data.len() as u64,
                    data: data.clone(),
                    modified: now,
                },
            );
            file_order.push(full);
        }

        // --- record-bearing files ------------------------------------------
        let mut record_files: Vec<RecordFile> = Vec::new();
        for e in uc.entries.values() {
            if e.is_file() && e.size > 0 {
                record_files.push(RecordFile::Old {
                    file_id: e.file_id.clone(),
                    entry: e.clone(),
                    chunks: uc.chunks[&e.file_id].clone(),
                });
            }
        }
        for path in &file_order {
            let node = &new_nodes[path];
            if node.size > 0 {
                record_files.push(RecordFile::New {
                    file_id: node.id.clone(),
                    node: node.clone(),
                });
            }
        }
        record_files.sort_by(|a, b| a.file_id().cmp(b.file_id()));

        let meta_offset = header.metadata_offset; // unchanged (slots fixed)

        // BuildMetadata as a local closure over record_files / uc / new_nodes
        let build_metadata = |data_offset: u64| -> Result<(Vec<u8>, HashMap<Vec<u8>, (u64, u64)>)> {
            let mut layout: HashMap<Vec<u8>, (u64, u64)> = HashMap::new();
            let mut pos: u64 = 0;
            for rf in &record_files {
                let length: u64 = match rf {
                    RecordFile::Old { chunks, .. } => chunks
                        .iter()
                        .map(|c| Constants::DATA_RECORD_OVERHEAD + c.plaintext_length as u64)
                        .sum(),
                    RecordFile::New { node, .. } => {
                        let mut length = 0u64;
                        let mut off = 0u64;
                        while off < node.size {
                            length += Constants::DATA_RECORD_OVERHEAD
                                + (Constants::MAX_CHUNK_PLAINTEXT as u64)
                                    .min(node.size - off);
                            off += Constants::MAX_CHUNK_PLAINTEXT as u64;
                        }
                        length
                    }
                };
                layout.insert(rf.file_id().clone(), (data_offset + pos, length));
                pos += length;
            }

            let mut entry_list: Vec<CborValue> = Vec::new();
            let mut old_sorted: Vec<&Entry> = uc.entries.values().collect();
            old_sorted.sort_by(|a, b| a.file_id.cmp(&b.file_id));
            for e in old_sorted {
                let (s, l) = layout.get(&e.file_id).copied().unwrap_or((0, 0));
                entry_list.push(entry_cbor(
                    &e.file_id,
                    &e.parent_id,
                    e.entry_type,
                    &e.name,
                    e.size,
                    s,
                    l,
                    e.modified,
                    e.file_mode,
                ));
            }
            let mut new_sorted: Vec<(&String, &Node)> = new_nodes.iter().collect();
            new_sorted.sort_by(|a, b| {
                let (da, oa) = (
                    a.0.matches('/').count(),
                    a.0.to_string(),
                );
                let (db, ob) = (
                    b.0.matches('/').count(),
                    b.0.to_string(),
                );
                da.cmp(&db).then_with(|| cmp_ordinal(&oa, &ob))
            });
            for (_, node) in new_sorted {
                let (s, l) = layout.get(&node.id).copied().unwrap_or((0, 0));
                entry_list.push(entry_cbor(
                    &node.id,
                    &node.parent,
                    node.entry_type,
                    &node.name,
                    node.size,
                    s,
                    l,
                    if node.modified != 0 { node.modified } else { now },
                    0,
                ));
            }
            let meta = CborValue::Map(vec![
                (
                    CborValue::UInt(Constants::META_KEY_VERSION),
                    CborValue::UInt(1),
                ),
                (
                    CborValue::UInt(Constants::META_KEY_ROOT),
                    CborValue::Bytes(Constants::ROOT_DIRECTORY_ID.to_vec()),
                ),
                (
                    CborValue::UInt(Constants::META_KEY_ENTRIES),
                    CborValue::Array(entry_list),
                ),
                (
                    CborValue::UInt(Constants::META_KEY_CREATED),
                    CborValue::UInt(uc.created),
                ),
                (
                    CborValue::UInt(Constants::META_KEY_MODIFIED),
                    CborValue::UInt(now),
                ),
            ]);
            Ok((crate::cbor_det::CborDet::dumps(&meta)?, layout))
        };

        // --- iterative layout -----------------------------------------------
        let mut data_offset_iter: Option<u64> = None;
        let mut converged = false;
        for _attempt in 0..8 {
            let (probe, _) = build_metadata(data_offset_iter.unwrap_or(0))?;
            let meta_length = probe.len() as u64 + 24 + 16;
            let candidate = meta_offset + meta_length;
            if let Some(existing) = data_offset_iter {
                if candidate == existing {
                    converged = true;
                    break;
                }
            }
            data_offset_iter = Some(candidate);
        }
        if !converged {
            return Err(AstboxError::new(
                E::InvalidArgument,
                "layout did not converge",
            ));
        }
        let data_offset = data_offset_iter.unwrap();

        // --- assemble the new Data region -------------------------------------
        let mut new_region: Vec<u8> = Vec::new();
        let keys = &uc.keys;
        let vault_id = &header.vault_id;
        let old_gen = header.generation;

        macro_rules! data_ad {
            ($gen:expr, $fid:expr, $cidx:expr, $plen:expr) => {{
                let mut ad = Vec::with_capacity(Constants::LABEL_DATA.len() + 16 + 8 + 16 + 8 + 4);
                ad.extend_from_slice(Constants::LABEL_DATA);
                ad.extend_from_slice(vault_id);
                ad.extend_from_slice(&($gen).to_be_bytes());
                ad.extend_from_slice(&($fid));
                ad.extend_from_slice(&($cidx).to_be_bytes());
                ad.extend_from_slice(&($plen).to_be_bytes());
                ad
            }};
        }

        for rf in &record_files {
            match rf {
                RecordFile::Old { file_id, chunks, .. } => {
                    let mut ordered: Vec<&crate::container::DataChunk> = chunks.iter().collect();
                    ordered.sort_by_key(|c| c.chunk_index);
                    for c in ordered {
                        let mut ct_tag =
                            Vec::with_capacity(c.ciphertext.len() + c.tag.len());
                        ct_tag.extend_from_slice(&c.ciphertext);
                        ct_tag.extend_from_slice(&c.tag);
                        let plain = Crypto::aead_decrypt(
                            &keys.data,
                            &c.nonce,
                            &ct_tag,
                            &data_ad!(old_gen, file_id.as_slice(), c.chunk_index, c.plaintext_length),
                        )?;
                        let nonce = rng.bytes(24)?;
                        let ct2 = Crypto::aead_encrypt(
                            &keys.data,
                            &nonce,
                            &plain,
                            &data_ad!(new_gen, file_id.as_slice(), c.chunk_index, c.plaintext_length),
                        )?;
                        new_region.extend_from_slice(file_id);
                        new_region.extend_from_slice(&c.chunk_index.to_be_bytes());
                        new_region.extend_from_slice(&c.plaintext_length.to_be_bytes());
                        new_region.extend_from_slice(&nonce);
                        new_region.extend_from_slice(&ct2);
                    }
                }
                RecordFile::New { file_id, node } => {
                    let data = &node.data;
                    let mut cidx: u64 = 0;
                    let mut idx = 0usize;
                    while idx < data.len() {
                        let chunk_len = Constants::MAX_CHUNK_PLAINTEXT.min(data.len() - idx);
                        let chunk = &data[idx..idx + chunk_len];
                        let nonce = rng.bytes(24)?;
                        let ct = Crypto::aead_encrypt(
                            &keys.data,
                            &nonce,
                            chunk,
                            &data_ad!(new_gen, file_id.as_slice(), cidx, chunk_len as u32),
                        )?;
                        new_region.extend_from_slice(file_id);
                        new_region.extend_from_slice(&cidx.to_be_bytes());
                        new_region.extend_from_slice(&(chunk_len as u32).to_be_bytes());
                        new_region.extend_from_slice(&nonce);
                        new_region.extend_from_slice(&ct);
                        idx += Constants::MAX_CHUNK_PLAINTEXT;
                        cidx += 1;
                    }
                }
            }
        }

        let data_length = new_region.len() as u64;
        let footer_offset = data_offset + data_length;

        // --- metadata record ---------------------------------------------------
        let (meta_cbor_final, _) = build_metadata(data_offset)?;
        let meta_nonce = rng.bytes(24)?;
        let mut meta_ad = Vec::with_capacity(Constants::LABEL_METADATA.len() + 16 + 8);
        meta_ad.extend_from_slice(Constants::LABEL_METADATA);
        meta_ad.extend_from_slice(vault_id);
        meta_ad.extend_from_slice(&new_gen.to_be_bytes());
        let meta_ct = Crypto::aead_encrypt(&keys.metadata, &meta_nonce, &meta_cbor_final, &meta_ad)?;
        let mut metadata_record = Vec::with_capacity(24 + meta_ct.len());
        metadata_record.extend_from_slice(&meta_nonce);
        metadata_record.extend_from_slice(&meta_ct);

        // --- footer --------------------------------------------------------------
        let mut footer = vec![0u8; Constants::FOOTER_SIZE as usize];
        footer[..8].copy_from_slice(Constants::FOOTER_MAGIC);
        u16_be_write(&mut footer, 8, Constants::VERSION);
        u16_be_write(&mut footer, 10, 0);
        u64_be_write(&mut footer, 12, new_gen);
        u64_be_write(&mut footer, 20, footer_offset + Constants::FOOTER_SIZE);
        footer[28..44].copy_from_slice(&Crypto::sha256_first16(&metadata_record));
        footer[44..60].copy_from_slice(&Crypto::sha256_first16(&new_region));
        let mut footer_without_mac = vec![0u8; 112];
        footer_without_mac[..60].copy_from_slice(&footer[..60]);
        footer_without_mac[76..112].copy_from_slice(&footer[76..112]);
        let mut f_mac_input = Vec::with_capacity(Constants::LABEL_FOOTER_MAC.len() + 112);
        f_mac_input.extend_from_slice(Constants::LABEL_FOOTER_MAC);
        f_mac_input.extend_from_slice(&footer_without_mac);
        let mac = Crypto::hmac_sha256_trunc16(&keys.footer, &f_mac_input)?;
        footer[60..76].copy_from_slice(&mac);

        // --- header (slots byte-identical to the original) -----------------------
        let slot_region_start = header.key_slot_offset as usize;
        let slot_region_len = (header.metadata_offset - header.key_slot_offset) as usize;
        let slot_bytes = uc.parsed.raw[slot_region_start..slot_region_start + slot_region_len].to_vec();

        let mut header_blob = vec![0u8; Constants::HEADER_SIZE as usize];
        header_blob[..6].copy_from_slice(Constants::HEADER_MAGIC);
        u16_be_write(&mut header_blob, 6, Constants::VERSION);
        u32_be_write(&mut header_blob, 8, 0);
        header_blob[12..28].copy_from_slice(vault_id);
        u64_be_write(&mut header_blob, 28, new_gen);
        u64_be_write(&mut header_blob, 36, Constants::HEADER_SIZE);
        u64_be_write(&mut header_blob, 44, slot_region_len as u64);
        u64_be_write(&mut header_blob, 52, meta_offset);
        u64_be_write(&mut header_blob, 60, metadata_record.len() as u64);
        u64_be_write(&mut header_blob, 68, data_offset);
        u64_be_write(&mut header_blob, 76, data_length);
        u64_be_write(&mut header_blob, 84, footer_offset);
        u64_be_write(&mut header_blob, 92, Constants::FOOTER_SIZE);
        u32_be_write(&mut header_blob, 100, header.key_slot_count);
        u32_be_write(&mut header_blob, 104, Constants::HEADER_SIZE as u32);
        let mut h_without_mac = vec![0u8; 128];
        h_without_mac[..108].copy_from_slice(&header_blob[..108]);
        h_without_mac[124..128].copy_from_slice(&header_blob[124..128]);
        let mut h_mac_input = Vec::with_capacity(Constants::LABEL_HEADER_MAC.len() + 128);
        h_mac_input.extend_from_slice(Constants::LABEL_HEADER_MAC);
        h_mac_input.extend_from_slice(&h_without_mac);
        let mac = Crypto::hmac_sha256_trunc16(&keys.header, &h_mac_input)?;
        header_blob[108..124].copy_from_slice(&mac);

        // --- atomic commit ---------------------------------------------------------
        let tmp_path = format!("{}.tmp", out_path);
        let commit = || -> Result<()> {
            use std::io::Write;
            let f = std::fs::File::create(&tmp_path)
                .map_err(|e| crate::err!(E::Io, "cannot commit {}: {}", out_path, e))?;
            let mut w = std::io::BufWriter::new(f);
            w.write_all(&header_blob)
                .and_then(|_| w.write_all(&slot_bytes))
                .and_then(|_| w.write_all(&metadata_record))
                .and_then(|_| w.write_all(&new_region))
                .and_then(|_| w.write_all(&footer))
                .and_then(|_| w.flush())
                .map_err(|e| crate::err!(E::Io, "cannot commit {}: {}", out_path, e))?;
            w.into_inner()
                .map_err(|e| crate::err!(E::Io, "cannot commit {}: {}", out_path, e))?
                .sync_all()
                .map_err(|e| crate::err!(E::Io, "cannot commit {}: {}", out_path, e))?;
            std::fs::rename(&tmp_path, out_path).map_err(|e| {
                let _ = std::fs::remove_file(&tmp_path);
                crate::err!(E::Io, "cannot commit {}: {}", out_path, e)
            })
        };
        if let Err(e) = commit() {
            let _ = std::fs::remove_file(&tmp_path);
            return Err(e);
        }

        // --- self-verification --------------------------------------------------------
        if let Some(t) = totp {
            return Ok(Some(Container::unlock_container(out_path, Some(t), None, None)?));
        }
        Container::parse_container(out_path, None)?; // structural sanity check
        Ok(None)
    }
}
