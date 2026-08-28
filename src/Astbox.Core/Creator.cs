// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
//! ASTBOX v1.0 container writer (port of astbox/create.py).
//! Fresh VaultID/VaultKey/salts/nonces, canonical CBOR metadata, chunked
//! encrypted Data Records ordered by FileID then ChunkIndex, footer digests
//! and MACs, header MAC last, Generation 0.

using System.Buffers.Binary;
using System.Text;

namespace Astbox;

public static class Creator
{
    /// <summary>Internal node used while building the entry tree.</summary>
    public sealed class Node
    {
        public byte[] Id = null!;
        public byte[] Parent = null!;
        public string Name = "";
        public byte Type;
        public ulong Size;
        public byte[]? Data;
        public ulong DataStart;
        public ulong DataLength;
        public ulong Modified;
    }

    private static void ValidatePathEntry(string name)
    {
        if (string.IsNullOrEmpty(name) || name is "." or "..")
            throw new AstboxError(E.InvalidFileName,
                $"bad entry name '{name}'");
        if (name.Contains('/') || name.Contains('\\') || name.Contains('\0'))
            throw new AstboxError(E.InvalidFileName,
                "entry name must not contain separators");
    }

    /// <summary>Turn {logical_path: bytes} into a nested structure with FileIDs.
    /// Returns (entries, fileOrder).</summary>
    public static (List<Node> Entries, List<string> FileOrder) BuildEntryMap(
        IReadOnlyCollection<KeyValuePair<string, byte[]>> files)
    {
        var rootId = Constants.RootDirectoryId;
        var nodes = new Dictionary<string, Node>(StringComparer.Ordinal);
        var dirs = new SortedSet<string>(StringComparer.Ordinal) { "" };
        var usedIds = new HashSet<byte[]>(ByteArrayComparer.Instance);

        byte[] NewId()
        {
            while (true)
            {
                var fid = Crypto.RandomBytes(16);
                if (!fid.AsSpan().SequenceEqual(rootId) && usedIds.Add(fid))
                    return fid;
            }
        }

        foreach (var (path, _) in files)
        {
            var parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0)
                throw new AstboxError(E.InvalidArgument,
                    $"empty path '{path}'");
            for (int i = 0; i < parts.Length - 1; i++)
            {
                string dpath = string.Join('/', parts[..(i + 1)]);
                ValidatePathEntry(parts[i]);
                dirs.Add(dpath);
            }
            ValidatePathEntry(parts[^1]);
        }

        // create directory nodes first (parents before children)
        foreach (var dpath in dirs.OrderBy(p => p.Count(c => c == '/'))
                     .ThenBy(p => p, StringComparer.Ordinal))
        {
            if (dpath.Length == 0) continue;
            var parts = dpath.Split('/');
            var parent = rootId;
            if (parts.Length > 1)
                parent = nodes[string.Join('/', parts[..^1])].Id;
            nodes[dpath] = new Node
            {
                Id = NewId(), Parent = parent, Name = parts[^1],
                Type = Constants.TypeDirectory, Size = 0,
            };
        }

        var fileOrder = new List<string>();
        foreach (var (path, data) in files)
        {
            var parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
            var parent = rootId;
            if (parts.Length > 1)
            {
                string dpath = string.Join('/', parts[..^1]);
                if (!nodes.TryGetValue(dpath, out var dn))
                    throw new AstboxError(E.InvalidArgument,
                        $"parent '{dpath}' missing");
                parent = dn.Id;
            }
            if (nodes.ContainsKey(path))
                throw new AstboxError(E.InvalidArgument,
                    $"path '{path}' is both file and directory");
            var fid = NewId();
            nodes[path] = new Node
            {
                Id = fid, Parent = parent, Name = parts[^1],
                Type = Constants.TypeFile, Size = (ulong)data.Length,
                Data = data,
            };
            fileOrder.Add(path);
        }

