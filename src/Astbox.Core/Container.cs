// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
//! ASTBOX v1.0 container parsing, unlocking and reading
//! (port of astbox/container.py). Implements the binary layout of doc 01,
//! the crypto flows of doc 02 and the metadata/data/footer rules of doc 03.

using System.Buffers.Binary;
using System.Security.Cryptography;

namespace Astbox;

/// <summary>Content equality for byte-array dictionary keys.</summary>
public sealed class ByteArrayComparer : IEqualityComparer<byte[]>
{
    public static readonly ByteArrayComparer Instance = new();
    public bool Equals(byte[]? x, byte[]? y)
        => ReferenceEquals(x, y)
           || (x is not null && y is not null && x.AsSpan().SequenceEqual(y));
    public int GetHashCode(byte[] obj)
    {
        unchecked
        {
            uint h = 2166136261;
            foreach (var b in obj) { h ^= b; h *= 16777619; }
            return (int)h;
        }
    }
}

public sealed class Header
{
    public byte[] Magic; public ushort Version; public uint Flags;
    public byte[] VaultId; public ulong Generation;
    public ulong KeySlotOffset; public ulong KeySlotLength;
    public ulong MetadataOffset; public ulong MetadataLength;
    public ulong DataOffset; public ulong DataLength;
    public ulong FooterOffset; public ulong FooterLength;
    public uint KeySlotCount; public uint HeaderLength;
    public byte[] HeaderMac; public byte[] Reserved;
}

public sealed class KeySlot
{
    public int Index; public byte[] SlotId;
    public ushort CredentialType; public byte CredentialParameters;
    public ushort KdfProfile; public ushort Reserved2Field;
    public uint Argon2MemoryKiB; public uint Argon2Time; public uint Argon2Parallelism;
    public byte[] Salt; public byte[] WrapNonce;
    public byte[] WrappedVaultKey; public byte[] SlotMac;

    public bool IsTotp => CredentialType == Constants.CredTypeTotp;
    public int? TotpDigits => IsTotp ? CredentialParameters : null;
    public string KdfLabel => KdfProfile switch
    {
        Constants.KdfProfileHigh => "ARGON2ID_HIGH",
        Constants.KdfProfileMemoryConstrained => "ARGON2ID_MEMORY_CONSTRAINED",
        _ => "unknown",
    };
    public (uint MemKiB, uint Time, uint Par) KdfParams
        => (Argon2MemoryKiB, Argon2Time, Argon2Parallelism);
}

public sealed class Footer
{
    public byte[] Magic; public ushort Version; public uint Flags;
    public ulong Generation; public ulong ContainerLength;
    public byte[] MetadataDigest; public byte[] DataDigest;
    public byte[] FooterMac; public byte[] Reserved;
}

public sealed class ParsedContainer
{
    public required string Path { get; init; }
    public required byte[] Raw { get; init; }
    public required Header Header { get; init; }
    public required IReadOnlyList<KeySlot> Slots { get; init; }
    public required Footer Footer { get; init; }
}

public sealed class Entry
{
    public byte[] FileId = null!;
    public byte[] ParentId = null!;
    public byte EntryType; public string Name = "";
    public ulong Size; public ulong DataStart; public ulong DataLength;
    public ulong Modified; public ulong FileMode;

    public bool IsDir => EntryType == Constants.TypeDirectory;
    public bool IsFile => EntryType == Constants.TypeFile;
}

public sealed class DataChunk
{
    public byte[] FileId = null!;
    public ulong ChunkIndex; public uint PlaintextLength;
    public byte[] Nonce = null!; public byte[] Ciphertext = null!;
    public byte[] Tag = null!;
    /// <summary>Absolute file offset of this record.</summary>
    public ulong RecordOffset;
}

public sealed class UnlockedContainer
{
    public required ParsedContainer Parsed { get; init; }
    public required byte[] VaultKey { get; init; }
    public required Subkeys Keys { get; init; }
    public required CborValue Metadata { get; init; }
    public required ulong Created { get; init; }
    public required ulong Modified { get; init; }
    public required Dictionary<byte[], Entry> Entries { get; init; }
    public required Dictionary<byte[], List<Entry>> Children { get; init; }
    public required Dictionary<byte[], List<DataChunk>> Chunks { get; init; }
}

public static class Container
{
    // -------------------------------------------------------------- utils

    private static ulong U64CheckedAdd(ulong a, ulong b, string what)
    {
        try { return checked(a + b); }
        catch (OverflowException)
        {
            throw new AstboxError(E.IntegerOverflow, $"{what} overflows UINT64");
        }
    }

    private static ulong U64CheckedMul(ulong a, ulong b, string what)
    {
        try { return checked(a * b); }
        catch (OverflowException)
        {
            throw new AstboxError(E.IntegerOverflow, $"{what} overflows UINT64");
        }
    }

    private static void CheckReserved(bool cond, string what,
        ushort code = E.ReservedField)
    {
        if (cond) throw new AstboxError(code, $"{what} must be zero");
    }

    // -------------------------------------------------- structural parsing

