// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
//! ASTBOX v1.0 modification: add files to an unlocked container
//! (port of astbox/modify.py; doc 03 §67/76/77/79-83).

using System.Buffers.Binary;
using System.Text;

namespace Astbox;

public static class Modifier
{
    private sealed class Node
    {
        public byte[] Id = null!;
        public byte[] Parent = null!;
        public string Name = "";
        public byte Type;
        public ulong Size;
        public byte[] Data = null!;
        public ulong Modified;
    }

    private sealed class RecordFile
    {
        public required string Kind;          // "old" | "new"
        public required byte[] FileId;
        public Entry? OldEntry;
        public Node? NewNode;
        public IReadOnlyList<DataChunk>? Chunks;
    }

    private static void ValidateName(string name)
    {
        if (string.IsNullOrEmpty(name))
            throw new AstboxError(E.InvalidFileName, "empty entry name");
        if (name is "." or "..")
            throw new AstboxError(E.InvalidFileName, "name '.'/'..' forbidden");
        if (name.Contains('/') || name.Contains('\\') || name.Contains('\0'))
            throw new AstboxError(E.InvalidFileName,
                "name contains path separator or NUL");
    }

    private static CborValue EntryCbor(byte[] fileId, byte[] parentId,
        byte type, string name, ulong size, ulong start, ulong length,
        ulong modified, ulong mode)
    {
        return CborValue.Map(
            ((ulong)Constants.EntryKeyFileId, CborValue.Bytes(fileId)),
            ((ulong)Constants.EntryKeyParent, CborValue.Bytes(parentId)),
            ((ulong)Constants.EntryKeyType, CborValue.UInt(type)),
            ((ulong)Constants.EntryKeyName,
                CborValue.Text(name.Normalize(NormalizationForm.FormC))),
            ((ulong)Constants.EntryKeySize, CborValue.UInt(size)),
            ((ulong)Constants.EntryKeyDataStart, CborValue.UInt(start)),
            ((ulong)Constants.EntryKeyDataLength, CborValue.UInt(length)),
            ((ulong)8, CborValue.UInt(modified)),
            ((ulong)9, CborValue.UInt(mode)));
    }

    /// <summary>Add files ({logical_path: bytes}) to an unlocked container and
    /// write the new generation to out_path. Returns the re-opened
    /// UnlockedContainer (self-verified), or null without a TOTP code.</summary>
    public static UnlockedContainer? AddFiles(UnlockedContainer uc,
        IReadOnlyCollection<KeyValuePair<string, byte[]>> files,
        string outPath, string? totp = null)
    {
        if (files.Count == 0)
            throw new AstboxError(E.InvalidArgument, "no files to add");
        var parsed = uc.Parsed;
        var header = parsed.Header;

        ulong newGen = header.Generation + 1;
        if (newGen == 0)
            throw new AstboxError(E.StaleGeneration,
                "Generation is at the maximum representable value");

        long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var usedIds = new HashSet<byte[]>(ByteArrayComparer.Instance);
        foreach (var id in uc.Entries.Keys) usedIds.Add(id);
        usedIds.Add(Constants.RootDirectoryId);

        byte[] NewId()
        {
            while (true)
            {
                var fid = Crypto.RandomBytes(16);
                if (!fid.AsSpan().SequenceEqual(Constants.RootDirectoryId)
                    && usedIds.Add(fid))
                    return fid;
            }
        }

        // --- existing logical path map ------------------------------------
        var existingPaths = new Dictionary<string, Entry>(StringComparer.Ordinal);
        foreach (var e in uc.Entries.Values)
            existingPaths[string.Join('/',
                Container.EntryPathParts(uc, e))] = e;

        // --- plan new nodes -------------------------------------------------
        var newNodes = new Dictionary<string, Node>(StringComparer.Ordinal);
        var fileOrder = new List<string>();

        byte[] EnsureDir(string dpath)
        {
            if (dpath.Length == 0) return Constants.RootDirectoryId;
            if (existingPaths.TryGetValue(dpath, out var ee))
            {
                if (!ee.IsDir)
                    throw new AstboxError(E.InvalidFileName,
                        $"'{dpath}' is not a directory");
                return ee.FileId;
            }
            if (newNodes.TryGetValue(dpath, out var nn))
            {
                if (nn.Type != Constants.TypeDirectory)
                    throw new AstboxError(E.InvalidFileName,
                        $"'{dpath}' is not a directory");
                return nn.Id;
            }
            var parts = dpath.Split('/');
            var parent = EnsureDir(string.Join('/', parts[..^1]));
            ValidateName(parts[^1]);
            var node = new Node
            {
                Id = NewId(), Parent = parent, Name = parts[^1],
                Type = Constants.TypeDirectory, Size = 0,
                Modified = (ulong)now,
            };
            newNodes[dpath] = node;
            return node.Id;
        }

        foreach (var (path, data) in files)
        {
            var parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0)
                throw new AstboxError(E.InvalidArgument, $"empty path '{path}'");
            var parentId = EnsureDir(string.Join('/', parts[..^1]));
            string full = string.Join('/', parts);
            if (existingPaths.ContainsKey(full))
                throw new AstboxError(E.AlreadyExists,
                    $"'{full}' already exists in the container");
            if (newNodes.ContainsKey(full))
                throw new AstboxError(E.AlreadyExists,
                    $"duplicate path '{full}'");
            ValidateName(parts[^1]);
            newNodes[full] = new Node
            {
                Id = NewId(), Parent = parentId, Name = parts[^1],
                Type = Constants.TypeFile, Size = (ulong)data.Length,
                Data = data, Modified = (ulong)now,
            };
            fileOrder.Add(full);
        }

