// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
//! Port of the C# native test runner (Astbox.TestsRunner, 36 checks) as
//! cargo integration tests. Fixture interop proves the Rust core reads the
//! C#-produced demo container byte-for-byte per the manifest.

use astbox_core::container::{Container, Entry};
use astbox_core::constants::Constants;
use astbox_core::creator::{CreateParams, Creator};
use astbox_core::crypto::Crypto;
use astbox_core::errors::{code_name, E};
use astbox_core::extractor::Extractor;
use astbox_core::modifier::Modifier;
use astbox_core::passbox_file::{PassboxError, PassboxFile};
use astbox_core::{CborDet, CborValue};

const FIXTURE_SECRET: &str = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

fn fixtures_dir() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../tests/fixtures")
}

fn demo_container() -> String {
    fixtures_dir().join("demo.astbox").to_string_lossy().into_owned()
}

fn manifest() -> serde_json::Value {
    let text = std::fs::read_to_string(fixtures_dir().join("manifest.json")).unwrap();
    serde_json::from_str(&text).unwrap()
}

fn new_work(tag: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!(
        "astbox-rust-tests-{}-{:08x}",
        tag,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .subsec_nanos() as usize
            ^ (std::process::id() as usize) << 8
    ));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn expect_astbox_error(code: u16, f: impl FnOnce() -> astbox_core::Result<()>, name: &str) {
    match f() {
        Ok(_) => panic!("FAIL {}: no exception thrown", name),
        Err(e) => {
            assert_eq!(
                e.code,
                code,
                "FAIL {}: got {} want {}",
                name,
                e.code_name(),
                code_name(code)
            );
        }
    }
}

fn unlock_demo() -> astbox_core::UnlockedContainer {
    Container::unlock_container(&demo_container(), None, None, Some(FIXTURE_SECRET)).unwrap()
}

// ------------------------------------------------------------- crypto/cbor

#[test]
fn crypto_selftest_all_vectors() {
    let results = Crypto::selftest().expect("selftest failed");
    assert!(
        results.iter().any(|r| r.contains("Argon2id")) && results.iter().any(|r| r.contains("TOTP")),
        "Crypto.Selftest all vectors: {:?}",
        results
    );
}

#[test]
fn base32_decode_vector() {
    let expected = [0x48u8, 0x65, 0x6C, 0x6C, 0x6F, 0x21, 0xDE, 0xAD, 0xBE, 0xEF];
    assert_eq!(Crypto::base32_decode("JBSWY3DPEHPK3PXP").unwrap(), expected);
}

#[test]
fn base32_decode_casefold_spaces() {
    let expected = [0x48u8, 0x65, 0x6C, 0x6C, 0x6F, 0x21, 0xDE, 0xAD, 0xBE, 0xEF];
    assert_eq!(Crypto::base32_decode("jbsw y3dp ehpk 3pxp").unwrap(), expected);
}

#[test]
fn base32_roundtrip_0_40() {
    for len in 0..=40 {
        let data = Crypto::random_bytes(len).unwrap();
        let encoded = Crypto::base32_encode(&data);
        assert!(!encoded.ends_with('='), "roundtrip len {} padded", len);
        assert_eq!(Crypto::base32_decode(&encoded).unwrap(), data, "len {}", len);
    }
}

#[test]
fn totp_rfc6238_vectors() {
    const SECRET: &str = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    assert_eq!(Crypto::totp_at(SECRET, 8, Some(59)).unwrap(), "94287082");
    assert_eq!(Crypto::totp_at(SECRET, 6, Some(59)).unwrap(), "287082");
}

#[test]
fn aead_wrong_key_fails_closed() {
    let key = Crypto::random_bytes(32).unwrap();
    let nonce = Crypto::random_bytes(24).unwrap();
    let ct = Crypto::aead_encrypt(&key, &nonce, b"hello", b"aad").unwrap();
    let wrong = Crypto::random_bytes(32).unwrap();
    expect_astbox_error(
        E::AeadFailure,
        || Crypto::aead_decrypt(&wrong, &nonce, &ct, b"aad").map(|_| ()),
        "AEAD wrong key fails closed",
    );
}

