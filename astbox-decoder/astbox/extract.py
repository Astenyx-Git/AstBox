# -*- coding: utf-8 -*-
"""Extract files from an unlocked ASTBOX container to a local directory.

Path safety: names were already validated at metadata level (no
separators, no NUL, not "." / ".."), so joining them cannot escape the
output directory; we still normalize and double-check containment.
"""
import os

from . import container as cont
from .errors import AstboxError, E_IO, E_WRITE


def _safe_join(out_dir, rel_parts):
    base = os.path.normpath(os.path.abspath(out_dir))
    target = os.path.abspath(os.path.join(out_dir, *rel_parts))
    norm = os.path.normpath(target)
    if not (norm == base or norm.startswith(base + os.sep)):
        raise AstboxError(E_WRITE, "refusing to write outside output dir")
    return norm


def extract_entry(uc, entry, out_dir, progress=None):
    """Extract one file (or create one directory) below out_dir.

    Returns the absolute path written.
    """
    rel = cont.entry_path_parts(uc, entry)
    target = _safe_join(out_dir, rel)
    if entry.is_dir:
        os.makedirs(target, exist_ok=True)
        return target
    parent = os.path.dirname(target)
    try:
        os.makedirs(parent, exist_ok=True)
        with open(target, "wb") as f:
            written = 0
            for chunk in cont.iter_file_plaintext(uc, entry):
                f.write(chunk)
                written += len(chunk)
                if progress is not None:
                    progress(entry, written, entry.size)
            f.flush()
            os.fsync(f.fileno())
    except OSError as exc:
        raise AstboxError(E_IO, "cannot write %s: %s" % (target, exc))
    return target


def extract_all(uc, out_dir, progress=None, skip_existing=True):
    """Extract every file in the container below out_dir.

    progress: optional callable(stage_str, done_count, total).
    Returns list of (logical_path, abs_path).
    """
    items = [(p, e) for p, e in cont.walk_entries(uc) if e.is_file]
    total = len(items)
    results = []
    for i, (path, entry) in enumerate(items, 1):
        if progress is not None:
            progress("extracting %s (%d/%d)" % (path, i, total), i, total)
        target = extract_entry(uc, entry, out_dir)
        results.append((path, target))
    return results


def extract_path(uc, logical_path, out_dir):
    """Extract a single file by logical path ('' -> all)."""
    if not logical_path:
        return extract_all(uc, out_dir)
    for p, e in cont.walk_entries(uc):
        if p == logical_path:
            if e.is_dir:
                raise AstboxError(E_WRITE,
                                  "%r is a directory; extract its files "
                                  "individually" % logical_path)
            return [extract_entry(uc, e, out_dir)]
    raise AstboxError(E_WRITE, "no such entry: %r" % logical_path)