    public static Header ParseHeader(ReadOnlySpan<byte> raw)
    {
        if (raw.Length < Constants.HeaderSize)
            throw new AstboxError(E.InvalidHeader,
                "file shorter than 128-byte header");

        var magic = raw[..6].ToArray();
        ushort version = BinaryPrimitives.ReadUInt16BigEndian(raw[6..]);
        uint flags = BinaryPrimitives.ReadUInt32BigEndian(raw[8..]);
        var vaultId = raw.Slice(12, 16).ToArray();
        ulong generation = BinaryPrimitives.ReadUInt64BigEndian(raw[28..]);
        ulong keySlotOffset = BinaryPrimitives.ReadUInt64BigEndian(raw[36..]);
        ulong keySlotLength = BinaryPrimitives.ReadUInt64BigEndian(raw[44..]);
        ulong metadataOffset = BinaryPrimitives.ReadUInt64BigEndian(raw[52..]);
        ulong metadataLength = BinaryPrimitives.ReadUInt64BigEndian(raw[60..]);
        ulong dataOffset = BinaryPrimitives.ReadUInt64BigEndian(raw[68..]);
        ulong dataLength = BinaryPrimitives.ReadUInt64BigEndian(raw[76..]);
        ulong footerOffset = BinaryPrimitives.ReadUInt64BigEndian(raw[84..]);
        ulong footerLength = BinaryPrimitives.ReadUInt64BigEndian(raw[92..]);
        uint keySlotCount = BinaryPrimitives.ReadUInt32BigEndian(raw[100..]);
        uint headerLength = BinaryPrimitives.ReadUInt32BigEndian(raw[104..]);
        var headerMac = raw.Slice(108, 16).ToArray();
        var reserved = raw.Slice(124, 4).ToArray();

        if (!magic.AsSpan().SequenceEqual(Constants.HeaderMagic))
            throw new AstboxError(E.InvalidMagic,
                $"bad header magic {Convert.ToHexString(magic)}");
        if (version != Constants.Version)
            throw new AstboxError(E.UnsupportedVersion,
                $"unsupported format version {version}");
        if (flags != 0)
            throw new AstboxError(E.InvalidHeader, "non-zero header Flags");
        if (headerLength != Constants.HeaderSize)
            throw new AstboxError(E.InvalidHeader,
                $"HeaderLength {headerLength} != 128");
        if (keySlotOffset != Constants.HeaderSize)
            throw new AstboxError(E.InvalidOffset,
                $"KeySlotOffset {keySlotOffset} != 128");
        if (keySlotCount is < Constants.MinKeySlotCount
            or > Constants.MaxKeySlotCount)
            throw new AstboxError(E.InvalidHeader,
                $"KeySlotCount {keySlotCount} outside 1..16");
        if (footerLength != Constants.FooterSize)
            throw new AstboxError(E.InvalidLength,
                $"FooterLength {footerLength} != 112");
        CheckReserved(!reserved.AsSpan().SequenceEqual(new byte[4]),
            "Header Reserved");

        ulong expectKsl = U64CheckedMul(keySlotCount, Constants.KeySlotSize,
            "KeySlotLength");
        if (keySlotLength != expectKsl)
            throw new AstboxError(E.InvalidLength,
                $"KeySlotLength {keySlotLength} != count*192");
        ulong expectMo = U64CheckedAdd(keySlotOffset, keySlotLength,
            "MetadataOffset");
        if (metadataOffset != expectMo)
            throw new AstboxError(E.InvalidOffset,
                $"MetadataOffset {metadataOffset} != {expectMo}");
        if (metadataLength <
            (ulong)(Constants.MetadataNonceSize + Constants.MetadataTagSize))
            throw new AstboxError(E.InvalidLength, "MetadataLength too small");
        ulong expectDo = U64CheckedAdd(metadataOffset, metadataLength,
            "DataOffset");
        if (dataOffset != expectDo)
            throw new AstboxError(E.InvalidOffset,
                $"DataOffset {dataOffset} != {expectDo}");
        ulong expectFo = U64CheckedAdd(dataOffset, dataLength, "FooterOffset");
        if (footerOffset != expectFo)
            throw new AstboxError(E.InvalidOffset,
                $"FooterOffset {footerOffset} != {expectFo}");
        ulong expectSize = U64CheckedAdd(footerOffset, footerLength, "FileSize");
        if (expectSize != (ulong)raw.Length)
            throw new AstboxError(E.ContainerLengthMismatch,
                $"file size {raw.Length} != FooterOffset+112 ({expectSize})");
        if (footerOffset + footerLength > (ulong)raw.Length)
            throw new AstboxError(E.InvalidOffset, "Footer beyond end of file");

        return new Header
        {
            Magic = magic, Version = version, Flags = flags,
            VaultId = vaultId, Generation = generation,
            KeySlotOffset = keySlotOffset, KeySlotLength = keySlotLength,
            MetadataOffset = metadataOffset, MetadataLength = metadataLength,
            DataOffset = dataOffset, DataLength = dataLength,
            FooterOffset = footerOffset, FooterLength = footerLength,
            KeySlotCount = keySlotCount, HeaderLength = headerLength,
            HeaderMac = headerMac, Reserved = reserved,
        };
    }