#[test]
fn argon2id_deterministic() {
    let sec = [7u8; 32];
    let salt = [9u8; 16];
    let a = Crypto::argon2id_raw(&sec, &salt, 16384, 3, 1, 32).unwrap();
    let b = Crypto::argon2id_raw(&sec, &salt, 16384, 3, 1, 32).unwrap();
    assert_eq!(a, b, "Argon2id deterministic");
    assert_eq!(a.len(), 32);
}

#[test]
fn cbor_canonical_roundtrip() {
    let value = CborValue::Map(vec![
        (CborValue::UInt(1), CborValue::UInt(5)),
        (CborValue::UInt(2), CborValue::Bytes(vec![1, 2, 3])),
        (CborValue::UInt(3), CborValue::Text("hello 世界".into())),
        (
            CborValue::UInt(4),
            CborValue::Array(vec![CborValue::UInt(0), CborValue::Text("x".into())]),
        ),
        (
            CborValue::UInt(5),
            CborValue::Map(vec![
                (CborValue::UInt(1), CborValue::Bytes(vec![0u8; 16])),
                (CborValue::UInt(9), CborValue::UInt(u64::MAX)),
            ]),
        ),
    ]);
    let encoded = CborDet::dumps(&value).unwrap();
    let decoded = CborDet::loads(&encoded).unwrap();
    assert_eq!(value, decoded, "CBOR canonical roundtrip");
    assert_eq!(
        encoded,
        CborDet::dumps(&decoded).unwrap(),
        "re-encode identical"
    );
}

#[test]
fn cbor_nfc_normalization() {
    let encoded = CborDet::dumps(&CborValue::Text("cafe\u{0301}".into())).unwrap();
    match CborDet::loads(&encoded).unwrap() {
        CborValue::Text(s) => assert_eq!(s, "caf\u{e9}", "CBOR NFC normalization"),
        other => panic!("expected text, got {:?}", other),
    }
}

#[test]
fn cbor_rejects_non_minimal_uint() {
    expect_astbox_error(
        E::NonCanonicalCbor,
        || CborDet::loads(&[0x18, 0x05]).map(|_| ()),
        "CBOR rejects non-minimal uint",
    );
}

#[test]
fn cbor_rejects_duplicate_map_keys() {
    expect_astbox_error(
        E::DuplicateCborKey,
        || CborDet::loads(&[0xA2, 0x01, 0x00, 0x01, 0x01]).map(|_| ()),
        "CBOR rejects duplicate map keys",
    );
}

#[test]
fn cbor_rejects_non_canonical_key_order() {
    expect_astbox_error(
        E::NonCanonicalCbor,
        || CborDet::loads(&[0xA2, 0x02, 0x00, 0x01, 0x00]).map(|_| ()),
        "CBOR rejects non-canonical key order",
    );
}

#[test]
fn cbor_rejects_negative_int() {
    expect_astbox_error(
        E::InvalidCbor,
        || CborDet::loads(&[0x20]).map(|_| ()),
        "CBOR rejects negative int",
    );
}

#[test]
fn cbor_rejects_float() {
    expect_astbox_error(
        E::InvalidCbor,
        || CborDet::loads(&[0xFB, 0, 0, 0, 0, 0, 0, 0, 0]).map(|_| ()),
        "CBOR rejects float",
    );
}

#[test]
fn cbor_rejects_tag() {
    expect_astbox_error(
        E::InvalidCbor,
        || CborDet::loads(&[0xC0, 0x00]).map(|_| ()),
        "CBOR rejects tag",
    );
}

#[test]
fn cbor_rejects_indefinite_length() {
    expect_astbox_error(
        E::InvalidCbor,
        || CborDet::loads(&[0x9F, 0xFF]).map(|_| ()),
        "CBOR rejects indefinite length",
    );
}

#[test]
fn cbor_rejects_trailing_bytes() {
    expect_astbox_error(
        E::InvalidCbor,
        || CborDet::loads(&[0x00, 0x00]).map(|_| ()),
        "CBOR rejects trailing bytes",
    );
}

// ----------------------------------------------------------------- interop