        return (nodes.Values.ToList(), fileOrder);
    }

    public static byte[] BuildMetadataCbor(IReadOnlyList<Node> entries,
        long? created = null, long? modified = null)
    {
        long now = created ?? DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        long mod = modified ?? now;

        var entryList = new List<CborValue>(entries.Count);
        foreach (var node in entries)
        {
            entryList.Add(CborValue.Map(
                ((ulong)Constants.EntryKeyFileId, CborValue.Bytes(node.Id)),
                ((ulong)Constants.EntryKeyParent, CborValue.Bytes(node.Parent)),
                ((ulong)Constants.EntryKeyType, CborValue.UInt(node.Type)),
                ((ulong)Constants.EntryKeyName,
                    CborValue.Text(node.Name.Normalize(NormalizationForm.FormC))),
                ((ulong)Constants.EntryKeySize, CborValue.UInt(node.Size)),
                ((ulong)Constants.EntryKeyDataStart,
                    CborValue.UInt(node.DataStart)),
                ((ulong)Constants.EntryKeyDataLength,
                    CborValue.UInt(node.DataLength)),
                ((ulong)Constants.EntryKeyModified,
                    CborValue.UInt(node.Modified != 0 ? node.Modified : (ulong)mod)),
                ((ulong)Constants.EntryKeyMode, CborValue.UInt(0))));
        }

        return CborDet.Dumps(CborValue.Map(
            ((ulong)Constants.MetaKeyVersion, CborValue.UInt(1)),
            ((ulong)Constants.MetaKeyRoot,
                CborValue.Bytes(Constants.RootDirectoryId)),
            ((ulong)Constants.MetaKeyEntries, CborValue.Arr(entryList)),
            ((ulong)Constants.MetaKeyCreated, CborValue.UInt((ulong)now)),
            ((ulong)Constants.MetaKeyModified, CborValue.UInt((ulong)mod))));
    }

    private sealed class SlotData
    {
        public byte[] SlotId = null!;
        public ushort CredentialType; public byte CredentialParameters;
        public ushort KdfProfile;
        public uint MemKiB, Time, Par;
        public byte[] Salt = null!, WrapNonce = null!, Wrapped = null!;
    }

    private static SlotData MakeSlot(
        ushort credentialType, byte credentialParameters,
        byte[] credentialBytes, byte[] vaultId, byte[] vaultKey,
        ushort kdfProfile)
    {
        var slotId = Crypto.RandomBytes(16);
        var salt = Crypto.RandomBytes(32);
        var wrapNonce = Crypto.RandomBytes(24);
        (uint memKiB, uint t, uint p) = Constants.Argon2Profile(kdfProfile);
        var argInput = Crypto.BuildArgon2Input(
            credentialType, credentialParameters, credentialBytes);
        var unlockKey = Crypto.Argon2idRaw(argInput, salt, memKiB, t, p, 32);

        var ad = new List<byte>(160);
        ad.AddRange(Constants.LabelWrap.ToArray());
        ad.AddRange(vaultId);
        ad.AddRange(slotId);
        Span<byte> buf = stackalloc byte[8];
        BinaryPrimitives.WriteUInt16BigEndian(buf, credentialType);
        ad.AddRange(buf[..2]);
        ad.Add(credentialParameters);
        BinaryPrimitives.WriteUInt16BigEndian(buf, kdfProfile);
        ad.AddRange(buf[..2]);
        BinaryPrimitives.WriteUInt32BigEndian(buf, memKiB);
        ad.AddRange(buf[..4]);
        BinaryPrimitives.WriteUInt32BigEndian(buf, t);
        ad.AddRange(buf[..4]);
        BinaryPrimitives.WriteUInt32BigEndian(buf, p);
        ad.AddRange(buf[..4]);
        ad.AddRange(salt);
        ad.AddRange(wrapNonce);

        var wrapped = Crypto.AeadEncrypt(unlockKey, wrapNonce, vaultKey,
            ad.ToArray());
        return new SlotData
        {
            SlotId = slotId, CredentialType = credentialType,
            CredentialParameters = credentialParameters, KdfProfile = kdfProfile,
            MemKiB = memKiB, Time = t, Par = p, Salt = salt,
            WrapNonce = wrapNonce, Wrapped = wrapped,
        };
    }

    /// <summary>Create an ASTBOX v1 container at <paramref name="path"/>.
    /// TOTP is the sole credential type: prefer a Base32 secret (stable,
    /// high-entropy KDF credential usable at any time/device); a raw
    /// totpCode is accepted for compatibility (legacy behavior).</summary>
    public static UnlockedContainer CreateContainer(
        string path,
        string? totpCode = null, int totpDigits = 6,
        IReadOnlyCollection<KeyValuePair<string, byte[]>>? files = null,
        string? seedDir = null, ushort kdfProfile = Constants.KdfProfileHigh,
        long? created = null, long? modified = null,
        string? totpSecret = null)
    {
        var fileList = files?.ToList()
                       ?? new List<KeyValuePair<string, byte[]>>();
        if (seedDir is not null)
        {
            foreach (var full in Directory.EnumerateFiles(
                         seedDir, "*", SearchOption.AllDirectories))
            {
                string rel = Path.GetRelativePath(seedDir, full)
                    .Replace('\\', '/');
                fileList.Add(KeyValuePair.Create(rel, File.ReadAllBytes(full)));
            }
        }
        if (totpSecret is null && totpCode is null)
            throw new AstboxError(E.InvalidArgument,
                "a TOTP secret or code is required (sole credential type)");

        var vaultId = Crypto.RandomBytes(16);
        var vaultKey = Crypto.RandomBytes(32);

        byte[] credBytes;
        if (totpSecret is not null)
        {
            try { credBytes = Crypto.Base32Decode(totpSecret); }
            catch (AstboxError)
            {
                throw new AstboxError(E.InvalidArgument,
                    "invalid Base32 TOTP secret");
            }
            if (credBytes.Length < 10)
                throw new AstboxError(E.InvalidArgument, "TOTP secret too short");
        }
        else
        {
            string code = totpCode!.Trim();
            if (code.Length != totpDigits || !code.All(char.IsDigit))
                throw new AstboxError(E.InvalidArgument,
                    $"TOTP code must be {totpDigits} digits");
            credBytes = Encoding.ASCII.GetBytes(code);
        }

        var slots = new List<SlotData>
        {
            MakeSlot(Constants.CredTypeTotp, (byte)totpDigits, credBytes,
                vaultId, vaultKey, kdfProfile),
        };

        var (entries, _) = BuildEntryMap(fileList);
        long now = created ?? DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        long mod = modified ?? now;
        foreach (var node in entries) node.Modified = (ulong)mod;

        var keys = Crypto.HkdfDerive(vaultKey, vaultId);

        // ---- data region (iterative layout) ----
        int keySlotLength = slots.Count * Constants.KeySlotSize;
        ulong metadataOffset = (ulong)(Constants.HeaderSize + keySlotLength);
        ulong? dataOffset = null;
        for (int attempt = 0; attempt < 8; attempt++)
        {
            var metaCborProbe = BuildMetadataCbor(entries, now, mod);
            ulong metadataLength =
                (ulong)metaCborProbe.Length + 24 + 16;
            ulong candidateDataOffset = metadataOffset + metadataLength;
            if (dataOffset is { } existing && candidateDataOffset == existing)
                break;
            dataOffset = candidateDataOffset;
            ulong pos = 0;
            foreach (var node in entries.Where(n => n.Type == Constants.TypeFile)
                         .OrderBy(n => n.Id, ByteArrayOrderComparer.Instance))
            {
                if (node.Size == 0)
                {
                    node.DataStart = 0;
                    node.DataLength = 0;
                    continue;
                }
                node.DataStart = candidateDataOffset + pos;
                ulong nChunks = (node.Size + (ulong)Constants.MaxChunkPlaintext - 1)
                                / (ulong)Constants.MaxChunkPlaintext;
                ulong total = 0;
                for (ulong i = 0; i < nChunks; i++)
                {
                    ulong plainLen = Math.Min(
                        (ulong)Constants.MaxChunkPlaintext,
                        node.Size - i * (ulong)Constants.MaxChunkPlaintext);
                    total += (ulong)Constants.DataRecordOverhead + plainLen;
                }
                node.DataLength = total;
                pos += total;
            }
        }
        if (dataOffset is null)
            throw new AstboxError(E.InvalidArgument, "layout did not converge");

        // recompute final values
        var metaCborFinal = BuildMetadataCbor(entries, now, mod);
        ulong metaDataLen = (ulong)metaCborFinal.Length + 24 + 16;
        ulong dataOff = dataOffset.Value;
        ulong dataLen = entries.Where(n => n.Type == Constants.TypeFile)
            .Aggregate(0UL, (a, n) => a + n.DataLength);
        ulong footerOffset = dataOff + dataLen;

        // ---- encrypt chunks (FileID ascending, then ChunkIndex) ----
        var dataRegion = new List<byte>();
        foreach (var node in entries.Where(n => n.Type == Constants.TypeFile)
                     .OrderBy(n => n.Id, ByteArrayOrderComparer.Instance))
        {
            if (node.Size == 0 || node.Data is null) continue;
            var data = node.Data;
            ulong chunkIndex = 0;
            for (int idx = 0; idx < data.Length;
                 idx += Constants.MaxChunkPlaintext, chunkIndex++)
            {
                int chunkLen = Math.Min(Constants.MaxChunkPlaintext,
                    data.Length - idx);
                var chunk = data.AsSpan(idx, chunkLen).ToArray();
                var nonce = Crypto.RandomBytes(24);
                var ad = new byte[Constants.LabelData.Length + 16 + 8 + 16 + 8 + 4];
                int o = 0;
                Constants.LabelData.CopyTo(ad);
                o += Constants.LabelData.Length;
                vaultId.CopyTo(ad, o); o += 16;
                BinaryPrimitives.WriteUInt64BigEndian(ad.AsSpan(o), 0); o += 8;
                node.Id.CopyTo(ad, o); o += 16;
                BinaryPrimitives.WriteUInt64BigEndian(ad.AsSpan(o), chunkIndex); o += 8;
                BinaryPrimitives.WriteUInt32BigEndian(ad.AsSpan(o), (uint)chunkLen);

                var ct = Crypto.AeadEncrypt(keys.Data, nonce, chunk, ad);

                dataRegion.AddRange(node.Id);
                Span<byte> hdr = stackalloc byte[12];
                BinaryPrimitives.WriteUInt64BigEndian(hdr, chunkIndex);
                BinaryPrimitives.WriteUInt32BigEndian(hdr[8..], (uint)chunkLen);
                dataRegion.AddRange(hdr.ToArray());
                dataRegion.AddRange(nonce);
                dataRegion.AddRange(ct);
            }
        }

        // ---- metadata record ----
        var metaNonce = Crypto.RandomBytes(24);
        var metaAd = new byte[Constants.LabelMetadata.Length + 16 + 8];
        Constants.LabelMetadata.CopyTo(metaAd);
        vaultId.CopyTo(metaAd, Constants.LabelMetadata.Length);
        BinaryPrimitives.WriteUInt64BigEndian(
            metaAd.AsSpan(Constants.LabelMetadata.Length + 16), 0);
        var metaCt = Crypto.AeadEncrypt(keys.Metadata, metaNonce,
            metaCborFinal, metaAd);
        var metadataRecord = new byte[24 + metaCt.Length];
        metaNonce.CopyTo(metadataRecord, 0);
        metaCt.CopyTo(metadataRecord, 24);

        // ---- footer ----
        var footer = new byte[Constants.FooterSize];
        Constants.FooterMagic.CopyTo(footer);
        BinaryPrimitives.WriteUInt16BigEndian(footer.AsSpan(8), Constants.Version);
        BinaryPrimitives.WriteUInt16BigEndian(footer.AsSpan(10), 0);
        BinaryPrimitives.WriteUInt64BigEndian(footer.AsSpan(12), 0);
        BinaryPrimitives.WriteUInt64BigEndian(footer.AsSpan(20),
            footerOffset + (ulong)Constants.FooterSize);
        Crypto.Sha256First16(metadataRecord).CopyTo(footer, 28);
        Crypto.Sha256First16(dataRegion.ToArray()).CopyTo(footer, 44);
        // mac(60..76) and reserved(76..112) zeroed below then filled
        var footerWithoutMac = new byte[112];
        Buffer.BlockCopy(footer, 0, footerWithoutMac, 0, 60);
        Buffer.BlockCopy(footer, 76, footerWithoutMac, 76, 36);
        var footerMacInput = new byte[Constants.LabelFooterMac.Length + 112];
        Constants.LabelFooterMac.CopyTo(footerMacInput);
        footerWithoutMac.CopyTo(footerMacInput, Constants.LabelFooterMac.Length);
        Crypto.HmacSha256Trunc16(keys.Footer, footerMacInput).CopyTo(footer, 60);

        // ---- key slots (SlotMAC after SlotMACKey is known) ----
        var slotBlobs = new List<byte[]>(slots.Count);
        foreach (var s in slots)
        {
            var blob = new byte[Constants.KeySlotSize];
            s.SlotId.CopyTo(blob, 0);
            BinaryPrimitives.WriteUInt16BigEndian(blob.AsSpan(16), s.CredentialType);
            blob[18] = s.CredentialParameters;
            blob[19] = 0;
            BinaryPrimitives.WriteUInt16BigEndian(blob.AsSpan(20), s.KdfProfile);
            BinaryPrimitives.WriteUInt16BigEndian(blob.AsSpan(22), 0);
            BinaryPrimitives.WriteUInt32BigEndian(blob.AsSpan(24), s.MemKiB);
            BinaryPrimitives.WriteUInt32BigEndian(blob.AsSpan(28), s.Time);
            BinaryPrimitives.WriteUInt32BigEndian(blob.AsSpan(32), s.Par);
            s.Salt.CopyTo(blob, 36);
            s.WrapNonce.CopyTo(blob, 68);
            s.Wrapped.CopyTo(blob, 92);
            var macInput = new byte[Constants.LabelSlotMac.Length + 176];
            Constants.LabelSlotMac.CopyTo(macInput);
            blob.AsSpan(0, 140).CopyTo(macInput.AsSpan(Constants.LabelSlotMac.Length));
            blob.AsSpan(156).CopyTo(
                macInput.AsSpan(Constants.LabelSlotMac.Length + 140));
            Crypto.HmacSha256Trunc16(keys.SlotMac, macInput).CopyTo(blob, 140);
            slotBlobs.Add(blob);
        }

        // ---- header ----
        var header = new byte[Constants.HeaderSize];
        Constants.HeaderMagic.CopyTo(header);
        BinaryPrimitives.WriteUInt16BigEndian(header.AsSpan(6), Constants.Version);
        BinaryPrimitives.WriteUInt32BigEndian(header.AsSpan(8), 0);
        vaultId.CopyTo(header, 12);
        BinaryPrimitives.WriteUInt64BigEndian(header.AsSpan(28), 0);
        BinaryPrimitives.WriteUInt64BigEndian(header.AsSpan(36), Constants.HeaderSize);
        BinaryPrimitives.WriteUInt64BigEndian(header.AsSpan(44),
            (ulong)keySlotLength);
        BinaryPrimitives.WriteUInt64BigEndian(header.AsSpan(52), metadataOffset);
        BinaryPrimitives.WriteUInt64BigEndian(header.AsSpan(60),
            (ulong)metadataRecord.Length);
        BinaryPrimitives.WriteUInt64BigEndian(header.AsSpan(68), dataOff);
        BinaryPrimitives.WriteUInt64BigEndian(header.AsSpan(76), dataLen);
        BinaryPrimitives.WriteUInt64BigEndian(header.AsSpan(84), footerOffset);
        BinaryPrimitives.WriteUInt64BigEndian(header.AsSpan(92), Constants.FooterSize);
        BinaryPrimitives.WriteUInt32BigEndian(header.AsSpan(100), (uint)slots.Count);
        BinaryPrimitives.WriteUInt32BigEndian(header.AsSpan(104), Constants.HeaderSize);
        var headerWithoutMac = new byte[128];
        Buffer.BlockCopy(header, 0, headerWithoutMac, 0, 108);
        Buffer.BlockCopy(header, 124, headerWithoutMac, 124, 4);
        var headerMacInput = new byte[Constants.LabelHeaderMac.Length + 128];
        Constants.LabelHeaderMac.CopyTo(headerMacInput);
        headerWithoutMac.CopyTo(headerMacInput, Constants.LabelHeaderMac.Length);
        Crypto.HmacSha256Trunc16(keys.Header, headerMacInput).CopyTo(header, 108);

        using (var f = File.Create(path))
        {
            f.Write(header);
            foreach (var blob in slotBlobs) f.Write(blob);
            f.Write(metadataRecord);
            f.Write(dataRegion.ToArray());
            f.Write(footer);
        }

        // self-verification
        return totpSecret is not null
            ? Container.UnlockContainer(path, secretB32: totpSecret)
            : Container.UnlockContainer(path, totp: totpCode);
    }
}
