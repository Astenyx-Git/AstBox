// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
//! ASTBOX v1.0 command-line decoder (Rust port of Astbox.Cli/Program.cs,
//! which itself ports astbox_cli.py).
//!
//! Subcommands:
//!     selftest                      run cryptographic self-tests
//!     info   FILE                   structural info (no credentials)
//!     unlock FILE [--totp C] [--list]
//!                                   unlock and verify the container
//!     extract FILE --out DIR [--totp C] [--path P] [--verify]
//!                                   decrypt files to a local directory
//!     create FILE [--totp-code C | --totp-secret B32] [--qr PNG]
//!                   [--totp-digits N] [--seed-dir DIR] [--demo]
//!                   [--profile high|constrained]
//!                                   create a TOTP-only container
//!     add    FILE --from-dir DIR [--totp C] [--out NEW]
//!                                   add files to a container
//!
//! Arg parsing is hand-rolled exactly like the C# port: the argparse help
//! texts, error messages and exit codes (0/1/2) are part of the script
//! compatibility contract, so we replicate them verbatim instead of using a
//! generic parser library.

use std::collections::HashMap;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::exit;

use astbox_core::bin::hex_lower;
use astbox_core::constants::Constants;
use astbox_core::container::{cmp_ordinal, Container, UnlockedContainer};
use astbox_core::creator::{CreateParams, Creator};
use astbox_core::crypto::Crypto;
use astbox_core::errors::E;
use astbox_core::extractor::Extractor;
use astbox_core::modifier::Modifier;
use astbox_core::qr_util::QrUtil;
use astbox_core::AstboxError;

const PROG: &str = "astbox-cli";
const CHOICES: &str = "'selftest', 'info', 'unlock', 'extract', 'create', 'add'";

const MAIN_USAGE: &str = "\
usage: astbox-cli [-h] {selftest,info,unlock,extract,create,add} ...

ASTBOX v1.0 container decoder (CLI)

positional arguments:
  {selftest,info,unlock,extract,create,add}
    selftest            run cryptographic self-tests
    info                show structural info
    unlock              unlock and verify a container
    extract             extract files to a directory
    create              create a test container
    add                 add files from a directory to a container (generation
                        transaction)

options:
  -h, --help            show this help message and exit
";

const SELFTEST_HELP: &str = "\
usage: astbox-cli selftest [-h]

options:
  -h, --help  show this help message and exit
";

const INFO_HELP: &str = "\
usage: astbox-cli info [-h] file

positional arguments:
  file

options:
  -h, --help  show this help message and exit
";

const UNLOCK_HELP: &str = "\
usage: astbox-cli unlock [-h] [--totp TOTP] [--list] [--verify] file

positional arguments:
  file

options:
  -h, --help   show this help message and exit
  --totp TOTP  TOTP code (sole credential type)
  --list       list contents
  --verify     authenticate all Data Records
";

const EXTRACT_HELP: &str = "\
usage: astbox-cli extract [-h] --out OUT [--totp TOTP] [--path PATH]
                          [--verify]
                          file

positional arguments:
  file

options:
  -h, --help   show this help message and exit
  --out OUT
  --totp TOTP  TOTP code (sole credential type)
  --path PATH  extract only this logical path ('' = all)
  --verify
";

const CREATE_HELP: &str = "\
usage: astbox-cli create [-h] [--totp-code TOTP_CODE]
                         [--totp-secret TOTP_SECRET] [--qr PNG]
                         [--totp-digits {6,8}] [--seed-dir SEED_DIR] [--demo]
                         [--profile {high,constrained}]
                         file

positional arguments:
  file

options:
  -h, --help            show this help message and exit
  --totp-code TOTP_CODE
  --totp-secret TOTP_SECRET
                        Base32 TOTP secret: compute the current code and print
                        provisioning info
  --qr PNG              save a scannable QR code PNG of the otpauth URI
                        (generates a TOTP secret if none is given)
  --totp-digits {6,8}
  --seed-dir SEED_DIR   import files from a directory
  --demo                embed a built-in demo file set
  --profile {high,constrained}
";

const ADD_HELP: &str = "\
usage: astbox-cli add [-h] --from-dir FROM_DIR [--out OUT] [--totp TOTP] file

positional arguments:
  file