#[test]
fn fixture_listing_matches_manifest() {
    let uc = unlock_demo();
    let m = manifest();
    let mut expected: Vec<(String, u64, bool)> = m["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            (
                e["path"].as_str().unwrap().to_string(),
                e["size"].as_u64().unwrap(),
                e["is_dir"].as_bool().unwrap(),
            )
        })
        .collect();
    expected.sort_by(|a, b| a.0.cmp(&b.0));
    let mut actual: Vec<(String, u64, bool)> = Container::walk_entries(&uc)
        .into_iter()
        .map(|(p, e)| (p, e.size, e.is_dir()))
        .collect();
    actual.sort_by(|a, b| a.0.cmp(&b.0));
    assert_eq!(expected, actual, "fixture listing matches manifest");
}

#[test]
fn fixture_created_modified_generation() {
    let uc = unlock_demo();
    let m = manifest();
    assert_eq!(m["created"].as_u64().unwrap(), uc.created);
    assert_eq!(m["modified"].as_u64().unwrap(), uc.modified);
    assert_eq!(uc.parsed.header.generation, 0);
}

#[test]
fn extracted_bytes_identical_to_source_fixtures() {
    let uc = unlock_demo();
    let work = new_work("extract");
    let src_root = fixtures_dir().join("src");
    let extracted = Extractor::extract_all(&uc, work.to_str().unwrap(), None, false).unwrap();
    assert!(!extracted.is_empty());
    let mut all_ok = true;
    for (logical_path, abs_path) in &extracted {
        let mut src_file = src_root.join(logical_path.replace('/', "\\"));
        if !src_file.exists() {
            // tolerate Unicode normalization differences between the
            // container (NFC names) and on-disk fixture file names
            let dir = src_file.parent().unwrap().to_path_buf();
            let norm = astbox_normalize(src_file.file_name().unwrap().to_string_lossy());
            let mut found = None;
            if let Ok(rd) = std::fs::read_dir(&dir) {
                for cand in rd.flatten() {
                    if astbox_normalize(cand.file_name().to_string_lossy()) == norm {
                        found = Some(cand.path());
                        break;
                    }
                }
            }
            match found {
                Some(f) => src_file = f,
                None => {
                    all_ok = false;
                    eprintln!("X missing src: {}", logical_path);
                    continue;
                }
            }
        }
        let src_bytes = std::fs::read(&src_file).unwrap();
        let dst_bytes = std::fs::read(abs_path).unwrap();
        if src_bytes != dst_bytes {
            all_ok = false;
            eprintln!("X mismatch: {}", logical_path);
        }
    }
    let _ = std::fs::remove_dir_all(&work);
    assert!(all_ok, "extracted bytes identical to source fixtures");
}

/// NFC normalization for name comparisons (fixtures use NFC names).
fn astbox_normalize(s: impl Into<String>) -> String {
    use unicode_normalization::UnicodeNormalization;
    let s: String = s.into().nfc().collect();
    s
}

#[test]
fn wrong_totp_code_fails_closed() {
    expect_astbox_error(
        E::AuthenticationFailed,
        || {
            Container::unlock_container(&demo_container(), Some("000000"), None, None)
                .map(|_| ())
        },
        "wrong TOTP code fails closed",
    );
}

#[test]
fn tampered_data_region_rejected() {
    let mut raw0 = std::fs::read(demo_container()).unwrap();
    let h = Container::parse_header(&raw0).unwrap();
    let idx = h.data_offset as usize + 100;
    raw0[idx] ^= 0xFF;
    let work = new_work("tamper");
    let p = work.join("t.astbox");
    std::fs::write(&p, &raw0).unwrap();
    let err = Container::unlock_container(p.to_str().unwrap(), None, None, Some(FIXTURE_SECRET))
        .err()
        .expect("tampered container must not unlock");
    let digest_rejected = err.code == E::MetadataDigestFailure
        || err.code == E::DataDigestFailure
        || (err.code == E::AuthenticationFailed
            && matches!(err.original_code, Some(oc) if oc == E::MetadataDigestFailure || oc == E::DataDigestFailure));
    let _ = std::fs::remove_dir_all(&work);
    assert!(
        digest_rejected,
        "tampered data region rejected: {}/original {:?}",
        err.code_name(),
        err.original_code
    );
}

