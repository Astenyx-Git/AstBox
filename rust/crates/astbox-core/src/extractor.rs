// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
//! Extract files from an unlocked ASTBOX container to a local directory
//! (port of Astbox.Core/Extractor.cs). Path safety: names were already
//! validated at metadata level; we still normalize and double-check containment.

use crate::container::{cmp_ordinal, Container, Entry, UnlockedContainer};
use crate::errors::E;
use crate::Result;

pub type EntryProgress<'a> = dyn FnMut(&Entry, u64, u64) + 'a;
pub type AllProgress<'a> = dyn FnMut(&str, usize, usize) + 'a;

/// Lexically normalize a path (collapse `.` and `..`) without touching the
/// filesystem — the moral equivalent of C# Path.GetFullPath for our use.
fn normalize_lexical(p: &std::path::Path) -> std::path::PathBuf {
    use std::path::Component;
    let mut out = std::path::PathBuf::new();
    for comp in p.components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn safe_join(out_dir: &str, rel_parts: &[String]) -> Result<std::path::PathBuf> {
    let base = normalize_lexical(std::path::Path::new(out_dir));
    let mut joined = std::path::PathBuf::from(out_dir);
    for part in rel_parts {
        joined.push(part);
    }
    let target = normalize_lexical(&joined);
    let base_s = base.to_string_lossy();
    let target_s = target.to_string_lossy();
    // Windows-style case-insensitive containment check (C# OrdinalIgnoreCase)
    let base_l = base_s.to_lowercase();
    let target_l = target_s.to_lowercase();
    let contained = target_l == base_l
        || target_l.starts_with(&format!("{}\\", base_l))
        || target_l.starts_with(&format!("{}/", base_l));
    if !contained {
        return Err(crate::err!(E::Write, "refusing to write outside output dir"));
    }
    Ok(target)
}

pub struct Extractor;

impl Extractor {
    /// Extract one file (or create one directory) below out_dir.
    /// Returns the absolute path written.
    pub fn extract_entry(
        uc: &UnlockedContainer,
        entry: &Entry,
        out_dir: &str,
        mut progress: Option<&mut EntryProgress>,
    ) -> Result<String> {
        let rel = Container::entry_path_parts(uc, entry);
        let target = safe_join(out_dir, &rel)?;
        if entry.is_dir() {
            std::fs::create_dir_all(&target)
                .map_err(|e| crate::err!(E::Io, "cannot create {}: {}", target.display(), e))?;
            return Ok(target.to_string_lossy().into_owned());
        }
        let parent = target.parent();
        if let Some(parent) = parent {
            std::fs::create_dir_all(parent).map_err(|e| {
                crate::err!(E::Io, "cannot create {}: {}", parent.display(), e)
            })?;
        }
        let mut written: u64 = 0;
        let chunks = Container::iter_file_plaintext(uc, entry)?;
        {
            use std::io::Write;
            let f = std::fs::File::create(&target).map_err(|e| {
                crate::err!(E::Io, "cannot write {}: {}", target.display(), e)
            })?;
            let mut w = std::io::BufWriter::new(f);
            for chunk in &chunks {
                w.write_all(chunk)
                    .map_err(|e| crate::err!(E::Io, "cannot write {}: {}", target.display(), e))?;
                written += chunk.len() as u64;
                if let Some(p) = progress.as_deref_mut() {
                    p(entry, written, entry.size);
                }
            }
            w.flush()
                .and_then(|_| w.into_inner().map_err(|e| e.into_error()))
                .and_then(|f| f.sync_all())
                .map_err(|e| crate::err!(E::Io, "cannot write {}: {}", target.display(), e))?;
        }
        Ok(target.to_string_lossy().into_owned())
    }

    /// Extract every file in the container below out_dir.
    /// `skip_existing` exists for signature parity with the C# original
    /// (which declares but never uses it).
    pub fn extract_all(
        uc: &UnlockedContainer,
        out_dir: &str,
        mut progress: Option<&mut AllProgress>,
        _skip_existing: bool,
    ) -> Result<Vec<(String, String)>> {
        let mut items: Vec<(String, Entry)> = Container::walk_entries(uc)
            .into_iter()
            .filter(|(_, e)| e.is_file())
            .collect();
        items.sort_by(|a, b| cmp_ordinal(&a.0, &b.0));
        let total = items.len();
        let mut results = Vec::with_capacity(total);
        for (i, (path, entry)) in items.iter().enumerate() {
            let i1 = i + 1;
            if let Some(p) = progress.as_deref_mut() {
                p(&format!("extracting {} ({}/{})", path, i1, total), i1, total);
            }
            let target = Self::extract_entry(uc, entry, out_dir, None)?;
            results.push((path.clone(), target));
        }
        Ok(results)
    }

    /// Extract a single file by logical path ('' → all).
    pub fn extract_path(
        uc: &UnlockedContainer,
        logical_path: &str,
        out_dir: &str,
    ) -> Result<Vec<String>> {
        if logical_path.is_empty() {
            return Ok(Self::extract_all(uc, out_dir, None, false)?
                .into_iter()
                .map(|(_, abs)| abs)
                .collect());
        }
        for (p, e) in Container::walk_entries(uc) {
            if p != logical_path {
                continue;
            }
            if e.is_dir() {
                return Err(crate::err!(
                    E::Write,
                    "'{}' is a directory; extract its files individually",
                    logical_path
                ));
            }
            return Ok(vec![Self::extract_entry(uc, &e, out_dir, None)?]);
        }
        Err(crate::err!(E::Write, "no such entry: '{}'", logical_path))
    }
}
