// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
//! ASTBOX v1.0 container writer (port of Astbox.Core/Creator.cs).
//! Fresh VaultID/VaultKey/salts/nonces, canonical CBOR metadata, chunked
//! encrypted Data Records ordered by FileID then ChunkIndex, footer digests
//! and MACs, header MAC last, Generation 0.
//!
//! Randomness goes through `RandomSource`: public functions use OS randomness
//! exactly like the C# original; the `*_with` variants exist solely for the
//! byte-compat harness to replay C# entropy.

use std::collections::HashSet;

use crate::bin::*;
use crate::cbor_det::CborValue;
use crate::constants::Constants;
use crate::container::{cmp_ordinal, Container, UnlockedContainer};
use crate::crypto::Crypto;
use crate::errors::{AstboxError, E};
use crate::rng::RandomSource;
use crate::Result;

/// Internal node used while building the entry tree.
#[derive(Debug, Clone)]
pub struct Node {
    pub id: Vec<u8>,
    pub parent: Vec<u8>,
    pub name: String,
    pub entry_type: u8,
    pub size: u64,
    pub data: Option<Vec<u8>>,
    pub data_start: u64,
    pub data_length: u64,
    pub modified: u64,
}

struct SlotData {
    slot_id: Vec<u8>,
    credential_type: u16,
    credential_parameters: u8,
    kdf_profile: u16,
    mem_kib: u32,
    time: u32,
    par: u32,
    salt: Vec<u8>,
    wrap_nonce: Vec<u8>,
    wrapped: Vec<u8>,
}

fn validate_path_entry(name: &str) -> Result<()> {
    if name.is_empty() || name == "." || name == ".." {
        return Err(crate::err!(E::InvalidFileName, "bad entry name '{}'", name));
    }
    if name.contains('/') || name.contains('\\') || name.contains('\0') {
        return Err(AstboxError::new(
            E::InvalidFileName,
            "entry name must not contain separators",
        ));
    }
    Ok(())
}

/// Order used for directory creation: by depth, then ordinal
/// (C# OrderBy(p => slash count).ThenBy(ordinal), stable).
fn dir_sort_key(p: &str) -> (usize, String) {
    (p.matches('/').count(), p.to_string())
}

pub struct Creator;

impl Creator {
    /// Turn {logical_path: bytes} into a nested structure with FileIDs.
    /// Returns (entries in insertion order, fileOrder).
    pub fn build_entry_map(
        rng: &mut dyn RandomSource,
        files: &[(String, Vec<u8>)],
    ) -> Result<(Vec<Node>, Vec<String>)> {
        let root_id = Constants::ROOT_DIRECTORY_ID.as_slice();
        // nodes: HashMap for lookup + ordered keys replicating C# Dictionary
        // insertion order (first-insert position preserved on overwrite).
        let mut nodes: std::collections::HashMap<String, Node> = std::collections::HashMap::new();
        let mut node_order: Vec<String> = Vec::new();
        let mut dirs: Vec<String> = vec![String::new()];
        let mut used_ids: HashSet<Vec<u8>> = HashSet::new();

        macro_rules! new_id {
            () => {{
                loop {
                    let fid = rng.bytes(16)?;
                    if fid.as_slice() != root_id && used_ids.insert(fid.clone()) {
                        break fid;
                    }
                }
            }};
        }

        for (path, _) in files {
            let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
            if parts.is_empty() {
                return Err(crate::err!(E::InvalidArgument, "empty path '{}'", path));
            }
            for i in 0..parts.len() - 1 {
                let dpath = parts[..i + 1].join("/");
                validate_path_entry(parts[i])?;
                if !dirs.contains(&dpath) {
                    dirs.push(dpath);
                }
            }
            validate_path_entry(parts[parts.len() - 1])?;
        }

        // create directory nodes first (parents before children)
        let mut sorted_dirs = dirs.clone();
        sorted_dirs.sort_by(|a, b| {
            let (da, oa) = dir_sort_key(a);
            let (db, ob) = dir_sort_key(b);
            da.cmp(&db).then_with(|| cmp_ordinal(&oa, &ob))
        });
        for dpath in sorted_dirs {
            if dpath.is_empty() {
                continue;
            }
            let parts: Vec<&str> = dpath.split('/').collect();
            let parent = if parts.len() > 1 {
                nodes[&parts[..parts.len() - 1].join("/")].id.clone()
            } else {
                root_id.to_vec()
            };
            if !node_order.contains(&dpath) {
                node_order.push(dpath.clone());
            }
            nodes.insert(
                dpath.clone(),
                Node {
                    id: new_id!(),
                    parent,
                    name: parts[parts.len() - 1].to_string(),
                    entry_type: Constants::TYPE_DIRECTORY,
                    size: 0,
                    data: None,
                    data_start: 0,
                    data_length: 0,
                    modified: 0,
                },
            );
        }

        let mut file_order = Vec::new();
        for (path, data) in files {
            let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
            let parent = if parts.len() > 1 {
                let dpath = parts[..parts.len() - 1].join("/");
                let dn = nodes.get(&dpath).ok_or_else(|| {
                    crate::err!(E::InvalidArgument, "parent '{}' missing", dpath)
                })?;
                dn.id.clone()
            } else {
                root_id.to_vec()
            };
            if nodes.contains_key(path) {
                return Err(crate::err!(
                    E::InvalidArgument,
                    "path '{}' is both file and directory",
                    path
                ));
            }
            let fid = new_id!();
            if !node_order.contains(path) {
                node_order.push(path.clone());
            }
            nodes.insert(
                path.clone(),
                Node {
                    id: fid,
                    parent,
                    name: parts[parts.len() - 1].to_string(),
                    entry_type: Constants::TYPE_FILE,
                    size: data.len() as u64,
                    data: Some(data.clone()),
                    data_start: 0,
                    data_length: 0,
                    modified: 0,
                },
            );
            file_order.push(path.clone());
        }

        let entries: Vec<Node> = node_order
            .iter()
            .map(|k| nodes[k].clone())
            .collect();
        Ok((entries, file_order))
    }