options:
  -h, --help           show this help message and exit
  --from-dir FROM_DIR  directory whose files are added
  --out OUT            output path (default: modify in place)
  --totp TOTP          TOTP code (sole credential type)
";

// ------------------------------------------------------------- helpers

/// Lowercase hex (python bytes.hex()).
fn hex(data: &[u8]) -> String {
    hex_lower(data)
}

/// Lexical absolute path (C# Path.GetFullPath without touching the FS).
fn abspath(path: &str) -> String {
    let p = Path::new(path);
    let joined = if p.is_absolute() {
        p.to_path_buf()
    } else {
        std::env::current_dir().unwrap_or_default().join(p)
    };
    let mut out = PathBuf::new();
    for comp in joined.components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out.to_string_lossy().into_owned()
}

fn basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

/// Port of astbox_cli._human().
fn human(bytes: i64) -> String {
    let units = ["B", "KiB", "MiB", "GiB", "TiB"];
    let mut n = bytes as f64;
    for &unit in &units {
        if n < 1024.0 || unit == "TiB" {
            return if unit == "B" {
                format!("{} B", bytes)
            } else {
                format!("{:.1} {}", n, unit)
            };
        }
        n /= 1024.0;
    }
    format!("{}", bytes)
}

/// Port of astbox_cli._fmt_time(): local "%Y-%m-%d %H:%M:%S";
/// fall back to the raw number on overflow/invalid values.
fn fmt_time(t: u64) -> String {
    use chrono::{Local, TimeZone};
    if t > i64::MAX as u64 {
        return format!("{}", t);
    }
    match chrono::DateTime::from_timestamp(t as i64, 0) {
        Some(utc) => match Local.from_local_datetime(&utc.naive_local()) {
            chrono::LocalResult::Single(dt) => {
                dt.format("%Y-%m-%d %H:%M:%S").to_string()
            }
            _ => format!("{}", t),
        },
        None => format!("{}", t),
    }
}

/// Port of astbox_cli._slot_desc().
fn slot_desc(slot: &astbox_core::container::KeySlot) -> String {
    format!(
        "slot[{}] TOTP-{} {} (m={} KiB, t={}, p={})",
        slot.index,
        slot.totp_digits().unwrap_or(0),
        slot.kdf_label(),
        slot.argon2_memory_kib,
        slot.argon2_time,
        slot.argon2_parallelism
    )
}

// ------------------------------------------------------- arg parsing

#[derive(Default)]
struct Args {
    cmd: String,
    file: String,
    totp: Option<String>,
    list: bool,
    verify: bool,
    out: String,
    path: String,
    totp_code: Option<String>,
    totp_secret: Option<String>,
    qr: Option<String>,
    totp_digits: Option<u8>,
    seed_dir: Option<String>,
    demo: bool,
    profile: String,
    from_dir: String,
}

#[derive(Clone, Copy, PartialEq)]
enum OptKind {
    Value,
    Choice6_8,
    ChoiceProfile,
}

struct Spec {
    usage: &'static str,
    value_opts: &'static [(&'static str, OptKind)],
    flags: &'static [&'static str],
    required_opts: &'static [&'static str],
    takes_file: bool,
}

fn specs() -> HashMap<&'static str, Spec> {
    HashMap::from([
        (
            "selftest",
            Spec {
                usage: SELFTEST_HELP,
                value_opts: &[],
                flags: &[],
                required_opts: &[],
                takes_file: false,
            },
        ),
        (
            "info",
            Spec {
                usage: INFO_HELP,
                value_opts: &[],
                flags: &[],
                required_opts: &[],
                takes_file: true,
            },
        ),
        (
            "unlock",
            Spec {
                usage: UNLOCK_HELP,
                value_opts: &[("--totp", OptKind::Value)],
                flags: &["--list", "--verify"],
                required_opts: &[],
                takes_file: true,
            },
        ),
        (
            "extract",
            Spec {
                usage: EXTRACT_HELP,
                value_opts: &[
                    ("--out", OptKind::Value),
                    ("--totp", OptKind::Value),
                    ("--path", OptKind::Value),
                ],
                flags: &["--verify"],
                required_opts: &["--out"],
                takes_file: true,
            },
        ),
        (
            "create",
            Spec {
                usage: CREATE_HELP,
                value_opts: &[
                    ("--totp-code", OptKind::Value),
                    ("--totp-secret", OptKind::Value),
                    ("--qr", OptKind::Value),
                    ("--totp-digits", OptKind::Choice6_8),
                    ("--seed-dir", OptKind::Value),
                    ("--profile", OptKind::ChoiceProfile),
                ],
                flags: &["--demo"],
                required_opts: &[],
                takes_file: true,
            },
        ),
        (
            "add",
            Spec {
                usage: ADD_HELP,
                value_opts: &[
                    ("--from-dir", OptKind::Value),
                    ("--out", OptKind::Value),
                    ("--totp", OptKind::Value),
                ],
                flags: &[],
                required_opts: &["--from-dir"],
                takes_file: true,
            },
        ),
    ])
}

