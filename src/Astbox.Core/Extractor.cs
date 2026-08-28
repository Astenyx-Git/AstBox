// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
//! Extract files from an unlocked ASTBOX container to a local directory
//! (port of astbox/extract.py). Path safety: names were already validated at
//! metadata level; we still normalize and double-check containment.

namespace Astbox;

public static class Extractor
{
    public delegate void EntryProgress(Entry entry, ulong written, ulong size);
    public delegate void AllProgress(string stage, int done, int total);

    private static string SafeJoin(string outDir, IEnumerable<string> relParts)
    {
        string baseDir = Path.GetFullPath(outDir);
        string target = Path.GetFullPath(
            Path.Combine(new[] { outDir }.Concat(relParts).ToArray()));
        if (!target.Equals(baseDir, StringComparison.OrdinalIgnoreCase) &&
            !target.StartsWith(baseDir + Path.DirectorySeparatorChar,
                StringComparison.OrdinalIgnoreCase))
            throw new AstboxError(E.Write,
                "refusing to write outside output dir");
        return target;
    }

    /// <summary>Extract one file (or create one directory) below out_dir.
    /// Returns the absolute path written.</summary>
    public static string ExtractEntry(UnlockedContainer uc, Entry entry,
        string outDir, EntryProgress? progress = null)
    {
        var rel = Container.EntryPathParts(uc, entry);
        string target = SafeJoin(outDir, rel);
        if (entry.IsDir)
        {
            Directory.CreateDirectory(target);
            return target;
        }
        string? parent = Path.GetDirectoryName(target);
        try
        {
            if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
            using var f = File.Create(target);
            ulong written = 0;
            foreach (var chunk in Container.IterFilePlaintext(uc, entry))
            {
                f.Write(chunk, 0, chunk.Length);
                written += (ulong)chunk.Length;
                progress?.Invoke(entry, written, entry.Size);
            }
            f.Flush(flushToDisk: true);
        }
        catch (Exception exc) when (exc is not AstboxError)
        {
            throw new AstboxError(E.Io,
                $"cannot write {target}: {exc.Message}");
        }
        return target;
    }

    /// <summary>Extract every file in the container below out_dir.</summary>
    public static List<(string LogicalPath, string AbsolutePath)> ExtractAll(
        UnlockedContainer uc, string outDir,
        AllProgress? progress = null, bool skipExisting = true)
    {
        var items = Container.WalkEntries(uc).Where(t => t.Entry.IsFile).ToList();
        int total = items.Count;
        var results = new List<(string, string)>(total);
        int i = 0;
        foreach (var (path, entry) in items)
        {
            i++;
            progress?.Invoke($"extracting {path} ({i}/{total})", i, total);
            string target = ExtractEntry(uc, entry, outDir);
            results.Add((path, target));
        }
        return results;
    }

    /// <summary>Extract a single file by logical path ('' → all).</summary>
    public static List<string> ExtractPath(UnlockedContainer uc,
        string logicalPath, string outDir)
    {
        if (string.IsNullOrEmpty(logicalPath))
            return ExtractAll(uc, outDir)
                .Select(r => r.AbsolutePath).ToList();
        foreach (var (p, e) in Container.WalkEntries(uc))
        {
            if (p != logicalPath) continue;
            if (e.IsDir)
                throw new AstboxError(E.Write,
                    $"'{logicalPath}' is a directory; extract its files " +
                    "individually");
            return new List<string> { ExtractEntry(uc, e, outDir) };
        }
        throw new AstboxError(E.Write, $"no such entry: '{logicalPath}'");
    }
}