    pub fn build_metadata_cbor(
        entries: &[Node],
        created: Option<i64>,
        modified: Option<i64>,
    ) -> Result<Vec<u8>> {
        let now = created.unwrap_or_else(now_unix);
        let m = modified.unwrap_or(now);

        use unicode_normalization::UnicodeNormalization;
        let mut entry_list = Vec::with_capacity(entries.len());
        for node in entries {
            entry_list.push(CborValue::Map(vec![
                (
                    CborValue::UInt(Constants::ENTRY_KEY_FILE_ID),
                    CborValue::Bytes(node.id.clone()),
                ),
                (
                    CborValue::UInt(Constants::ENTRY_KEY_PARENT),
                    CborValue::Bytes(node.parent.clone()),
                ),
                (
                    CborValue::UInt(Constants::ENTRY_KEY_TYPE),
                    CborValue::UInt(node.entry_type as u64),
                ),
                (
                    CborValue::UInt(Constants::ENTRY_KEY_NAME),
                    CborValue::Text(node.name.nfc().collect::<String>()),
                ),
                (
                    CborValue::UInt(Constants::ENTRY_KEY_SIZE),
                    CborValue::UInt(node.size),
                ),
                (
                    CborValue::UInt(Constants::ENTRY_KEY_DATA_START),
                    CborValue::UInt(node.data_start),
                ),
                (
                    CborValue::UInt(Constants::ENTRY_KEY_DATA_LENGTH),
                    CborValue::UInt(node.data_length),
                ),
                (
                    CborValue::UInt(Constants::ENTRY_KEY_MODIFIED),
                    CborValue::UInt(if node.modified != 0 {
                        node.modified
                    } else {
                        m as u64
                    }),
                ),
                (
                    CborValue::UInt(Constants::ENTRY_KEY_MODE),
                    CborValue::UInt(0),
                ),
            ]));
        }

        crate::cbor_det::CborDet::dumps(&CborValue::Map(vec![
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
                CborValue::UInt(now as u64),
            ),
            (
                CborValue::UInt(Constants::META_KEY_MODIFIED),
                CborValue::UInt(m as u64),
            ),
        ]))
    }

    fn make_slot(
        rng: &mut dyn RandomSource,
        credential_type: u16,
        credential_parameters: u8,
        credential_bytes: &[u8],
        vault_id: &[u8],
        vault_key: &[u8],
        kdf_profile: u16,
    ) -> Result<SlotData> {
        let slot_id = rng.bytes(16)?;
        let salt = rng.bytes(32)?;
        let wrap_nonce = rng.bytes(24)?;
        let (mem_kib, t, p) = Constants::argon2_profile(kdf_profile)?;
        let arg_input = Crypto::build_argon2_input(credential_type, credential_parameters, credential_bytes);
        let unlock_key = Crypto::argon2id_raw(&arg_input, &salt, mem_kib, t, p, 32)?;

        let mut ad = Vec::with_capacity(160);
        ad.extend_from_slice(Constants::LABEL_WRAP);
        ad.extend_from_slice(vault_id);
        ad.extend_from_slice(&slot_id);
        ad.extend_from_slice(&credential_type.to_be_bytes());
        ad.push(credential_parameters);
        ad.extend_from_slice(&kdf_profile.to_be_bytes());
        ad.extend_from_slice(&mem_kib.to_be_bytes());
        ad.extend_from_slice(&t.to_be_bytes());
        ad.extend_from_slice(&p.to_be_bytes());
        ad.extend_from_slice(&salt);
        ad.extend_from_slice(&wrap_nonce);

        let wrapped = Crypto::aead_encrypt(&unlock_key, &wrap_nonce, vault_key, &ad)?;
        Ok(SlotData {
            slot_id,
            credential_type,
            credential_parameters,
            kdf_profile,
            mem_kib,
            time: t,
            par: p,
            salt,
            wrap_nonce,
            wrapped,
        })
    }

    /// Create an ASTBOX v1 container at `path`.
    /// TOTP is the sole credential type: prefer a Base32 secret (stable,
    /// high-entropy KDF credential usable at any time/device); a raw
    /// totpCode is accepted for compatibility (legacy behavior).
    pub fn create_container(path: &str, params: &CreateParams) -> Result<UnlockedContainer> {
        let mut rng = crate::rng::OsRandom;
        Self::create_container_with(&mut rng, path, params)
    }

    /// Byte-compat harness variant: explicit random source.
    pub fn create_container_with(
        rng: &mut dyn RandomSource,
        path: &str,
        params: &CreateParams,
    ) -> Result<UnlockedContainer> {
        let mut file_list: Vec<(String, Vec<u8>)> = params.files.clone();
        if let Some(seed_dir) = &params.seed_dir {
            // C# enumerates Directory.EnumerateFiles(AllDirectories) with no
            // guaranteed order; we sort by relative path for determinism.
            let mut collected: Vec<(String, Vec<u8>)> = Vec::new();
            collect_files_recursive(seed_dir, seed_dir, &mut collected)?;
            collected.sort_by(|a, b| cmp_ordinal(&a.0, &b.0));
            file_list.extend(collected);
        }
        if params.totp_secret.is_none() && params.totp_code.is_none() {
            return Err(AstboxError::new(
                E::InvalidArgument,
                "a TOTP secret or code is required (sole credential type)",
            ));
        }

        let vault_id = rng.bytes(16)?;
        let vault_key = rng.bytes(32)?;

        let cred_bytes: Vec<u8>;
        if let Some(secret) = params.totp_secret {
            cred_bytes = match Crypto::base32_decode(secret) {
                Ok(c) => c,
                Err(_) => {
                    return Err(AstboxError::new(
                        E::InvalidArgument,
                        "invalid Base32 TOTP secret",
                    ))
                }
            };
            if cred_bytes.len() < 10 {
                return Err(AstboxError::new(E::InvalidArgument, "TOTP secret too short"));
            }
        } else {
            let code = params.totp_code.unwrap().trim().to_string();
            if code.len() != params.totp_digits as usize
                || !code.chars().all(|c| c.is_ascii_digit())
            {
                return Err(crate::err!(
                    E::InvalidArgument,
                    "TOTP code must be {} digits",
                    params.totp_digits
                ));
            }
            cred_bytes = code.into_bytes();
        }

        let slots = vec![Self::make_slot(
            rng,
            Constants::CRED_TYPE_TOTP,
            params.totp_digits,
            &cred_bytes,
            &vault_id,
            &vault_key,
            params.kdf_profile,
        )?];

        let (mut entries, _) = Self::build_entry_map(rng, &file_list)?;
        let now = params.created.unwrap_or_else(now_unix);
        let m = params.modified.unwrap_or(now);
        for node in &mut entries {
            node.modified = m as u64;
        }

        let keys = Crypto::hkdf_derive(&vault_key, &vault_id)?;

        // ---- data region (iterative layout) ----
        let key_slot_length = slots.len() as u64 * Constants::KEY_SLOT_SIZE;
        let metadata_offset = Constants::HEADER_SIZE + key_slot_length;
        let mut data_offset: Option<u64> = None;
        for _attempt in 0..8 {
            let meta_cbor_probe = Self::build_metadata_cbor(&entries, Some(now), Some(m))?;
            let metadata_length = meta_cbor_probe.len() as u64 + 24 + 16;
            let candidate_data_offset = metadata_offset + metadata_length;
            if let Some(existing) = data_offset {
                if candidate_data_offset == existing {
                    break;
                }
            }
            data_offset = Some(candidate_data_offset);
            let mut pos: u64 = 0;
            let mut file_nodes: Vec<&mut Node> = entries
                .iter_mut()
                .filter(|n| n.entry_type == Constants::TYPE_FILE)
                .collect();
            file_nodes.sort_by(|a, b| a.id.cmp(&b.id));
            for node in file_nodes {
                if node.size == 0 {
                    node.data_start = 0;
                    node.data_length = 0;
                    continue;
                }
                node.data_start = candidate_data_offset + pos;
                let n_chunks =
                    (node.size + Constants::MAX_CHUNK_PLAINTEXT as u64 - 1)
                        / Constants::MAX_CHUNK_PLAINTEXT as u64;
                let mut total: u64 = 0;
                for i in 0..n_chunks {
                    let plain_len = (Constants::MAX_CHUNK_PLAINTEXT as u64).min(
                        node.size - i * Constants::MAX_CHUNK_PLAINTEXT as u64,
                    );
                    total += Constants::DATA_RECORD_OVERHEAD + plain_len;
                }
                node.data_length = total;
                pos += total;
            }
        }
        let data_offset = data_offset
            .ok_or_else(|| AstboxError::new(E::InvalidArgument, "layout did not converge"))?;

        // recompute final values
        let meta_cbor_final = Self::build_metadata_cbor(&entries, Some(now), Some(m))?;
        let data_off = data_offset;
        let data_len: u64 = entries
            .iter()
            .filter(|n| n.entry_type == Constants::TYPE_FILE)
            .map(|n| n.data_length)
            .sum();
        let footer_offset = data_off + data_len;

        // ---- encrypt chunks (FileID ascending, then ChunkIndex) ----
        let mut data_region: Vec<u8> = Vec::new();
        let mut file_nodes: Vec<&Node> = entries
            .iter()
            .filter(|n| n.entry_type == Constants::TYPE_FILE)
            .collect();
        file_nodes.sort_by(|a, b| a.id.cmp(&b.id));
        for node in file_nodes {
            if node.size == 0 {
                continue;
            }
            let data = node.data.as_ref().unwrap();
            let mut chunk_index: u64 = 0;
            let mut idx = 0usize;
            while idx < data.len() {
                let chunk_len = Constants::MAX_CHUNK_PLAINTEXT.min(data.len() - idx);
                let chunk = &data[idx..idx + chunk_len];
                let nonce = rng.bytes(24)?;
                let mut ad = Vec::with_capacity(Constants::LABEL_DATA.len() + 16 + 8 + 16 + 8 + 4);
                ad.extend_from_slice(Constants::LABEL_DATA);
                ad.extend_from_slice(&vault_id);
                ad.extend_from_slice(&0u64.to_be_bytes());
                ad.extend_from_slice(&node.id);
                ad.extend_from_slice(&chunk_index.to_be_bytes());
                ad.extend_from_slice(&(chunk_len as u32).to_be_bytes());

                let ct = Crypto::aead_encrypt(&keys.data, &nonce, chunk, &ad)?;

                data_region.extend_from_slice(&node.id);
                data_region.extend_from_slice(&chunk_index.to_be_bytes());
                data_region.extend_from_slice(&(chunk_len as u32).to_be_bytes());
                data_region.extend_from_slice(&nonce);
                data_region.extend_from_slice(&ct);

                idx += Constants::MAX_CHUNK_PLAINTEXT;
                chunk_index += 1;
            }
        }

        // ---- metadata record ----
        let meta_nonce = rng.bytes(24)?;
        let mut meta_ad = Vec::with_capacity(Constants::LABEL_METADATA.len() + 16 + 8);
        meta_ad.extend_from_slice(Constants::LABEL_METADATA);
        meta_ad.extend_from_slice(&vault_id);
        meta_ad.extend_from_slice(&0u64.to_be_bytes());
        let meta_ct = Crypto::aead_encrypt(&keys.metadata, &meta_nonce, &meta_cbor_final, &meta_ad)?;
        let mut metadata_record = Vec::with_capacity(24 + meta_ct.len());
        metadata_record.extend_from_slice(&meta_nonce);
        metadata_record.extend_from_slice(&meta_ct);

        // ---- footer ----
        let mut footer = vec![0u8; Constants::FOOTER_SIZE as usize];
        footer[..8].copy_from_slice(Constants::FOOTER_MAGIC);
        u16_be_write(&mut footer, 8, Constants::VERSION);
        u16_be_write(&mut footer, 10, 0);
        u64_be_write(&mut footer, 12, 0);
        u64_be_write(&mut footer, 20, footer_offset + Constants::FOOTER_SIZE);
        footer[28..44].copy_from_slice(&Crypto::sha256_first16(&metadata_record));
        footer[44..60].copy_from_slice(&Crypto::sha256_first16(&data_region));
        let mut footer_without_mac = vec![0u8; 112];
        footer_without_mac[..60].copy_from_slice(&footer[..60]);
        footer_without_mac[76..112].copy_from_slice(&footer[76..112]);
        let mut footer_mac_input = Vec::with_capacity(Constants::LABEL_FOOTER_MAC.len() + 112);
        footer_mac_input.extend_from_slice(Constants::LABEL_FOOTER_MAC);
        footer_mac_input.extend_from_slice(&footer_without_mac);
        let mac = Crypto::hmac_sha256_trunc16(&keys.footer, &footer_mac_input)?;
        footer[60..76].copy_from_slice(&mac);

        // ---- key slots (SlotMAC after SlotMACKey is known) ----
        let mut slot_blobs: Vec<Vec<u8>> = Vec::with_capacity(slots.len());
        for s in &slots {
            let mut blob = vec![0u8; Constants::KEY_SLOT_SIZE as usize];
            blob[..16].copy_from_slice(&s.slot_id);
            u16_be_write(&mut blob, 16, s.credential_type);
            blob[18] = s.credential_parameters;
            blob[19] = 0;
            u16_be_write(&mut blob, 20, s.kdf_profile);
            u16_be_write(&mut blob, 22, 0);
            u32_be_write(&mut blob, 24, s.mem_kib);
            u32_be_write(&mut blob, 28, s.time);
            u32_be_write(&mut blob, 32, s.par);
            blob[36..68].copy_from_slice(&s.salt);
            blob[68..92].copy_from_slice(&s.wrap_nonce);
            blob[92..140].copy_from_slice(&s.wrapped);
            let mut mac_input = Vec::with_capacity(Constants::LABEL_SLOT_MAC.len() + 176);
            mac_input.extend_from_slice(Constants::LABEL_SLOT_MAC);
            mac_input.extend_from_slice(&blob[..140]);
            mac_input.extend_from_slice(&blob[156..]);
            let mac = Crypto::hmac_sha256_trunc16(&keys.slot_mac, &mac_input)?;
            blob[140..156].copy_from_slice(&mac);
            slot_blobs.push(blob);
        }

        // ---- header ----
        let mut header = vec![0u8; Constants::HEADER_SIZE as usize];
        header[..6].copy_from_slice(Constants::HEADER_MAGIC);
        u16_be_write(&mut header, 6, Constants::VERSION);
        u32_be_write(&mut header, 8, 0);
        header[12..28].copy_from_slice(&vault_id);
        u64_be_write(&mut header, 28, 0);
        u64_be_write(&mut header, 36, Constants::HEADER_SIZE);
        u64_be_write(&mut header, 44, key_slot_length);
        u64_be_write(&mut header, 52, metadata_offset);
        u64_be_write(&mut header, 60, metadata_record.len() as u64);
        u64_be_write(&mut header, 68, data_off);
        u64_be_write(&mut header, 76, data_len);
        u64_be_write(&mut header, 84, footer_offset);
        u64_be_write(&mut header, 92, Constants::FOOTER_SIZE);
        u32_be_write(&mut header, 100, slots.len() as u32);
        u32_be_write(&mut header, 104, Constants::HEADER_SIZE as u32);
        let mut header_without_mac = vec![0u8; 128];
        header_without_mac[..108].copy_from_slice(&header[..108]);
        header_without_mac[124..128].copy_from_slice(&header[124..128]);
        let mut header_mac_input = Vec::with_capacity(Constants::LABEL_HEADER_MAC.len() + 128);
        header_mac_input.extend_from_slice(Constants::LABEL_HEADER_MAC);
        header_mac_input.extend_from_slice(&header_without_mac);
        let mac = Crypto::hmac_sha256_trunc16(&keys.header, &header_mac_input)?;
        header[108..124].copy_from_slice(&mac);

        // ---- write ----
        use std::io::Write;
        let f = std::fs::File::create(path)
            .map_err(|e| crate::err!(E::Io, "cannot create {}: {}", path, e))?;
        let mut w = std::io::BufWriter::new(f);
        w.write_all(&header)
            .and_then(|_| slot_blobs.iter().try_for_each(|b| w.write_all(b)))
            .and_then(|_| w.write_all(&metadata_record))
            .and_then(|_| w.write_all(&data_region))
            .and_then(|_| w.write_all(&footer))
            .and_then(|_| w.flush())
            .map_err(|e| crate::err!(E::Write, "cannot write {}: {}", path, e))?;

        // self-verification
        if params.totp_secret.is_some() {
            Container::unlock_container(path, None, None, params.totp_secret)
        } else {
            Container::unlock_container(path, params.totp_code, None, None)
        }
    }
}