    public static List<KeySlot> ParseKeySlots(
        ReadOnlySpan<byte> raw, Header header)
    {
        var slots = new List<KeySlot>();
        int count = (int)header.KeySlotCount;
        for (int i = 0; i < count; i++)
        {
            int off = (int)(header.KeySlotOffset + (ulong)i * Constants.KeySlotSize);
            if ((long)off + Constants.KeySlotSize > raw.Length)
                throw new AstboxError(E.InvalidHeader, "Key Slot region truncated");
            var s = raw.Slice(off, Constants.KeySlotSize);
            var slotId = s[..16].ToArray();
            ushort credType = BinaryPrimitives.ReadUInt16BigEndian(s[16..]);
            byte credParams = s[18];
            byte r1 = s[19];
            ushort kdfProfile = BinaryPrimitives.ReadUInt16BigEndian(s[20..]);
            ushort r2 = BinaryPrimitives.ReadUInt16BigEndian(s[22..]);
            uint memKiB = BinaryPrimitives.ReadUInt32BigEndian(s[24..]);
            uint timeCost = BinaryPrimitives.ReadUInt32BigEndian(s[28..]);
            uint parallelism = BinaryPrimitives.ReadUInt32BigEndian(s[32..]);
            var salt = s.Slice(36, 32).ToArray();
            var wrapNonce = s.Slice(68, 24).ToArray();
            var wrapped = s.Slice(92, 48).ToArray();
            var slotMac = s.Slice(140, 16).ToArray();
            var r3 = s.Slice(156, 36).ToArray();

            CheckReserved(r1 != 0, "Key Slot Reserved1");
            CheckReserved(r2 != 0, "Key Slot Reserved2");
            CheckReserved(!r3.AsSpan().SequenceEqual(new byte[36]),
                "Key Slot Reserved3");
            if (credType == Constants.CredTypePassword)
                throw new AstboxError(E.UnsupportedCredential,
                    "password Key Slots are not part of the ASTBOX v1 design; " +
                    "container rejected");
            if (credType != Constants.CredTypeTotp)
                throw new AstboxError(E.UnsupportedCredential,
                    $"unknown CredentialType 0x{credType:X4}");
            if (credParams is not (6 or 8))
                throw new AstboxError(E.InvalidTotpDigits,
                    $"TOTP digits {credParams} not in (6, 8)");
            if (kdfProfile is not (Constants.KdfProfileHigh
                or Constants.KdfProfileMemoryConstrained))
                throw new AstboxError(E.UnsupportedCredential,
                    $"unknown KDFProfile 0x{kdfProfile:X4}");
            (uint pMem, uint pTime, uint pPar) =
                Constants.Argon2Profile(kdfProfile); // throws InvalidArgument on unknown
            if ((memKiB, timeCost, parallelism) != (pMem, pTime, pPar))
                throw new AstboxError(E.InvalidHeader,
                    $"Argon2 parameters do not match KDFProfile 0x{kdfProfile:X4}");

            slots.Add(new KeySlot
            {
                Index = i, SlotId = slotId,
                CredentialType = credType, CredentialParameters = credParams,
                KdfProfile = kdfProfile, Reserved2Field = r2,
                Argon2MemoryKiB = memKiB, Argon2Time = timeCost,
                Argon2Parallelism = parallelism,
                Salt = salt, WrapNonce = wrapNonce,
                WrappedVaultKey = wrapped, SlotMac = slotMac,
            });
        }

        var ids = slots.Select(x => x.SlotId).ToList();
        if (ids.Distinct(ByteArrayComparer.Instance).Count() != ids.Count)
            throw new AstboxError(E.InvalidHeader,
                "duplicate SlotID in container");
        return slots;
    }

    public static Footer ParseFooter(ReadOnlySpan<byte> raw, Header header)
    {
        int off = (int)header.FooterOffset;
        if ((long)off + Constants.FooterSize > raw.Length)
            throw new AstboxError(E.InvalidFooter, "footer truncated");
        var f = raw.Slice(off, Constants.FooterSize);
        var magic = f[..8].ToArray();
        ushort version = BinaryPrimitives.ReadUInt16BigEndian(f[8..]);
        uint flags = BinaryPrimitives.ReadUInt16BigEndian(f[10..]);
        ulong generation = BinaryPrimitives.ReadUInt64BigEndian(f[12..]);
        ulong containerLength = BinaryPrimitives.ReadUInt64BigEndian(f[20..]);
        var metaDigest = f.Slice(28, 16).ToArray();
        var dataDigest = f.Slice(44, 16).ToArray();
        var footerMac = f.Slice(60, 16).ToArray();
        var reserved = f.Slice(76, 36).ToArray();

        if (!magic.AsSpan().SequenceEqual(Constants.FooterMagic))
            throw new AstboxError(E.InvalidFooter,
                $"bad footer magic {Convert.ToHexString(magic)}");
        if (version != Constants.Version)
            throw new AstboxError(E.UnsupportedVersion,
                $"unsupported footer version {version}");
        if (flags != 0)
            throw new AstboxError(E.InvalidFooter, "non-zero FooterFlags");
        if (generation != header.Generation)
            throw new AstboxError(E.GenerationMismatch,
                $"FooterGeneration {generation} != Header.Generation " +
                $"{header.Generation}");
        if (containerLength != (ulong)raw.Length)
            throw new AstboxError(E.ContainerLengthMismatch,
                $"ContainerLength {containerLength} != file size {raw.Length}");
        CheckReserved(!reserved.AsSpan().SequenceEqual(new byte[36]),
            "Footer Reserved");

        return new Footer
        {
            Magic = magic, Version = version, Flags = flags,
            Generation = generation, ContainerLength = containerLength,
            MetadataDigest = metaDigest, DataDigest = dataDigest,
            FooterMac = footerMac, Reserved = reserved,
        };
    }

    /// <summary>Structurally parse a container (no credentials needed).</summary>
    public static ParsedContainer ParseContainer(string path, byte[]? raw = null)
    {
        if (raw is null)
        {
            try { raw = File.ReadAllBytes(path); }
            catch (Exception exc)
            {
                throw new AstboxError(E.Io, $"cannot read {path}: {exc.Message}");
            }
        }
        var header = ParseHeader(raw);
        var slots = ParseKeySlots(raw, header);
        var footer = ParseFooter(raw, header);
        return new ParsedContainer
        {
            Path = path, Raw = raw, Header = header, Slots = slots,
            Footer = footer,
        };
    }

    // ------------------------------------------------------------ unlocking