#[test]
fn modify_add_file_generation_increments() {
    let uc = unlock_demo();
    let work = new_work("modify");
    let out_path = work.join("added.astbox");
    let note_text: &[u8] = "added by the C# port\n中文内容验证\n".as_bytes();
    let new_files = vec![("newdir/note.txt".to_string(), note_text.to_vec())];
    // C# parity: AddFiles(..., totp: null) returns null; reopen via secret.
    Modifier::add_files(&uc, &new_files, out_path.to_str().unwrap(), None, None).unwrap();
    let reopened = Container::unlock_container(
        out_path.to_str().unwrap(),
        None,
        None,
        Some(FIXTURE_SECRET),
    )
    .unwrap();
    assert_eq!(reopened.parsed.header.generation, 1, "modify bumps Generation to 1");

    let added = reopened
        .entries
        .values()
        .find(|e| e.name == "note.txt")
        .unwrap()
        .clone();
    let parts = Container::entry_path_parts(&reopened, &added);
    let content = Container::read_file(&reopened, &added).unwrap();
    assert!(
        parts == vec!["newdir".to_string(), "note.txt".to_string()] && content == note_text,
        "modified container holds new file content"
    );

    let mut originals_intact = true;
    for (path, abs_path) in
        Extractor::extract_all(&reopened, work.to_str().unwrap(), None, false).unwrap()
    {
        let src_file = fixtures_dir().join("src").join(path.replace('/', "\\"));
        if !src_file.exists() {
            continue;
        }
        if std::fs::read(&src_file).unwrap() != std::fs::read(&abs_path).unwrap() {
            originals_intact = false;
        }
    }
    let _ = std::fs::remove_dir_all(&work);
    assert!(originals_intact, "original files intact after modify");
}

#[test]
fn add_files_secret_channel_selfverifies() {
    // Secret-channel self-verification (absorbed from C#-line 519061c):
    // the Base32 secret is the actual KDF credential, so re-unlocking the
    // committed generation succeeds and the reopened container is returned.
    let uc = unlock_demo();
    let work = new_work("add_secret_channel");
    let out_path = work.join("added-secret.astbox");
    let new_files = vec![("secret-note.txt".to_string(), b"secret channel\n".to_vec())];
    let uc2 = Modifier::add_files(
        &uc,
        &new_files,
        out_path.to_str().unwrap(),
        None,
        Some(FIXTURE_SECRET),
    )
    .unwrap()
    .expect("secret-channel self-verification reopens the container");
    assert_eq!(uc2.parsed.header.generation, 1, "self-verified generation 1");
    let _ = std::fs::remove_dir_all(&work);
}

#[test]
fn add_files_totp_channel_fails_after_commit() {
    // Failure-semantics anchor: the TOTP ASCII code is not a KDF credential,
    // so totp-channel self-verification fails for secret-credential
    // containers — AFTER the new generation was already committed to disk.
    let uc = unlock_demo();
    let work = new_work("add_totp_fail");
    let out_path = work.join("added-totp.astbox");
    let new_files = vec![("totp-note.txt".to_string(), b"totp channel\n".to_vec())];
    let err = Modifier::add_files(
        &uc,
        &new_files,
        out_path.to_str().unwrap(),
        Some("123456"),
        None,
    )
    .err()
    .expect("totp-channel self-verification must fail for secret-credential containers");
    assert_eq!(
        err.code,
        E::AuthenticationFailed,
        "auth error expected: {}",
        err.code_name()
    );
    let committed = std::fs::read(&out_path).unwrap();
    let gen = Container::parse_header(&committed).unwrap().generation;
    assert_eq!(gen, 1, "generation 1 committed before self-verification failed");
    let _ = std::fs::remove_dir_all(&work);
}