        // --- record-bearing files ------------------------------------------
        var recordFiles = new List<RecordFile>();
        foreach (var e in uc.Entries.Values)
        {
            if (e.IsFile && e.Size > 0)
                recordFiles.Add(new RecordFile
                {
                    Kind = "old", FileId = e.FileId, OldEntry = e,
                    Chunks = uc.Chunks[e.FileId],
                });
        }
        foreach (var path in fileOrder)
        {
            var node = newNodes[path];
            if (node.Size > 0)
                recordFiles.Add(new RecordFile
                {
                    Kind = "new", FileId = node.Id, NewNode = node,
                });
        }
        recordFiles.Sort((a, b) =>
            a.FileId.AsSpan().SequenceCompareTo(b.FileId));

        ulong metaOffset = header.MetadataOffset;   // unchanged (slots fixed)

        (byte[] Cbor, Dictionary<byte[], (ulong Start, ulong Len)> Layout)
            BuildMetadata(ulong dataOffset)
        {
            var layout =
                new Dictionary<byte[], (ulong, ulong)>(ByteArrayComparer.Instance);
            ulong pos = 0;
            foreach (var rf in recordFiles)
            {
                ulong length;
                if (rf.Kind == "old")
                {
                    length = rf.Chunks!.Aggregate(
                        0UL,
                        (acc, c) => acc + (ulong)Constants.DataRecordOverhead
                                      + c.PlaintextLength);
                }
                else
                {
                    length = 0;
                    for (ulong off = 0; off < rf.NewNode!.Size;
                         off += (ulong)Constants.MaxChunkPlaintext)
                    {
                        length += (ulong)Constants.DataRecordOverhead +
                            Math.Min((ulong)Constants.MaxChunkPlaintext,
                                rf.NewNode.Size - off);
                    }
                }
                layout[rf.FileId] = (dataOffset + pos, length);
                pos += length;
            }

            var entryList = new List<CborValue>();
            foreach (var e in uc.Entries.Values
                         .OrderBy(x => x.FileId, ByteArrayOrderComparer.Instance))
            {
                var (s, l) = layout.TryGetValue(e.FileId,
                    out var found) ? found : (0UL, 0UL);
                entryList.Add(EntryCbor(e.FileId, e.ParentId, e.EntryType,
                    e.Name, e.Size, s, l, e.Modified, e.FileMode));
            }
            foreach (var path in newNodes.Keys
                         .OrderBy(p => p.Count(c => c == '/'))
                         .ThenBy(p => p, StringComparer.Ordinal))
            {
                var node = newNodes[path];
                var (s, l) = layout.TryGetValue(node.Id,
                    out var found) ? found : (0UL, 0UL);
                entryList.Add(EntryCbor(node.Id, node.Parent, node.Type,
                    node.Name, node.Size, s, l,
                    node.Modified != 0 ? node.Modified : (ulong)now, 0));
            }
            var meta = CborValue.Map(
                ((ulong)Constants.MetaKeyVersion, CborValue.UInt(1)),
                ((ulong)Constants.MetaKeyRoot,
                    CborValue.Bytes(Constants.RootDirectoryId)),
                ((ulong)Constants.MetaKeyEntries, CborValue.Arr(entryList)),
                ((ulong)Constants.MetaKeyCreated, CborValue.UInt(uc.Created)),
                ((ulong)Constants.MetaKeyModified, CborValue.UInt((ulong)now)));
            return (CborDet.Dumps(meta), layout);
        }

        // --- iterative layout -----------------------------------------------
        ulong? dataOffsetIter = null;
        bool converged = false;
        for (int attempt = 0; attempt < 8; attempt++)
        {
            var probe = BuildMetadata(dataOffsetIter ?? 0).Cbor;
            ulong metaLength = (ulong)probe.Length + 24 + 16;
            ulong candidate = metaOffset + metaLength;
            if (dataOffsetIter is { } existing && candidate == existing)
            {
                converged = true;
                break;
            }
            dataOffsetIter = candidate;
        }
        if (!converged || dataOffsetIter is null)
            throw new AstboxError(E.InvalidArgument,
                "layout did not converge");