    private static byte[] WrapAssociatedData(Header h, KeySlot slot)
    {
        var ad = new List<byte>(
            Constants.LabelWrap.Length + 16 * 2 + 2 + 1 + 2 + 4 * 3 + 32 + 24);
        ad.AddRange(Constants.LabelWrap.ToArray());
        ad.AddRange(h.VaultId);
        ad.AddRange(slot.SlotId);
        Span<byte> buf = stackalloc byte[8];
        BinaryPrimitives.WriteUInt16BigEndian(buf, slot.CredentialType);
        ad.AddRange(buf[..2]);
        ad.Add(slot.CredentialParameters);
        BinaryPrimitives.WriteUInt16BigEndian(buf, slot.KdfProfile);
        ad.AddRange(buf[..2]);
        BinaryPrimitives.WriteUInt32BigEndian(buf, slot.Argon2MemoryKiB);
        ad.AddRange(buf[..4]);
        BinaryPrimitives.WriteUInt32BigEndian(buf, slot.Argon2Time);
        ad.AddRange(buf[..4]);
        BinaryPrimitives.WriteUInt32BigEndian(buf, slot.Argon2Parallelism);
        ad.AddRange(buf[..4]);
        ad.AddRange(slot.Salt);
        ad.AddRange(slot.WrapNonce);
        return ad.ToArray();
    }

    public static byte[] DeriveUnlockKey(KeySlot slot, byte[] credentialBytes)
    {
        var argInput = Crypto.BuildArgon2Input(
            slot.CredentialType, slot.CredentialParameters, credentialBytes);
        var (memKiB, t, p) = slot.KdfParams;
        return Crypto.Argon2idRaw(argInput, slot.Salt, memKiB, t, p, 32);
    }

    private static byte[] UnwrapVaultKey(
        ParsedContainer parsed, KeySlot slot, byte[] unlockKey)
    {
        return Crypto.AeadDecrypt(
            unlockKey, slot.WrapNonce, slot.WrappedVaultKey,
            WrapAssociatedData(parsed.Header, slot));
    }

    private static void VerifyHeaderMac(ParsedContainer parsed, byte[] headerKey)
    {
        var h = parsed.Header;
        var raw = parsed.Raw;
        var withoutMac = new byte[128];
        raw.AsSpan(0, 108).CopyTo(withoutMac);
        // bytes 108..124 stay zeroed (the MAC field)
        raw.AsSpan(124, 4).CopyTo(withoutMac.AsSpan(124));

        var macInput = new byte[Constants.LabelHeaderMac.Length + 128];
        Constants.LabelHeaderMac.CopyTo(macInput);
        withoutMac.CopyTo(macInput, Constants.LabelHeaderMac.Length);

        var expect = Crypto.HmacSha256Trunc16(headerKey, macInput);
        if (!Crypto.ConstantTimeEquals(expect, h.HeaderMac))
            throw new AstboxError(E.HeaderMacFailure,
                "HeaderMAC verification failed");
    }

    private static void VerifySlotMacs(ParsedContainer parsed, byte[] slotMacKey)
    {
        foreach (var slot in parsed.Slots)
        {
            int off = (int)(parsed.Header.KeySlotOffset +
                            (ulong)slot.Index * Constants.KeySlotSize);
            var slotBytes = parsed.Raw.AsSpan(off, Constants.KeySlotSize);
            var macInput = new byte[Constants.LabelSlotMac.Length + 176];
            Constants.LabelSlotMac.CopyTo(macInput);
            slotBytes[..140].CopyTo(macInput.AsSpan(Constants.LabelSlotMac.Length));
            slotBytes[156..].CopyTo(
                macInput.AsSpan(Constants.LabelSlotMac.Length + 140));
            var expect = Crypto.HmacSha256Trunc16(slotMacKey, macInput);
            if (!Crypto.ConstantTimeEquals(expect, slot.SlotMac))
                throw new AstboxError(E.HeaderMacFailure,
                    $"SlotMAC verification failed for slot {slot.Index}");
        }
    }

    private static void VerifyFooter(ParsedContainer parsed, byte[] footerKey)
    {
        var f = parsed.Footer;
        int off = (int)parsed.Header.FooterOffset;
        var footerBytes = parsed.Raw.AsSpan(off, Constants.FooterSize);
        var withoutMac = new byte[112];
        footerBytes[..60].CopyTo(withoutMac);
        footerBytes[76..].CopyTo(withoutMac.AsSpan(60 + 16));

        var macInput = new byte[Constants.LabelFooterMac.Length + 112];
        Constants.LabelFooterMac.CopyTo(macInput);
        withoutMac.CopyTo(macInput, Constants.LabelFooterMac.Length);

        var expect = Crypto.HmacSha256Trunc16(footerKey, macInput);
        if (!Crypto.ConstantTimeEquals(expect, f.FooterMac))
            throw new AstboxError(E.FooterMacFailure,
                "FooterMAC verification failed");

        // digests
        var h = parsed.Header;
        var metaRecord = parsed.Raw.AsSpan((int)h.MetadataOffset,
            (int)h.MetadataLength);
        if (!Crypto.ConstantTimeEquals(Crypto.Sha256First16(metaRecord),
                f.MetadataDigest))
            throw new AstboxError(E.MetadataDigestFailure,
                "MetadataDigest mismatch");

        var dataRegion = parsed.Raw.AsSpan((int)h.DataOffset,
            (int)h.DataLength);
        if (!Crypto.ConstantTimeEquals(Crypto.Sha256First16(dataRegion),
                f.DataDigest))
            throw new AstboxError(E.DataDigestFailure, "DataDigest mismatch");
    }