fn usage_error(message: &str) -> ! {
    eprint!("{}", MAIN_USAGE);
    eprintln!("{}: error: {}", PROG, message);
    exit(2)
}

fn sub_usage_error(cmd: &str, message: &str) -> ! {
    eprint!("{}", specs()[cmd].usage);
    eprintln!("{} {}: error: {}", PROG, cmd, message);
    exit(2)
}

fn parse_args(argv: &[String]) -> Args {
    if argv.is_empty() {
        usage_error("the following arguments are required: cmd");
    }

    let mut args = Args::default();

    if argv[0] == "-h" || argv[0] == "--help" {
        print!("{}", MAIN_USAGE);
        exit(0);
    }
    args.cmd = argv[0].clone();
    let spec = match specs().get(args.cmd.as_str()) {
        Some(s) => Spec {
            usage: s.usage,
            value_opts: s.value_opts,
            flags: s.flags,
            required_opts: s.required_opts,
            takes_file: s.takes_file,
        },
        None => usage_error(&format!(
            "argument cmd: invalid choice: '{}' (choose from {})",
            argv[0], CHOICES
        )),
    };

    let mut values: HashMap<String, String> = HashMap::new();
    let mut flags: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut got_file = false;

    let mut i = 1;
    while i < argv.len() {
        let a = argv[i].clone();
        if a == "-h" || a == "--help" {
            print!("{}", spec.usage);
            exit(0);
        }
        if a.starts_with('-') && a != "-" {
            let mut name = a.clone();
            let mut inline_value = String::new();
            let mut has_inline = false;
            if let Some(eq) = a.find('=') {
                if a.starts_with("--") {
                    name = a[..eq].to_string();
                    inline_value = a[eq + 1..].to_string();
                    has_inline = true;
                }
            }
            if spec.flags.contains(&name.as_str()) {
                flags.insert(name); // argparse store_true: idempotent
                i += 1;
                continue;
            }
            if let Some(&kind) = spec
                .value_opts
                .iter()
                .find(|(n, _)| *n == name.as_str())
                .map(|(_, k)| k)
            {
                let val = if has_inline {
                    inline_value
                } else {
                    if i + 1 >= argv.len() {
                        sub_usage_error(
                            &args.cmd,
                            &format!("argument {}: expected one argument", name),
                        );
                    }
                    i += 1;
                    argv[i].clone()
                };
                if kind == OptKind::Choice6_8 && val != "6" && val != "8" {
                    sub_usage_error(
                        &args.cmd,
                        &format!(
                            "argument {}: invalid choice: '{}' (choose from '6', '8')",
                            name, val
                        ),
                    );
                }
                if kind == OptKind::ChoiceProfile && val != "high" && val != "constrained" {
                    sub_usage_error(
                        &args.cmd,
                        &format!(
                            "argument {}: invalid choice: '{}' (choose from 'high', 'constrained')",
                            name, val
                        ),
                    );
                }
                values.insert(name, val); // last occurrence wins
                i += 1;
                continue;
            }
            sub_usage_error(&args.cmd, &format!("unrecognized arguments: {}", a));
        }
        if got_file {
            // argparse reports surplus positionals as unrecognized args
            let rest = argv[i..].join(" ");
            sub_usage_error(&args.cmd, &format!("unrecognized arguments: {}", rest));
        }
        got_file = true;
        args.file = a;
        i += 1;
    }

    for req in spec.required_opts {
        if !values.contains_key(*req) {
            sub_usage_error(
                &args.cmd,
                &format!("the following arguments are required: {}", req),
            );
        }
    }
    if !got_file && spec.takes_file {
        sub_usage_error(&args.cmd, "the following arguments are required: file");
    }

    args.totp = values.get("--totp").cloned();
    args.out = values.get("--out").cloned().unwrap_or_default();
    args.path = values.get("--path").cloned().unwrap_or_default();
    args.totp_code = values.get("--totp-code").cloned();
    args.totp_secret = values.get("--totp-secret").cloned();
    args.qr = values.get("--qr").cloned();
    args.totp_digits = values.get("--totp-digits").and_then(|v| v.parse().ok());
    args.seed_dir = values.get("--seed-dir").cloned();
    args.profile = values.get("--profile").cloned().unwrap_or_else(|| "high".into());
    args.from_dir = values.get("--from-dir").cloned().unwrap_or_default();
    args.list = flags.contains("--list");
    args.verify = flags.contains("--verify");
    args.demo = flags.contains("--demo");
    args
}

