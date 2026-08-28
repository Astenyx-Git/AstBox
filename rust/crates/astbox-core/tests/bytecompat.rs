// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
//! Byte-compat harness (P1 DoD): replay the exact entropy extracted from
//! C#-produced artifacts through the Rust builders and require byte-identical
//! output on the four paths — pack (create), unpack (via native_tests),
//! modify (add), propagation package (passbox).
//!
//! Oracle: the C# NativeAOT server (.server-publish\astbox-server.exe) drives
//! all three builder paths via /api/pack, /api/add and /api/export_passbox.
//! (The CLI exe is blocked by Smart App Control on this machine; the server
//! shares the same Astbox.Core builders.)
//!
//! Set ASTBOX_ORACLE_DIR to the repo root to enable; tests skip silently
//! when the oracle is absent.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::Command;

use astbox_core::bin::{hex_lower, u32_be_at, u64_be_at};
use astbox_core::constants::Constants;
use astbox_core::container::Container;
use astbox_core::creator::{CreateParams, Creator};
use astbox_core::crypto::Crypto;
use astbox_core::modifier::Modifier;
use astbox_core::passbox_file::PassboxFile;
use astbox_core::rng::{ReplayRandom, RandomSource};
use astbox_core::{CborDet, CborValue};

const SECRET: &str = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const NOTE_TEXT: &[u8] = "added by the Rust byte-compat harness\n中文内容验证\n".as_bytes();

fn oracle_root() -> Option<PathBuf> {
    let root = std::env::var("ASTBOX_ORACLE_DIR").ok()?;
    let p = PathBuf::from(root);
    if p.is_dir() {
        Some(p)
    } else {
        None
    }
}

fn new_work(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!(
        "astbox-bytecompat-{}-{}-{:x}",
        tag,
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .subsec_nanos()
    ));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn sha256_of(p: &Path) -> String {
    hex_lower(&Crypto::sha256(&std::fs::read(p).unwrap()))
}

/// C# CLI/Server DemoFiles() replica (byte-for-byte), keyed by logical path.
fn demo_files() -> Vec<(String, Vec<u8>)> {
    let text =
        b"ASTBOX v1.0 demo file.\n\nThis container was created by astbox-cli create --demo.\n";
    let guide = b"# ASTBOX decoder guide\n\nUnlock -> browse -> extract.\n";
    let mut readme = Vec::with_capacity(text.len() * 20);
    for _ in 0..20 {
        readme.extend_from_slice(text);
    }
    let mut guide_buf = Vec::with_capacity(guide.len() * 40);
    for _ in 0..40 {
        guide_buf.extend_from_slice(guide);
    }
    let big_len = 2 * 1048576 + 12345;
    let mut big = Vec::with_capacity(big_len);
    for i in 0..big_len {
        big.push(((i * 131 + 7) % 256) as u8);
    }
    vec![
        ("readme.txt".to_string(), readme),
        ("docs/guide.md".to_string(), guide_buf),
        ("assets/random.bin".to_string(), big),
        ("empty.txt".to_string(), Vec::new()),
        (
            "docs/notes/\u{6d4b}\u{8bd5}.txt".to_string(),
            b"unicode file name test\n".to_vec(),
        ),
    ]
}

fn write_demo_tree(root: &Path) {
    for (rel, data) in demo_files() {
        let p = root.join(rel.replace('/', "\\"));
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, data).unwrap();
    }
}

/// Walk the Data region in order, returning every record's 24B nonce.
fn data_nonces_in_region_order(raw: &[u8]) -> Vec<Vec<u8>> {
    let h = Container::parse_header(raw).unwrap();
    let start = h.data_offset as usize;
    let end = start + h.data_length as usize;
    let mut pos = start;
    let mut out = Vec::new();
    while pos < end {
        let plen = u32_be_at(raw, pos + 24);
        out.push(raw[pos + 28..pos + 52].to_vec());
        pos += (Constants::DATA_RECORD_OVERHEAD + plen as u64) as usize;
    }
    assert_eq!(pos, end, "region walk must be exact");
    out
}

fn metadata_nonce(raw: &[u8]) -> Vec<u8> {
    let h = Container::parse_header(raw).unwrap();
    raw[h.metadata_offset as usize..h.metadata_offset as usize + 24].to_vec()
}

fn slot_entropy(raw: &[u8]) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
    let s = &raw[128..128 + 192];
    (s[0..16].to_vec(), s[36..68].to_vec(), s[68..92].to_vec())
}