    private static CborValue DecryptMetadata(
        ParsedContainer parsed, byte[] metadataKey)
    {
        var h = parsed.Header;
        var record = parsed.Raw.AsSpan((int)h.MetadataOffset,
            (int)h.MetadataLength);
        var nonce = record[..24].ToArray();
        var tag = record[^16..].ToArray();
        var ct = record[24..^16].ToArray();

        var ad = new byte[Constants.LabelMetadata.Length + 16 + 8];
        Constants.LabelMetadata.CopyTo(ad);
        h.VaultId.CopyTo(ad, Constants.LabelMetadata.Length);
        BinaryPrimitives.WriteUInt64BigEndian(
            ad.AsSpan(Constants.LabelMetadata.Length + 16), h.Generation);
        try
        {
            var ctTag = new byte[ct.Length + 16];
            ct.CopyTo(ctTag, 0);
            tag.CopyTo(ctTag, ct.Length);
            var plain = Crypto.AeadDecrypt(metadataKey, nonce, ctTag, ad);
            return CborDet.Loads(plain);
        }
        catch (AstboxError exc)
        {
            throw new AstboxError(E.MetadataAeadFailure,
                $"metadata authentication failed ({exc.Message})");
        }
    }

    // ------------------------------------------------------ metadata rules

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

    // typed CBOR accessors mirroring the Python isinstance checks
    private static CborValue GetKey(CborValue map, int key, ushort errCode,
        string what)
    {
        var k = CborValue.UInt((ulong)key);
        foreach (var kv in map.Entries)
            if (kv.Key.Equals(k)) return kv.Value;
        throw new AstboxError(errCode, what);
    }

    private static ulong RequireNonNegativeInt(CborValue v, ushort code,
        string what)
    {
        if (!v.IsUInt)
            throw new AstboxError(code, $"{what} must be a non-negative integer");
        return v.AsUInt;
    }

    private static (Dictionary<byte[], Entry>, Dictionary<byte[], List<Entry>>)
        ValidateMetadata(CborValue meta)
    {
        if (!meta.IsMap)
            throw new AstboxError(E.InvalidCbor, "metadata root must be a map");

        var expectedTop = new HashSet<ulong>(Enumerable.Range(1, 5).Select(i => (ulong)i));
        var actualTop = meta.Entries.Select(e => e.Key).ToList();
        if (actualTop.Count != 5 || actualTop.Any(k => !k.IsUInt || !expectedTop.Contains(k.AsUInt)))
            throw new AstboxError(E.UnknownField,
                "metadata top-level keys must be exactly 1..5");

        var version = GetKey(meta, 1, E.UnknownField, "");
        if (!version.IsUInt || version.AsUInt != 1)
            throw new AstboxError(E.UnsupportedVersion,
                $"MetadataVersion != 1");
        var rootId = GetKey(meta, 2, E.UnknownField, "");
        if (!rootId.IsBytes ||
            !rootId.AsBytes.AsSpan().SequenceEqual(Constants.RootDirectoryId))
            throw new AstboxError(E.InvalidEntry,
                "RootDirectoryID must be 16 zero bytes");
        var entriesVal = GetKey(meta, 3, E.UnknownField, "");
        if (!entriesVal.IsArray)
            throw new AstboxError(E.InvalidCbor, "Entries must be an array");
        var createdV = GetKey(meta, 4, E.UnknownField, "");
        var modifiedV = GetKey(meta, 5, E.UnknownField, "");
        if (!createdV.IsUInt || !modifiedV.IsUInt)
            throw new AstboxError(E.InvalidCbor,
                "ContainerCreated/Modified must be integers");

        var entries = new Dictionary<byte[], Entry>(ByteArrayComparer.Instance);
        var children = new Dictionary<byte[], List<Entry>>(ByteArrayComparer.Instance)
        {
            [Constants.RootDirectoryId] = new(),
        };

        foreach (var item in entriesVal.Items)
        {
            if (!item.IsMap)
                throw new AstboxError(E.InvalidEntry, "entry must be a map");

            var expectedKeys = Enumerable.Range(1, 9).Select(i => (ulong)i).ToHashSet();
            if (item.Entries.Count != 9 ||
                item.Entries.Any(kv => !kv.Key.IsUInt || !expectedKeys.Contains(kv.Key.AsUInt)))
                throw new AstboxError(E.UnknownField,
                    "entry keys must be exactly 1..9");

            var fileIdV = GetKey(item, 1, E.UnknownField, "");
            var parentIdV = GetKey(item, 2, E.UnknownField, "");
            var typeV = GetKey(item, 3, E.UnknownField, "");
            var nameV = GetKey(item, 4, E.UnknownField, "");
            var sizeV = GetKey(item, 5, E.UnknownField, "");
            var dataStartV = GetKey(item, 6, E.UnknownField, "");
            var dataLenV = GetKey(item, 7, E.UnknownField, "");
            var modifiedTV = GetKey(item, 8, E.UnknownField, "");
            var modeV = GetKey(item, 9, E.UnknownField, "");

            if (!fileIdV.IsBytes || fileIdV.AsBytes.Length != 16)
                throw new AstboxError(E.InvalidEntry, "FileID must be 16 bytes");
            if (!parentIdV.IsBytes || parentIdV.AsBytes.Length != 16)
                throw new AstboxError(E.InvalidEntry, "ParentID must be 16 bytes");
            var fileId = fileIdV.AsBytes;
            var parentId = parentIdV.AsBytes;
            if (fileId.AsSpan().SequenceEqual(Constants.RootDirectoryId))
                throw new AstboxError(E.InvalidEntry,
                    "root FileID must not appear as an entry");
            if (!typeV.IsUInt ||
                typeV.AsUInt is not ((ulong)Constants.TypeDirectory or (ulong)Constants.TypeFile))
                throw new AstboxError(E.InvalidEntry,
                    $"unknown entry type {typeV}");

            ulong size = RequireNonNegativeInt(sizeV, E.InvalidEntry, "Size");
            ulong dataStart = RequireNonNegativeInt(dataStartV, E.InvalidEntry, "DataStart");
            ulong dataLength = RequireNonNegativeInt(dataLenV, E.InvalidEntry, "DataLength");
            ulong modifiedT = RequireNonNegativeInt(modifiedTV, E.InvalidEntry, "Modified");
            ulong mode = RequireNonNegativeInt(modeV, E.InvalidEntry, "FileMode");

            if (!nameV.IsText)
                throw new AstboxError(E.InvalidFileName, "empty entry name");
            string name = nameV.AsText;
            ValidateName(name);

            if (entries.ContainsKey(fileId))
                throw new AstboxError(E.InvalidEntry, "duplicate FileID");

            var entry = new Entry
            {
                FileId = fileId, ParentId = parentId,
                EntryType = (byte)typeV.AsUInt, Name = name,
                Size = size, DataStart = dataStart, DataLength = dataLength,
                Modified = modifiedT, FileMode = mode,
            };
            if (entry.IsDir)
            {
                if (size != 0 || dataStart != 0 || dataLength != 0)
                    throw new AstboxError(E.InvalidEntry,
                        "directory must have Size/DataStart/DataLength == 0");
            }
            else
            {
                if (size == 0)
                {
                    if (dataLength != 0 || dataStart != 0)
                        throw new AstboxError(E.InvalidEntry,
                            "empty file must have DataStart/DataLength == 0");
                }
                else if (dataLength == 0)
                {
                    throw new AstboxError(E.InvalidEntry,
                        "non-empty file must have DataLength > 0");
                }
            }
            entries[fileId] = entry;
            if (!children.TryGetValue(parentId, out var list))
                children[parentId] = list = new List<Entry>();
            list.Add(entry);
        }

        // tree validation
        foreach (var (fileId, entry) in entries)
        {
            WalkParent(entries, fileId, 0);
            if (!entries.ContainsKey(entry.ParentId) &&
                !entry.ParentId.AsSpan().SequenceEqual(Constants.RootDirectoryId))
                throw new AstboxError(E.InvalidDirectoryTree,
                    $"ParentID of '{entry.Name}' does not reference a directory");
            if (entries.TryGetValue(entry.ParentId, out var parent) && !parent.IsDir)
                throw new AstboxError(E.InvalidDirectoryTree,
                    $"parent of '{entry.Name}' is not a directory");
            if (entry.ParentId.AsSpan().SequenceEqual(fileId))
                throw new AstboxError(E.InvalidDirectoryTree,
                    $"entry '{entry.Name}' is its own parent");
        }
        foreach (var siblings in children.Values)
        {
            var names = siblings.Select(s => s.Name).ToList();
            if (names.Distinct().Count() != names.Count)
                throw new AstboxError(E.InvalidDirectoryTree,
                    "duplicate sibling name under one parent");
        }
        return (entries, children);
    }