// ------------------------------------------------------ shared pieces

/// Port of astbox_cli._gather_totp(): prompt on stdout when
/// --totp is absent; empty input is E_NO_VALID_CREDENTIAL.
fn gather_totp(totp: Option<&str>) -> String {
    let value: Option<String> = match totp {
        Some(t) => Some(t.to_string()),
        None => {
            print!("TOTP code: ");
            let _ = std::io::stdout().flush();
            let mut line = String::new();
            match std::io::stdin().read_line(&mut line) {
                Ok(_) => Some(line.trim().to_string()),
                Err(_) => None,
            }
        }
    };
    match value {
        Some(v) if !v.trim().is_empty() => v,
        _ => {
            exit_with_error(AstboxError::new(
                E::NoValidCredential,
                "a TOTP code is required (use --totp or run interactively)",
            ));
        }
    }
}

fn exit_with_error(exc: AstboxError) -> ! {
    eprintln!("error: {}: {}", exc.code_name(), exc.message);
    exit(1)
}

// ---------------------------------------------------------- commands

fn cmd_selftest() -> astbox_core::Result<()> {
    for line in Crypto::selftest()? {
        println!("  OK  {}", line);
    }
    println!("cryptographic self-tests passed");
    Ok(())
}

fn cmd_info(args: &Args) -> astbox_core::Result<()> {
    let pc = Container::parse_container(&args.file, None)?;
    let h = &pc.header;
    let magic_ascii: String = h
        .magic
        .iter()
        .map(|&b| if b < 0x80 { b as char } else { '?' })
        .collect();
    println!("file        : {}", abspath(&args.file));
    println!(
        "size        : {} ({} bytes)",
        human(pc.raw.len() as i64),
        pc.raw.len()
    );
    println!("magic       : {}", magic_ascii);
    println!("version     : {}", h.version);
    println!("vault id    : {}", hex(&h.vault_id));
    println!("generation  : {}", h.generation);
    println!(
        "key slots   : {} (region {}..{})",
        h.key_slot_count,
        h.key_slot_offset,
        h.key_slot_offset + h.key_slot_length
    );
    for slot in &pc.slots {
        println!("    {}", slot_desc(slot));
        println!("        slot id : {}", hex(&slot.slot_id));
    }
    println!(
        "metadata    : offset {} length {}",
        h.metadata_offset, h.metadata_length
    );
    println!("data        : offset {} length {}", h.data_offset, h.data_length);
    println!(
        "footer      : offset {} length {}",
        h.footer_offset, h.footer_length
    );
    println!("footer mac  : {}", hex(&pc.footer.footer_mac));
    println!("metadata dg : {}", hex(&pc.footer.metadata_digest));
    println!("data dg     : {}", hex(&pc.footer.data_digest));
    Ok(())
}