        // --- assemble the new Data region -------------------------------------
        var newRegion = new List<byte>();
        var keys = uc.Keys;
        var vaultId = header.VaultId;
        ulong oldGen = header.Generation;

        byte[] DataAd(ulong gen, byte[] fid, ulong cidx, uint plen)
        {
            var ad = new byte[Constants.LabelData.Length + 16 + 8 + 16 + 8 + 4];
            int o = 0;
            Constants.LabelData.CopyTo(ad);
            o += Constants.LabelData.Length;
            vaultId.CopyTo(ad, o); o += 16;
            BinaryPrimitives.WriteUInt64BigEndian(ad.AsSpan(o), gen); o += 8;
            fid.CopyTo(ad, o); o += 16;
            BinaryPrimitives.WriteUInt64BigEndian(ad.AsSpan(o), cidx); o += 8;
            BinaryPrimitives.WriteUInt32BigEndian(ad.AsSpan(o), plen);
            return ad;
        }

        foreach (var rf in recordFiles)
        {
            if (rf.Kind == "old")
            {
                foreach (var c in rf.Chunks!.OrderBy(c => c.ChunkIndex))
                {
                    var ctTag = new byte[c.Ciphertext.Length + c.Tag.Length];
                    c.Ciphertext.CopyTo(ctTag, 0);
                    c.Tag.CopyTo(ctTag, c.Ciphertext.Length);
                    var plain = Crypto.AeadDecrypt(keys.Data, c.Nonce, ctTag,
                        DataAd(oldGen, rf.FileId, c.ChunkIndex,
                            c.PlaintextLength));
                    var nonce = Crypto.RandomBytes(24);
                    var ct2 = Crypto.AeadEncrypt(keys.Data, nonce, plain,
                        DataAd(newGen, rf.FileId, c.ChunkIndex,
                            c.PlaintextLength));
                    newRegion.AddRange(rf.FileId);
                    Span<byte> hdr = stackalloc byte[12];
                    BinaryPrimitives.WriteUInt64BigEndian(hdr, c.ChunkIndex);
                    BinaryPrimitives.WriteUInt32BigEndian(hdr[8..], c.PlaintextLength);
                    newRegion.AddRange(hdr.ToArray());
                    newRegion.AddRange(nonce);
                    newRegion.AddRange(ct2);
                }
            }
            else
            {
                var data = rf.NewNode!.Data;
                ulong cidx = 0;
                for (int idx = 0; idx < data.Length;
                     idx += Constants.MaxChunkPlaintext, cidx++)
                {
                    int chunkLen = Math.Min(Constants.MaxChunkPlaintext,
                        data.Length - idx);
                    var chunk = data.AsSpan(idx, chunkLen).ToArray();
                    var nonce = Crypto.RandomBytes(24);
                    var ct = Crypto.AeadEncrypt(keys.Data, nonce, chunk,
                        DataAd(newGen, rf.FileId, cidx, (uint)chunkLen));
                    newRegion.AddRange(rf.FileId);
                    Span<byte> hdr = stackalloc byte[12];
                    BinaryPrimitives.WriteUInt64BigEndian(hdr, cidx);
                    BinaryPrimitives.WriteUInt32BigEndian(hdr[8..], (uint)chunkLen);
                    newRegion.AddRange(hdr.ToArray());
                    newRegion.AddRange(nonce);
                    newRegion.AddRange(ct);
                }
            }
        }

        ulong dataLength = (ulong)newRegion.Count;
        ulong footerOffset = dataOffsetIter!.Value + dataLength;

        // --- metadata record ---------------------------------------------------
        var (metaCborFinal, _) = BuildMetadata(dataOffsetIter.Value);
        var metaNonce = Crypto.RandomBytes(24);
        var metaAd = new byte[Constants.LabelMetadata.Length + 16 + 8];
        Constants.LabelMetadata.CopyTo(metaAd);
        vaultId.CopyTo(metaAd, Constants.LabelMetadata.Length);
        BinaryPrimitives.WriteUInt64BigEndian(
            metaAd.AsSpan(Constants.LabelMetadata.Length + 16), newGen);
        var metaCt = Crypto.AeadEncrypt(keys.Metadata, metaNonce,
            metaCborFinal, metaAd);
        var metadataRecord = new byte[24 + metaCt.Length];
        metaNonce.CopyTo(metadataRecord, 0);
        metaCt.CopyTo(metadataRecord, 24);