    private static void WalkParent(
        Dictionary<byte[], Entry> entries, byte[] fileId, int depth)
    {
        if (depth > Constants.MaxDirectoryDepth)
            throw new AstboxError(E.InvalidDirectoryTree, "directory tree too deep");
        var entry = entries[fileId];
        if (entry.ParentId.AsSpan().SequenceEqual(Constants.RootDirectoryId))
            return;
        if (entry.ParentId.AsSpan().SequenceEqual(fileId) ||
            !entries.ContainsKey(entry.ParentId))
            throw new AstboxError(E.InvalidDirectoryTree,
                $"cycle or missing parent for '{entry.Name}'");
        WalkParent(entries, entry.ParentId, depth + 1);
    }

    // ---------------------------------------------------------- data region

    public static Dictionary<byte[], List<DataChunk>> IndexData(
        ParsedContainer parsed, Dictionary<byte[], Entry> entries)
    {
        var h = parsed.Header;
        var region = parsed.Raw.AsSpan((int)h.DataOffset, (int)h.DataLength);
        var chunks = new Dictionary<byte[], List<DataChunk>>(ByteArrayComparer.Instance);
        int pos = 0;
        while (pos < region.Length)
        {
            ulong recStartAbs = h.DataOffset + (ulong)pos;
            if (pos + 52 > region.Length)
                throw new AstboxError(E.InvalidDataRecord,
                    "truncated Data Record header");
            var fileId = region.Slice(pos, 16).ToArray();
            ulong chunkIndex = BinaryPrimitives.ReadUInt64BigEndian(region[(pos + 16)..]);
            uint plaintextLength = BinaryPrimitives.ReadUInt32BigEndian(region[(pos + 24)..]);
            var nonce = region.Slice(pos + 28, 24).ToArray();
            if (plaintextLength is < 1 or > Constants.MaxChunkPlaintext)
                throw new AstboxError(E.InvalidDataRecord,
                    $"PlaintextLength {plaintextLength} out of range 1..1048576");
            long recLen = Constants.DataRecordOverhead + plaintextLength;
            if (pos + recLen > region.Length)
                throw new AstboxError(E.InvalidDataRecord,
                    "Data Record extends past Data region");
            var ct = region.Slice(pos + 52, (int)plaintextLength).ToArray();
            var tag = region.Slice((int)(pos + 52 + plaintextLength),
                (int)(recLen - 52 - plaintextLength)).ToArray();
            if (!chunks.TryGetValue(fileId, out var list))
                chunks[fileId] = list = new List<DataChunk>();
            list.Add(new DataChunk
            {
                FileId = fileId, ChunkIndex = chunkIndex,
                PlaintextLength = plaintextLength, Nonce = nonce,
                Ciphertext = ct, Tag = tag, RecordOffset = recStartAbs,
            });
            pos += (int)recLen;
        }
        if (pos != region.Length)
            throw new AstboxError(E.InvalidDataRecord,
                "unaccounted bytes in Data region");

        foreach (var (fileId, clist) in chunks)
        {
            if (!entries.TryGetValue(fileId, out var entry) || !entry.IsFile)
                throw new AstboxError(E.InvalidDataRecord,
                    "Data Record references unknown FileID");
            clist.Sort((a, b) => a.ChunkIndex.CompareTo(b.ChunkIndex));
            for (int i = 0; i < clist.Count; i++)
                if (clist[i].ChunkIndex != (ulong)i)
                    throw new AstboxError(E.InvalidDataRecord,
                        $"non-contiguous ChunkIndex for {Convert.ToHexString(fileId)}");
            if (entry.Size == 0)
                throw new AstboxError(E.InvalidDataRecord,
                    "Data Records for a zero-size file");
            ulong expectCount = (entry.Size + (ulong)Constants.MaxChunkPlaintext - 1)
                                / (ulong)Constants.MaxChunkPlaintext;
            if ((ulong)clist.Count != expectCount)
                throw new AstboxError(E.InvalidDataRecord,
                    $"chunk count {clist.Count} != ceil(size/chunk) {expectCount}");
            for (int i = 0; i < clist.Count - 1; i++)
                if (clist[i].PlaintextLength != Constants.MaxChunkPlaintext)
                    throw new AstboxError(E.InvalidDataRecord,
                        "non-final chunk is not 1048576 bytes");
            ulong total = clist.Aggregate(0UL, (acc, c) => acc + c.PlaintextLength);
            if (total != entry.Size)
                throw new AstboxError(E.InvalidDataRecord,
                    $"sum of chunk plaintext {total} != Size {entry.Size}");
            ulong firstAbs = clist[0].RecordOffset;
            ulong regionLen = clist.Aggregate(0UL,
                (acc, c) => acc + (ulong)Constants.DataRecordOverhead
                              + c.PlaintextLength);
            if (firstAbs != entry.DataStart || regionLen != entry.DataLength)
                throw new AstboxError(E.InvalidDataRecord,
                    "metadata DataStart/DataLength do not match records");
            if (firstAbs + regionLen > h.FooterOffset)
                throw new AstboxError(E.InvalidDataRecord,
                    "DataStart+DataLength exceeds FooterOffset");
        }
        // every non-empty FILE must have records; every record belongs to one FILE
        foreach (var (fileId, entry) in entries)
        {
            if (entry.IsFile && entry.Size > 0 && !chunks.ContainsKey(fileId))
                throw new AstboxError(E.InvalidDataRecord,
                    $"missing Data Records for file '{entry.Name}'");
        }
        return chunks;
    }