fn cmd_unlock(args: &Args) -> astbox_core::Result<()> {
    let pc = Container::parse_container(&args.file, None)?;
    let totp = gather_totp(args.totp.as_deref());
    let uc = Container::unlock_parsed(pc, Some(&totp), None)?;
    println!("unlocked OK");
    println!("vault id   : {}", hex(&uc.parsed.header.vault_id));
    println!("generation : {}", uc.parsed.header.generation);
    println!("created    : {}", fmt_time(uc.created));
    println!("modified   : {}", fmt_time(uc.modified));
    let n_files = uc.entries.values().filter(|e| e.is_file()).count();
    let n_dirs = uc.entries.values().filter(|e| e.is_dir()).count();
    let total: i64 = uc
        .entries
        .values()
        .filter(|e| e.is_file())
        .map(|e| e.size as i64)
        .sum();
    println!(
        "entries    : {} files ({}), {} directories",
        n_files,
        human(total),
        n_dirs
    );
    if args.verify {
        Container::verify_full(&uc)?;
        println!("verify     : all Data Records authenticated OK");
    }
    if args.list {
        println!("\ncontents:");
        let mut listing = Container::walk_entries(&uc);
        listing.sort_by(|a, b| cmp_ordinal(&a.0, &b.0));
        for (path, entry) in listing {
            let shown = if entry.is_dir() {
                format!("{}/", path)
            } else {
                path
            };
            let padded = format!("{:<40}", shown);
            if entry.is_dir() {
                println!("    {} <dir>", padded);
            } else {
                println!("    {} {}", padded, human(entry.size as i64));
            }
        }
    }
    Ok(())
}

fn cmd_extract(args: &Args) -> astbox_core::Result<()> {
    let pc = Container::parse_container(&args.file, None)?;
    let totp = gather_totp(args.totp.as_deref());
    let uc = Container::unlock_parsed(pc, Some(&totp), None)?;
    if args.verify {
        Container::verify_full(&uc)?;
        println!("verify: all Data Records authenticated OK");
    }
    std::fs::create_dir_all(&args.out)
        .map_err(|e| astbox_core::err!(E::Io, "cannot create {}: {}", args.out, e))?;
    // NOTE: the python reference builds a throttled progress callback in
    // cmd_extract but never passes it to extract.extract_path; parity
    // means we do not print per-file progress either.
    let results = Extractor::extract_path(&uc, &args.path, &args.out)?;
    println!(
        "extracted {} file(s) to {}",
        results.len(),
        abspath(&args.out)
    );
    Ok(())
}