/// FileIDs of every metadata entry in array order (= C# NewId() call order:
/// directories sorted first, then files in builder input order).
fn file_ids_in_metadata_order(meta: &CborValue) -> Vec<Vec<u8>> {
    let entries = meta
        .entries()
        .iter()
        .find(|(k, _)| *k == CborValue::UInt(3))
        .map(|(_, v)| v)
        .unwrap();
    entries
        .items()
        .iter()
        .map(|e| {
            e.entries()
                .iter()
                .find(|(k, _)| *k == CborValue::UInt(1))
                .map(|(_, v)| v.as_bytes().to_vec())
                .unwrap()
        })
        .collect()
}

/// Logical paths of FILE entries, in metadata array order — this is the
/// builder input order used by the C# side (dirs were created first).
fn file_paths_in_input_order(uc: &astbox_core::UnlockedContainer) -> Vec<String> {
    let entries = uc
        .metadata
        .entries()
        .iter()
        .find(|(k, _)| *k == CborValue::UInt(3))
        .map(|(_, v)| v)
        .unwrap();
    // id -> (parent, name, is_dir)
    let mut by_id: std::collections::HashMap<Vec<u8>, (Vec<u8>, String, bool)> =
        std::collections::HashMap::new();
    for e in entries.items() {
        let id = e
            .entries()
            .iter()
            .find(|(k, _)| *k == CborValue::UInt(1))
            .map(|(_, v)| v.as_bytes().to_vec())
            .unwrap();
        let parent = e
            .entries()
            .iter()
            .find(|(k, _)| *k == CborValue::UInt(2))
            .map(|(_, v)| v.as_bytes().to_vec())
            .unwrap();
        let name = e
            .entries()
            .iter()
            .find(|(k, _)| *k == CborValue::UInt(4))
            .map(|(_, v)| v.as_text().to_string())
            .unwrap();
        let ty = e
            .entries()
            .iter()
            .find(|(k, _)| *k == CborValue::UInt(3))
            .map(|(_, v)| v.as_uint() as u8)
            .unwrap();
        by_id.insert(id, (parent, name, ty == Constants::TYPE_DIRECTORY));
    }
    // iterate the ARRAY in order: file entries appear in builder input order
    let mut out = Vec::new();
    for e in entries.items() {
        let id = e
            .entries()
            .iter()
            .find(|(k, _)| *k == CborValue::UInt(1))
            .map(|(_, v)| v.as_bytes().to_vec())
            .unwrap();
        let (parent, name, is_dir) = &by_id[&id];
        if *is_dir {
            continue;
        }
        let mut parts = vec![name.clone()];
        let mut cur = parent.clone();
        while cur != Constants::ROOT_DIRECTORY_ID.to_vec() {
            let (p, n, _) = by_id[&cur].clone();
            parts.push(n);
            cur = p;
        }
        parts.reverse();
        out.push(parts.join("/"));
    }
    out
}

// ------------------------------------------------------------------ server

struct ServerProc {
    child: std::process::Child,
    port: u16,
}

impl Drop for ServerProc {
    fn drop(&mut self) {
        let _ = http_post(self.port, "/api/shutdown", "{}");
        let _ = self.child.wait();
    }
}

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

fn http_post(port: u16, path: &str, body: &str) -> Result<String, String> {
    let mut s = TcpStream::connect(("127.0.0.1", port)).map_err(|e| e.to_string())?;
    s.set_read_timeout(Some(std::time::Duration::from_secs(120))).ok();
    s.set_write_timeout(Some(std::time::Duration::from_secs(60))).ok();
    let req = format!(
        "POST {} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        path,
        port,
        body.as_bytes().len(),
        body
    );
    s.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    s.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&buf);
    let (head, rest) = match text.split_once("\r\n\r\n") {
        Some(x) => x,
        None => return Err(format!("bad HTTP response from {}", path)),
    };
    let chunked = head.to_lowercase().contains("transfer-encoding: chunked");
    if chunked {
        let mut out = Vec::new();
        let mut cur = rest.as_bytes();
        loop {
            let idx = match cur.windows(2).position(|w| w == b"\r\n") {
                Some(i) => i,
                None => break,
            };
            let size =
                usize::from_str_radix(String::from_utf8_lossy(&cur[..idx]).trim(), 16)
                    .unwrap_or(0);
            if size == 0 {
                break;
            }
            let start = idx + 2;
            if start + size > cur.len() {
                break;
            }
            out.extend_from_slice(&cur[start..start + size]);
            cur = &cur[start + size + 2..];
        }
        Ok(String::from_utf8_lossy(&out).into_owned())
    } else {
        Ok(rest.to_string())
    }
}