    // -------------------------------------------------------- unlock entry

    private static byte[]? CredentialBytes(KeySlot slot, string totpValue)
    {
        // TOTP credential bytes: the exact decimal ASCII code (leading zeros
        // significant), matching the slot's configured digit count.
        int digits = slot.CredentialParameters;
        string s = totpValue.Trim();
        if (s.Length == 0 || !s.All(char.IsDigit) || s.Length != digits)
            return null;
        return System.Text.Encoding.ASCII.GetBytes(s);
    }

    /// <summary>Unlock a container with a TOTP code or a Base32 secret.</summary>
    public static UnlockedContainer UnlockContainer(
        string path, string? totp = null, byte[]? raw = null,
        string? secretB32 = null)
        => UnlockParsed(ParseContainer(path, raw), totp, secretB32);

    /// <summary>Try to unlock an already-parsed structure (reusable across
    /// candidate codes without re-reading large files).</summary>
    public static UnlockedContainer UnlockParsed(
        ParsedContainer parsed, string? totp = null, string? secretB32 = null)
    {
        var header = parsed.Header;

        if (!string.IsNullOrEmpty(secretB32))
        {
            byte[] cred;
            try { cred = Crypto.Base32Decode(secretB32); }
            catch (AstboxError)
            {
                throw new AstboxError(E.AuthenticationFailed,
                    "invalid Base32 TOTP secret");
            }
            AstboxError? lastError = null;
            foreach (var slot in parsed.Slots)
            {
                try
                {
                    var unlockKey = DeriveUnlockKey(slot, cred);
                    var vaultKey = UnwrapVaultKey(parsed, slot, unlockKey);
                    return FinalizeUnlock(parsed, slot, vaultKey);
                }
                catch (AstboxError exc) { lastError = exc; }
            }
            throw new AstboxError(E.AuthenticationFailed,
                "unlock failed: secret does not match this container",
                lastError?.Code);
        }

        if (totp is null)
            throw new AstboxError(E.NoValidCredential,
                "a TOTP code is required to unlock");

        AstboxError? lastErr = null;
        foreach (var slot in parsed.Slots)
        {
            byte[]? cred;
            try { cred = CredentialBytes(slot, totp); }
            catch (AstboxError exc) { lastErr = exc; continue; }
            if (cred is null) continue;
            try
            {
                var unlockKey = DeriveUnlockKey(slot, cred);
                var vaultKey = UnwrapVaultKey(parsed, slot, unlockKey);
                return FinalizeUnlock(parsed, slot, vaultKey);
            }
            catch (AstboxError exc) { lastErr = exc; continue; }
        }
        if (lastErr is not null)
            throw new AstboxError(E.AuthenticationFailed,
                "unlock failed: no valid TOTP code for this container");
        throw new AstboxError(E.AuthenticationFailed,
            "unlock failed: no matching TOTP code provided");
    }