#[test]
fn passbox_roundtrip_quick_and_locked() {
    let uc = unlock_demo();
    let work = new_work("passbox");

    let quick = work.join("quick.passbox");
    PassboxFile::pack_passbox(
        &demo_container(),
        FIXTURE_SECRET,
        6,
        Some(1700000000),
        quick.to_str().unwrap(),
        None,
    )
    .unwrap();
    assert!(
        !PassboxFile::read_info(quick.to_str().unwrap()).unwrap().needs_passphrase,
        "quick passbox needs no passphrase"
    );
    let r1 = PassboxFile::unwrap_secret(quick.to_str().unwrap(), None).unwrap();
    let reopened =
        Container::unlock_container(&r1.container_path, None, None, Some(&r1.secret_base32))
            .unwrap();
    assert!(
        r1.secret_base32 == FIXTURE_SECRET && reopened.created == uc.created,
        "quick passbox unwrap yields working container"
    );

    let locked = work.join("locked.passbox");
    PassboxFile::pack_passbox(
        &demo_container(),
        FIXTURE_SECRET,
        6,
        Some(1700000000),
        locked.to_str().unwrap(),
        Some("口令-pass-123"),
    )
    .unwrap();
    assert!(
        PassboxFile::read_info(locked.to_str().unwrap()).unwrap().needs_passphrase,
        "locked passbox requires passphrase"
    );
    expect_astbox_error(
        PassboxError::CODE,
        || PassboxFile::unwrap_secret(locked.to_str().unwrap(), None).map(|_| ()),
        "missing passphrase rejected",
    );
    expect_astbox_error(
        PassboxError::CODE,
        || {
            PassboxFile::unwrap_secret(locked.to_str().unwrap(), Some("wrong"))
                .map(|_| ())
        },
        "wrong passphrase rejected",
    );
    let r2 =
        PassboxFile::unwrap_secret(locked.to_str().unwrap(), Some("口令-pass-123")).unwrap();
    let reopened2 =
        Container::unlock_container(&r2.container_path, None, None, Some(&r2.secret_base32))
            .unwrap();
    assert!(
        r2.secret_base32 == FIXTURE_SECRET && reopened2.created == uc.created,
        "locked passbox unwraps with correct passphrase"
    );
    let _ = std::fs::remove_dir_all(&work);
}

// -------------------------------------------------------- creator roundtrip

#[test]
fn creator_roundtrip_and_verify_full() {
    let work = new_work("create");
    let container_path = work.join("made.astbox");
    let secret = Crypto::base32_encode(&Crypto::random_bytes(20).unwrap());

    let files: Vec<(String, Vec<u8>)> = vec![
        ("top.txt".into(), b"root file".to_vec()),
        (
            "a/b/c.bin".into(),
            (0..5000u32).map(|i| i as u8).collect(),
        ),
        ("empty.txt".into(), Vec::new()),
        (
            "独目录/文件.txt".into(),
            "unicode names ✓".as_bytes().to_vec(),
        ),
    ];
    let created = Creator::create_container(
        container_path.to_str().unwrap(),
        &CreateParams {
            totp_secret: Some(&secret),
            files: files.clone(),
            kdf_profile: Constants::KDF_PROFILE_MEMORY_CONSTRAINED,
            created: Some(1700000500),
            modified: Some(1700000600),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(created.parsed.header.generation, 0, "creator self-verified container");

    let uc = Container::unlock_container(container_path.to_str().unwrap(), None, None, Some(&secret))
        .unwrap();
    let mut all_match = true;
    for (path, entry) in Container::walk_entries(&uc) {
        if !entry.is_file() {
            continue;
        }
        let want = files
            .iter()
            .find(|(k, _)| astbox_normalize(k.clone()) == path)
            .map(|(_, v)| v.clone())
            .unwrap();
        if Container::read_file(&uc, &entry).unwrap() != want {
            all_match = false;
        }
    }
    assert!(all_match, "creator roundtrip contents identical");
    Container::verify_full(&uc).unwrap();

    // legacy TOTP-code credential
    let code_path = work.join("code.astbox");
    Creator::create_container(
        code_path.to_str().unwrap(),
        &CreateParams {
            totp_code: Some("123456"),
            totp_digits: 6,
            files: vec![("x.txt".to_string(), b"x".to_vec())],
            kdf_profile: Constants::KDF_PROFILE_MEMORY_CONSTRAINED,
            ..Default::default()
        },
    )
    .unwrap();
    let uc_code =
        Container::unlock_container(code_path.to_str().unwrap(), Some("123456"), None, None)
            .unwrap();
    assert_eq!(
        uc_code.entries.values().filter(|e| e.is_file()).count(),
        1,
        "legacy TOTP-code credential unlocks"
    );
    let _ = std::fs::remove_dir_all(&work);
}

// keep unused-import hygiene for parity types
#[allow(unused)]
fn _parity(_e: &Entry) {}