fn demo_files() -> Vec<(String, Vec<u8>)> {
    let text = b"ASTBOX v1.0 demo file.\n\nThis container was created by astbox-cli create --demo.\n";
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

/// Enumerate files under `dir` as (relative logical path, bytes).
/// The C# original enumerates in unspecified filesystem order; we sort by
/// relative path for determinism (sorted == NTFS index order in practice).
fn gather_dir_files(dir: &str) -> astbox_core::Result<Vec<(String, Vec<u8>)>> {
    fn walk(root: &str, cur: &str, out: &mut Vec<(String, Vec<u8>)>) -> astbox_core::Result<()> {
        for entry in std::fs::read_dir(cur).map_err(|e| {
            astbox_core::err!(E::Io, "cannot read {}: {}", cur, e)
        })? {
            let entry = entry.map_err(|e| astbox_core::err!(E::Io, "readdir: {}", e))?;
            let p = entry.path();
            if p.is_dir() {
                walk(root, p.to_str().unwrap_or(""), out)?;
            } else if p.is_file() {
                let rel = p
                    .strip_prefix(root)
                    .unwrap_or(&p)
                    .to_string_lossy()
                    .replace('\\', "/");
                let data = std::fs::read(&p).map_err(|e| {
                    astbox_core::err!(E::Io, "cannot read {}: {}", p.display(), e)
                })?;
                out.push((rel, data));
            }
        }
        Ok(())
    }
    let mut out = Vec::new();
    walk(dir, dir, &mut out)?;
    out.sort_by(|a, b| cmp_ordinal(&a.0, &b.0));
    Ok(out)
}

fn cmd_create(args: &Args) -> astbox_core::Result<()> {
    let profile = if args.profile == "constrained" {
        Constants::KDF_PROFILE_MEMORY_CONSTRAINED
    } else {
        Constants::KDF_PROFILE_HIGH
    };
    let files: Vec<(String, Vec<u8>)> = if args.demo {
        demo_files()
    } else {
        Vec::new()
    };
    let mut totp_code: Option<String> = args.totp_code.clone();
    let mut qr_secret: Option<String> = None;
    let digits = args.totp_digits.unwrap_or(6);
    let mut provision: Option<(String, u8, String)> = None;

    if let Some(secret_arg) = &args.totp_secret {
        // normalize exactly like the python reference: strip/upper/
        // remove spaces, Base32-decode case-insensitively, re-encode
        let norm = secret_arg.trim().to_uppercase().replace(' ', "");
        let decoded = Crypto::base32_decode(&norm)?;
        let encoded = Crypto::base32_encode(&decoded);
        let code = Crypto::totp_at(&encoded, digits as u32, None)?;
        qr_secret = Some(encoded);
        totp_code = Some(code);
        provision = Some((qr_secret.clone().unwrap(), digits, args.file.clone()));
    } else if args.qr.is_some() || totp_code.is_none() {
        // TOTP 为唯一凭据：没有给密钥/验证码就自动生成一个
        let secret = QrUtil::generate_secret(20)?;
        let code = Crypto::totp_at(&secret, digits as u32, None)?;
        qr_secret = Some(secret.clone());
        totp_code = Some(code);
        provision = Some((secret, digits, args.file.clone()));
    }

    let uc: UnlockedContainer;
    if let Some(secret) = &qr_secret {
        uc = Creator::create_container(
            &args.file,
            &CreateParams {
                totp_digits: digits,
                files,
                seed_dir: args.seed_dir.as_ref().map(PathBuf::from),
                kdf_profile: profile,
                totp_secret: Some(secret),
                ..Default::default()
            },
        )?;
    } else {
        uc = Creator::create_container(
            &args.file,
            &CreateParams {
                totp_code: totp_code.as_deref(),
                totp_digits: digits,
                files,
                seed_dir: args.seed_dir.as_ref().map(PathBuf::from),
                kdf_profile: profile,
                ..Default::default()
            },
        )?;
    }

    let size = std::fs::metadata(&args.file)
        .map(|m| m.len())
        .unwrap_or(0);
    println!(
        "created {} ({}), {} entries, generation {}",
        abspath(&args.file),
        human(size as i64),
        uc.entries.len(),
        uc.parsed.header.generation
    );

    if let Some(prov) = &provision {
        println!("TOTP provisioning (add to your authenticator):");
        println!("  Base32: {}", prov.0);
        println!(
            "  otpauth://totp/ASTBOX:{}?secret={}&issuer=ASTBOX&algorithm=SHA1&digits={}&period=30",
            basename(&prov.2),
            prov.0,
            prov.1
        );
    }
    if let Some(qr) = &args.qr {
        if let Some(secret) = &qr_secret {
            let uri = QrUtil::build_otpauth_uri(secret, digits, &format!("ASTBOX:{}", basename(&args.file)));
            QrUtil::save_qr_png(&uri, qr)?;
            println!("QR code saved to {}", abspath(qr));
        }
    }
    println!("self-verification: OK");
    Ok(())
}

fn cmd_add(args: &Args) -> astbox_core::Result<()> {
    let pc = Container::parse_container(&args.file, None)?;
    let totp = gather_totp(args.totp.as_deref());
    let uc = Container::unlock_parsed(pc, Some(&totp), None)?;
    let files = gather_dir_files(&args.from_dir)?;
    if files.is_empty() {
        return Err(astbox_core::err!(
            E::InvalidArgument,
            "no files found in {}",
            args.from_dir
        ));
    }
    let out_path = if !args.out.is_empty() {
        args.out.clone()
    } else {
        args.file.clone()
    };
    let uc2 = Modifier::add_files(&uc, &files, &out_path, Some(&totp))?
        .expect("self-verification returns the reopened container");
    println!(
        "added {} file(s); new generation {} -> {}",
        files.len(),
        uc.parsed.header.generation,
        uc2.parsed.header.generation
    );
    println!("written to {}", abspath(&out_path));
    Ok(())
}

// --------------------------------------------------------------- main

fn run(argv: &[String]) -> i32 {
    let args = parse_args(argv);
    let result = match args.cmd.as_str() {
        "selftest" => cmd_selftest(),
        "info" => cmd_info(&args),
        "unlock" => cmd_unlock(&args),
        "extract" => cmd_extract(&args),
        "create" => cmd_create(&args),
        "add" => cmd_add(&args),
        _ => Ok(()),
    };
    match result {
        Ok(()) => 0,
        Err(exc) => {
            eprintln!("error: {}: {}", exc.code_name(), exc.message);
            1
        }
    }
}

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let code = run(&argv);
    exit(code)
}