fn http_get(port: u16, path: &str) -> Result<String, String> {
    let mut s = TcpStream::connect(("127.0.0.1", port)).map_err(|e| e.to_string())?;
    s.set_read_timeout(Some(std::time::Duration::from_secs(30))).ok();
    let req = format!(
        "GET {} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
        path, port
    );
    s.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    s.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&buf);
    Ok(text
        .split_once("\r\n\r\n")
        .map(|x| x.1.to_string())
        .unwrap_or_default())
}

fn json_escape_path(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "\\\\")
}

fn start_server(root: &Path, work: &Path) -> ServerProc {
    let server = root.join(".server-publish").join("astbox-server.exe");
    assert!(server.exists(), "oracle server missing: {}", server.display());
    let port = free_port();
    let child = Command::new(server)
        .args(["--port", &port.to_string(), "--no-browser"])
        .spawn()
        .expect("failed to spawn oracle server");
    let proc = ServerProc { child, port };
    let mut up = false;
    for _ in 0..100 {
        if http_get(proc.port, "/api/state").is_ok() {
            up = true;
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    assert!(up, "oracle server did not come up");
    proc
}

/// Ask the C# server to build the demo container; returns (dst, raw bytes).
fn server_create_demo(server: &ServerProc, work: &Path, tag: &str) -> (PathBuf, Vec<u8>) {
    let src = work.join("demo-src");
    write_demo_tree(&src);
    let dst = work.join(format!("{}.astbox", tag));
    let resp = http_post(
        server.port,
        "/api/pack",
        &format!(
            "{{\"src\":\"{}\",\"dst\":\"{}\",\"digits\":6,\"b32\":\"{}\",\"profile\":\"constrained\"}}",
            json_escape_path(&src),
            json_escape_path(&dst),
            SECRET
        ),
    )
    .unwrap();
    assert!(
        serde_json::from_str::<serde_json::Value>(&resp).unwrap()["ok"].as_bool() == Some(true),
        "pack failed: {}",
        resp
    );
    let raw = std::fs::read(&dst).unwrap();
    (dst, raw)
}

fn assert_byte_identical(label: &str, cs_hash: String, rs_hash: String) {
    assert_eq!(cs_hash, rs_hash, "{}: C# and Rust outputs must be byte-identical", label);
}

#[test]
fn create_replay_byte_identical() {
    let root = match oracle_root() {
        Some(r) => r,
        None => {
            eprintln!("skip: ASTBOX_ORACLE_DIR not set");
            return;
        }
    };
    let work = new_work("create");
    let server = start_server(&root, &work);

    let (cs_path, cs_raw) = server_create_demo(&server, &work, "cs");

    // --- extract entropy -----------------------------------------------------
    let uc =
        Container::unlock_container(cs_path.to_str().unwrap(), None, None, Some(SECRET)).unwrap();
    let vault_id = uc.parsed.header.vault_id.clone();
    let vault_key = uc.vault_key.to_vec();
    let (slot_id, salt, wrap_nonce) = slot_entropy(&cs_raw);
    let ids = file_ids_in_metadata_order(&uc.metadata);
    let nonces = data_nonces_in_region_order(&cs_raw);
    let meta_nonce = metadata_nonce(&cs_raw);

    let mut chunks = vec![vault_id, vault_key, slot_id, salt, wrap_nonce];
    chunks.extend(ids);
    chunks.extend(nonces);
    chunks.push(meta_nonce);

    // --- Rust replay: file input order = metadata file-entry order -----------
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    let demo: std::collections::HashMap<String, Vec<u8>> =
        demo_files().into_iter().collect();
    for path in file_paths_in_input_order(&uc) {
        files.push((
            path.clone(),
            demo.get(&path).cloned().unwrap_or_else(|| {
                panic!("demo content missing for {}", path)
            }),
        ));
    }

    let rs = work.join("rs.astbox");
    Creator::create_container_with(
        &mut ReplayRandom::from_chunks(&chunks),
        rs.to_str().unwrap(),
        &CreateParams {
            totp_secret: Some(SECRET),
            totp_digits: 6,
            files,
            kdf_profile: Constants::KDF_PROFILE_MEMORY_CONSTRAINED,
            created: Some(uc.created as i64),
            modified: Some(uc.modified as i64),
            ..Default::default()
        },
    )
    .unwrap();

    let cs_hash = sha256_of(&cs_path);
    let rs_hash = sha256_of(&rs);
    drop(server);
    let _ = std::fs::remove_dir_all(&work);
    assert_byte_identical("CREATE", cs_hash, rs_hash);
}

#[test]
fn modify_replay_byte_identical() {
    let root = match oracle_root() {
        Some(r) => r,
        None => {
            eprintln!("skip: ASTBOX_ORACLE_DIR not set");
            return;
        }
    };
    let work = new_work("modify");
    let server = start_server(&root, &work);

    let (cs_path, _raw) = server_create_demo(&server, &work, "cs");

    // snapshot the ORIGINAL unlocked container (Rust) before the C# modify
    let uc_before = Container::unlock_container(
        cs_path.to_str().unwrap(),
        None,
        None,
        Some(SECRET),
    )
    .unwrap();

    // --- C# adds one file, in place -------------------------------------------
    let add_dir = work.join("adddir");
    std::fs::create_dir_all(add_dir.join("newdir")).unwrap();
    std::fs::write(add_dir.join("newdir").join("note.txt"), NOTE_TEXT).unwrap();

    // open + unlock via the server (registered at pack time)
    let open = http_post(
        server.port,
        "/api/open",
        &format!("{{\"path\":\"{}\"}}", json_escape_path(&cs_path)),
    )
    .unwrap();
    assert!(
        serde_json::from_str::<serde_json::Value>(&open).unwrap()["ok"].as_bool()
            == Some(true),
        "open failed: {}",
        open
    );
    let code = Crypto::totp_at(SECRET, 6, None).unwrap();
    let unlock = http_post(
        server.port,
        "/api/unlock",
        &format!("{{\"totp\":\"{}\"}}", code),
    )
    .unwrap();
    assert!(
        serde_json::from_str::<serde_json::Value>(&unlock).unwrap()["ok"].as_bool()
            == Some(true),
        "unlock failed: {}",
        unlock
    );
    let add = http_post(
        server.port,
        "/api/add",
        &format!("{{\"paths\":[\"{}\"]}}", json_escape_path(&add_dir)),
    )
    .unwrap();
    // ABSORBED (C#-line review fix 519061c): /api/add self-verification now
    // goes through the secret channel, so our server answers ok:true. The
    // C#-reference artifact captured here predates that fix (its /api/add
    // self-verified with the unlock CODE credential — not a KDF credential —
    // and returned an auth error after the gen-1 container was committed).
    // We therefore only require the committed generation to be 1; the byte
    // replay below is unaffected (self-verify channel does not touch bytes).
    let _ = add;
    let gen_check = std::fs::read(&cs_path).unwrap();
    let gen = u64_be_at(&gen_check, 28);
    assert_eq!(gen, 1, "C# /api/add must have committed generation 1");

    // --- entropy from the C# output (gen 1, written in place) ------------------
    let added_raw = std::fs::read(&cs_path).unwrap();
    let nonces = data_nonces_in_region_order(&added_raw);
    let meta_nonce = metadata_nonce(&added_raw);
    let parsed_added =
        Container::parse_container(cs_path.to_str().unwrap(), Some(added_raw.clone())).unwrap();
    let meta_plain = {
        let h = &parsed_added.header;
        let rec = &added_raw
            [h.metadata_offset as usize..(h.metadata_offset + h.metadata_length) as usize];
        let tag = rec[rec.len() - 16..].to_vec();
        let mut ct = rec[24..rec.len() - 16].to_vec();
        ct.extend_from_slice(&tag);
        let mut ad = Vec::new();
        ad.extend_from_slice(Constants::LABEL_METADATA);
        ad.extend_from_slice(&parsed_added.header.vault_id);
        ad.extend_from_slice(&parsed_added.header.generation.to_be_bytes());
        Crypto::aead_decrypt(&uc_before.keys.metadata, &rec[..24], &ct, &ad).unwrap()
    };
    let meta = CborDet::loads(&meta_plain).unwrap();
    let modified = meta
        .entries()
        .iter()
        .find(|(k, _)| *k == CborValue::UInt(5))
        .map(|(_, v)| v.as_uint())
        .unwrap();

    // new FileIDs consumed by add_files planning: ensure_dir id first, then
    // the file id — i.e. the gen-1 metadata ids absent from the original,
    // in array order (new entries are appended sorted by depth/ordinal).
    let before_ids: std::collections::HashSet<Vec<u8>> =
        file_ids_in_metadata_order(&uc_before.metadata).into_iter().collect();
    let new_ids: Vec<Vec<u8>> = file_ids_in_metadata_order(&meta)
        .into_iter()
        .filter(|i| !before_ids.contains(i))
        .collect();
    assert_eq!(new_ids.len(), 2, "expect newdir id + note.txt id");

    let mut chunks = new_ids;
    chunks.extend(nonces);
    chunks.push(meta_nonce);

    // --- Rust replay ----------------------------------------------------------
    let rs_added = work.join("rs-added.astbox");
    Modifier::add_files_with(
        &mut ReplayRandom::from_chunks(&chunks),
        &uc_before,
        &[("newdir/note.txt".to_string(), NOTE_TEXT.to_vec())],
        rs_added.to_str().unwrap(),
        None,
        Some(modified as i64),
        None,
    )
    .unwrap();

    let cs_hash = sha256_of(&cs_path);
    let rs_hash = sha256_of(&rs_added);
    drop(server);
    let _ = std::fs::remove_dir_all(&work);
    assert_byte_identical("MODIFY", cs_hash, rs_hash);
}

/// PASSBOX: quick pack is fully deterministic; locked pack replays
/// salt+snonce. The container file name exercises JSON escaping (C# default
/// encoder vs our replica) with non-ASCII and HTML-sensitive characters.
#[test]
fn passbox_replay_byte_identical() {
    let root = match oracle_root() {
        Some(r) => r,
        None => {
            eprintln!("skip: ASTBOX_ORACLE_DIR not set");
            return;
        }
    };
    let work = new_work("passbox");
    let server = start_server(&root, &work);

    let dst = work.join("\u{4e2d}\u{6587}&demo'.astbox");
    let resp = http_post(
        server.port,
        "/api/demo",
        &format!(
            "{{\"dst\":\"{}\",\"digits\":6,\"profile\":\"constrained\"}}",
            json_escape_path(&dst)
        ),
    )
    .unwrap();
    let doc: serde_json::Value = serde_json::from_str(&resp).unwrap();
    assert_eq!(doc["ok"].as_bool(), Some(true), "demo failed: {}", resp);
    let secret = doc["demo"]["b32"].as_str().unwrap().to_string();

    let code = Crypto::totp_at(&secret, 6, None).unwrap();
    let unlock = http_post(
        server.port,
        "/api/unlock",
        &format!("{{\"totp\":\"{}\"}}", code),
    )
    .unwrap();
    assert!(
        serde_json::from_str::<serde_json::Value>(&unlock).unwrap()["ok"].as_bool()
            == Some(true),
        "unlock failed: {}",
        unlock
    );

    let cs_quick = work.join("cs-quick.passbox");
    http_post(
        server.port,
        "/api/export_passbox",
        &format!("{{\"out\":\"{}\"}}", json_escape_path(&cs_quick)),
    )
    .unwrap();
    assert!(cs_quick.exists(), "quick passbox not produced");

    let cs_locked = work.join("cs-locked.passbox");
    http_post(
        server.port,
        "/api/export_passbox",
        &format!(
            "{{\"out\":\"{}\",\"passphrase\":\"\u{53e3}\u{4ee4}-pass-123\"}}",
            json_escape_path(&cs_locked)
        ),
    )
    .unwrap();
    assert!(cs_locked.exists(), "locked passbox not produced");
    drop(server);

    // --- Rust side -------------------------------------------------------------
    let container = dst.to_str().unwrap().to_string();
    let uc = Container::unlock_container(&container, None, None, Some(&secret)).unwrap();

    let rs_quick = work.join("rs-quick.passbox");
    PassboxFile::pack_passbox(
        &container,
        &secret,
        6,
        Some(uc.created as i64),
        rs_quick.to_str().unwrap(),
        None,
    )
    .unwrap();
    assert_byte_identical(
        "PASSBOX quick",
        sha256_of(&cs_quick),
        sha256_of(&rs_quick),
    );

    let locked_raw = std::fs::read(&cs_locked).unwrap();
    let hlen = u32_be_at(&locked_raw, 16) as usize;
    let header: serde_json::Value =
        serde_json::from_slice(&locked_raw[20..20 + hlen]).unwrap();
    let salt = astbox_core::bin::unhex(header["salt"].as_str().unwrap()).unwrap();
    let snonce = astbox_core::bin::unhex(header["snonce"].as_str().unwrap()).unwrap();
    let rs_locked = work.join("rs-locked.passbox");
    PassboxFile::pack_passbox_with(
        &mut ReplayRandom::from_chunks(&[salt, snonce]),
        &container,
        &secret,
        6,
        Some(uc.created as i64),
        rs_locked.to_str().unwrap(),
        Some("\u{53e3}\u{4ee4}-pass-123"),
    )
    .unwrap();
    assert_byte_identical(
        "PASSBOX locked",
        sha256_of(&cs_locked),
        sha256_of(&rs_locked),
    );
    let _ = std::fs::remove_dir_all(&work);
}