    private static UnlockedContainer FinalizeUnlock(
        ParsedContainer parsed, KeySlot slot, byte[] vaultKey)
    {
        var header = parsed.Header;
        var keys = Crypto.HkdfDerive(vaultKey, header.VaultId);
        VerifyHeaderMac(parsed, keys.Header);
        VerifySlotMacs(parsed, keys.SlotMac);
        VerifyFooter(parsed, keys.Footer);
        var meta = DecryptMetadata(parsed, keys.Metadata);
        var (entries, children) = ValidateMetadata(meta);
        var chunks = IndexData(parsed, entries);
        return new UnlockedContainer
        {
            Parsed = parsed,
            VaultKey = vaultKey,
            Keys = keys,
            Metadata = meta,
            Created = GetMetaU64(meta, 4),
            Modified = GetMetaU64(meta, 5),
            Entries = entries,
            Children = children,
            Chunks = chunks,
        };
    }

    private static ulong GetMetaU64(CborValue meta, int key)
        => GetKey(meta, key, E.InvalidCbor, "").AsUInt;

    // --------------------------------------------------- reading/extraction

    public static byte[] DataAssociatedData(UnlockedContainer uc, DataChunk chunk)
    {
        var h = uc.Parsed.Header;
        var ad = new byte[Constants.LabelData.Length + 16 + 8 + 16 + 8 + 4];
        int o = 0;
        Constants.LabelData.CopyTo(ad);
        o += Constants.LabelData.Length;
        h.VaultId.CopyTo(ad, o); o += 16;
        BinaryPrimitives.WriteUInt64BigEndian(ad.AsSpan(o), h.Generation); o += 8;
        chunk.FileId.CopyTo(ad, o); o += 16;
        BinaryPrimitives.WriteUInt64BigEndian(ad.AsSpan(o), chunk.ChunkIndex); o += 8;
        BinaryPrimitives.WriteUInt32BigEndian(ad.AsSpan(o), chunk.PlaintextLength);
        return ad;
    }

    /// <summary>Yield plaintext chunks of a file, authenticating each record.</summary>
    public static IEnumerable<byte[]> IterFilePlaintext(
        UnlockedContainer uc, Entry entry)
    {
        if (entry.IsDir)
            throw new AstboxError(E.InvalidEntry, $"'{entry.Name}' is a directory");
        if (!uc.Chunks.TryGetValue(entry.FileId, out var list))
            yield break;
        foreach (var chunk in list.OrderBy(c => c.ChunkIndex))
        {
            byte[] pt;
            try
            {
                var ctTag = new byte[chunk.Ciphertext.Length + chunk.Tag.Length];
                chunk.Ciphertext.CopyTo(ctTag, 0);
                chunk.Tag.CopyTo(ctTag, chunk.Ciphertext.Length);
                pt = Crypto.AeadDecrypt(uc.Keys.Data, chunk.Nonce, ctTag,
                    DataAssociatedData(uc, chunk));
            }
            catch (AstboxError exc)
            {
                throw new AstboxError(E.DataAeadFailure,
                    $"data record authentication failed for '{entry.Name}': " +
                    exc.Message);
            }
            yield return pt;
        }
    }

    public static byte[] ReadFile(UnlockedContainer uc, Entry entry)
    {
        using var ms = new MemoryStream();
        foreach (var block in IterFilePlaintext(uc, entry))
            ms.Write(block, 0, block.Length);
        return ms.ToArray();
    }

    public static IEnumerable<string> EntryPathParts(UnlockedContainer uc,
        Entry entry)
    {
        var parts = new List<string> { entry.Name };
        var cur = entry;
        while (!cur.ParentId.AsSpan().SequenceEqual(Constants.RootDirectoryId))
        {
            var parent = uc.Entries[cur.ParentId];
            parts.Add(parent.Name);
            cur = parent;
        }
        parts.Reverse();
        return parts;
    }

    public static IEnumerable<Entry> RootEntries(UnlockedContainer uc)
        => uc.Children.TryGetValue(Constants.RootDirectoryId, out var l)
            ? l.OrderBy(e => e.Name, StringComparer.Ordinal)
            : Enumerable.Empty<Entry>();

    /// <summary>Yield (path, Entry) pairs in depth-first order.</summary>
    public static IEnumerable<(string Path, Entry Entry)> WalkEntries(
        UnlockedContainer uc, byte[]? parentId = null, string prefix = "")
    {
        parentId ??= Constants.RootDirectoryId;
        if (!uc.Children.TryGetValue(parentId, out var kids)) yield break;
        foreach (var entry in kids.OrderBy(e => e.Name, StringComparer.Ordinal))
        {
            string path = prefix.Length == 0 ? entry.Name : prefix + "/" + entry.Name;
            yield return (path, entry);
            if (entry.IsDir)
                foreach (var sub in WalkEntries(uc, entry.FileId, path))
                    yield return sub;
        }
    }

    /// <summary>Level-5 verification: authenticate every Data Record.</summary>
    public static void VerifyFull(UnlockedContainer uc)
    {
        foreach (var entry in uc.Entries.Values)
        {
            if (entry.IsFile && entry.Size > 0)
                foreach (var _ in IterFilePlaintext(uc, entry)) { }
        }
    }
}