        // --- footer --------------------------------------------------------------
        var footer = new byte[Constants.FooterSize];
        Constants.FooterMagic.CopyTo(footer);
        BinaryPrimitives.WriteUInt16BigEndian(footer.AsSpan(8), Constants.Version);
        BinaryPrimitives.WriteUInt16BigEndian(footer.AsSpan(10), 0);
        BinaryPrimitives.WriteUInt64BigEndian(footer.AsSpan(12), newGen);
        BinaryPrimitives.WriteUInt64BigEndian(footer.AsSpan(20),
            footerOffset + (ulong)Constants.FooterSize);
        Crypto.Sha256First16(metadataRecord).CopyTo(footer, 28);
        Crypto.Sha256First16(newRegion.ToArray()).CopyTo(footer, 44);
        var footerWithoutMac = new byte[112];
        Buffer.BlockCopy(footer, 0, footerWithoutMac, 0, 60);
        Buffer.BlockCopy(footer, 76, footerWithoutMac, 76, 36);
        var fMacInput = new byte[Constants.LabelFooterMac.Length + 112];
        Constants.LabelFooterMac.CopyTo(fMacInput);
        footerWithoutMac.CopyTo(fMacInput, Constants.LabelFooterMac.Length);
        Crypto.HmacSha256Trunc16(keys.Footer, fMacInput).CopyTo(footer, 60);

        // --- header (slots byte-identical to the original) -----------------------
        int slotRegionStart = (int)header.KeySlotOffset;
        int slotRegionLen = (int)(header.MetadataOffset - header.KeySlotOffset);
        var slotBytes = parsed.Raw.AsSpan(slotRegionStart, slotRegionLen).ToArray();

        var headerBlob = new byte[Constants.HeaderSize];
        Constants.HeaderMagic.CopyTo(headerBlob);
        BinaryPrimitives.WriteUInt16BigEndian(headerBlob.AsSpan(6), Constants.Version);
        BinaryPrimitives.WriteUInt32BigEndian(headerBlob.AsSpan(8), 0);
        vaultId.CopyTo(headerBlob, 12);
        BinaryPrimitives.WriteUInt64BigEndian(headerBlob.AsSpan(28), newGen);
        BinaryPrimitives.WriteUInt64BigEndian(headerBlob.AsSpan(36), Constants.HeaderSize);
        BinaryPrimitives.WriteUInt64BigEndian(headerBlob.AsSpan(44),
            (ulong)slotRegionLen);
        BinaryPrimitives.WriteUInt64BigEndian(headerBlob.AsSpan(52), metaOffset);
        BinaryPrimitives.WriteUInt64BigEndian(headerBlob.AsSpan(60),
            (ulong)metadataRecord.Length);
        BinaryPrimitives.WriteUInt64BigEndian(headerBlob.AsSpan(68),
            dataOffsetIter.Value);
        BinaryPrimitives.WriteUInt64BigEndian(headerBlob.AsSpan(76), dataLength);
        BinaryPrimitives.WriteUInt64BigEndian(headerBlob.AsSpan(84), footerOffset);
        BinaryPrimitives.WriteUInt64BigEndian(headerBlob.AsSpan(92), Constants.FooterSize);
        BinaryPrimitives.WriteUInt32BigEndian(headerBlob.AsSpan(100),
            header.KeySlotCount);
        BinaryPrimitives.WriteUInt32BigEndian(headerBlob.AsSpan(104), Constants.HeaderSize);
        var hWithoutMac = new byte[128];
        Buffer.BlockCopy(headerBlob, 0, hWithoutMac, 0, 108);
        Buffer.BlockCopy(headerBlob, 124, hWithoutMac, 124, 4);
        var hMacInput = new byte[Constants.LabelHeaderMac.Length + 128];
        Constants.LabelHeaderMac.CopyTo(hMacInput);
        hWithoutMac.CopyTo(hMacInput, Constants.LabelHeaderMac.Length);
        Crypto.HmacSha256Trunc16(keys.Header, hMacInput).CopyTo(headerBlob, 108);

        // --- atomic commit ---------------------------------------------------------
        string tmpPath = outPath + ".tmp";
        try
        {
            using (var f = File.Create(tmpPath))
            {
                f.Write(headerBlob);
                f.Write(slotBytes);
                f.Write(metadataRecord);
                f.Write(newRegion.ToArray());
                f.Write(footer);
                f.Flush(flushToDisk: true);
            }
            File.Move(tmpPath, outPath, overwrite: true);
        }
        catch (Exception exc)
        {
            try { if (File.Exists(tmpPath)) File.Delete(tmpPath); }
            catch { /* best effort */ }
            throw new AstboxError(E.Io,
                $"cannot commit {outPath}: {exc.Message}");
        }

        // --- self-verification --------------------------------------------------------
        if (totp is not null)
            return Container.UnlockContainer(outPath, totp: totp);
        Container.ParseContainer(outPath);   // structural sanity check
        return null;
    }
}