pub fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn collect_files_recursive(
    root: &std::path::Path,
    dir: &std::path::Path,
    out: &mut Vec<(String, Vec<u8>)>,
) -> Result<()> {
    let rd = std::fs::read_dir(dir).map_err(|e| {
        crate::err!(E::Io, "cannot read {}: {}", dir.display(), io_msg(&e))
    })?;
    for entry in rd {
        let entry = entry.map_err(|e| crate::err!(E::Io, "readdir: {}", io_msg(&e)))?;
        let p = entry.path();
        if p.is_dir() {
            collect_files_recursive(root, &p, out)?;
        } else if p.is_file() {
            let rel = p
                .strip_prefix(root)
                .unwrap_or(&p)
                .to_string_lossy()
                .replace('\\', "/");
            let data = std::fs::read(&p)
                .map_err(|e| crate::err!(E::Io, "cannot read {}: {}", p.display(), io_msg(&e)))?;
            out.push((rel, data));
        }
    }
    Ok(())
}

fn io_msg(e: &std::io::Error) -> String {
    crate::container::io_message(e)
}

/// Parameters for container creation (C# named-argument surface).
pub struct CreateParams<'a> {
    pub totp_code: Option<&'a str>,
    pub totp_digits: u8,
    pub files: Vec<(String, Vec<u8>)>,
    pub seed_dir: Option<std::path::PathBuf>,
    pub kdf_profile: u16,
    pub created: Option<i64>,
    pub modified: Option<i64>,
    pub totp_secret: Option<&'a str>,
}

impl<'a> Default for CreateParams<'a> {
    fn default() -> Self {
        CreateParams {
            totp_code: None,
            totp_digits: 6,
            files: Vec::new(),
            seed_dir: None,
            kdf_profile: Constants::KDF_PROFILE_HIGH,
            created: None,
            modified: None,
            totp_secret: None,
        }
    }
}
