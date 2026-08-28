// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
//! ASTBOX v1.0 protocol constants
//! (port of astbox/constants.py; sources: ASTBOX-v1.0-01-Core-Format.txt et al.)

namespace Astbox;

public static class Constants
{
    public static ReadOnlySpan<byte> HeaderMagic => "ASTBOX"u8;
    public static ReadOnlySpan<byte> FooterMagic => "ASTBOXF1"u8;
    public const int Version = 1;

    public const int HeaderSize = 128;
    public const int KeySlotSize = 192;
    public const int FooterSize = 112;
    public const int MinKeySlotCount = 1;
    public const int MaxKeySlotCount = 16;

    public const int VaultIdSize = 16;
    public const int SlotIdSize = 16;
    public const int VaultKeySize = 32;
    public const int SaltSize = 32;
    public const int WrapNonceSize = 24;
    public const int WrappedVaultKeySize = 48;
    public const int MacSize = 16;

    public const int MetadataNonceSize = 24;
    public const int MetadataTagSize = 16;
    public const int DataNonceSize = 24;
    public const int DataTagSize = 16;
    // Fixed per-record overhead: FileID(16)+ChunkIndex(8)+PlaintextLength(4)
    // +DataNonce(24)+Tag(16) == 68
    public const int DataRecordOverhead = 68;

    public const int MaxChunkPlaintext = 1048576; // 1 MiB

    // Credential types
    public const ushort CredTypePassword = 0x0001;
    public const ushort CredTypeTotp = 0x0002;

    // KDF profiles -> (memory KiB, time cost, parallelism)
    public const ushort KdfProfileHigh = 0x0001;
    public const ushort KdfProfileMemoryConstrained = 0x0002;

    public static (uint MemoryKiB, uint TimeCost, uint Parallelism) Argon2Profile(
        ushort profile)
    {
        return profile switch
        {
            KdfProfileHigh => (262144, 3, 1),
            KdfProfileMemoryConstrained => (65536, 3, 1),
            _ => throw new AstboxError(E.InvalidArgument,
                $"unknown KDF profile 0x{profile:X4}"),
        };
    }

    // Fixed ASCII domain-separation labels
    public static ReadOnlySpan<byte> LabelKdf => "ASTBOX-KDF-v1"u8;
    public static ReadOnlySpan<byte> LabelWrap => "ASTBOX-WRAP-v1"u8;
    public static ReadOnlySpan<byte> LabelHkdfSalt => "ASTBOX-HKDF-SALT-v1"u8;
    public static ReadOnlySpan<byte> LabelHdrm => "ASTBOX-HDRM-v1"u8;
    public static ReadOnlySpan<byte> LabelMeta => "ASTBOX-META-v1"u8;
    public static ReadOnlySpan<byte> LabelData => "ASTBOX-DATA-v1"u8;
    public static ReadOnlySpan<byte> LabelSlotm => "ASTBOX-SLOTM-v1"u8;
    public static ReadOnlySpan<byte> LabelFoot => "ASTBOX-FOOT-v1"u8;
    public static ReadOnlySpan<byte> LabelHeaderMac => "ASTBOX-HEADER-MAC-v1"u8;
    public static ReadOnlySpan<byte> LabelSlotMac => "ASTBOX-SLOT-MAC-v1"u8;
    public static ReadOnlySpan<byte> LabelMetadata => "ASTBOX-METADATA-v1"u8;
    public static ReadOnlySpan<byte> LabelFooterMac => "ASTBOX-FOOTER-MAC-v1"u8;

    // Metadata CBOR top-level keys
    public const int MetaKeyVersion = 1;
    public const int MetaKeyRoot = 2;
    public const int MetaKeyEntries = 3;
    public const int MetaKeyCreated = 4;
    public const int MetaKeyModified = 5;

    // Entry CBOR keys
    public const int EntryKeyFileId = 1;
    public const int EntryKeyParent = 2;
    public const int EntryKeyType = 3;
    public const int EntryKeyName = 4;
    public const int EntryKeySize = 5;
    public const int EntryKeyDataStart = 6;
    public const int EntryKeyDataLength = 7;
    public const int EntryKeyModified = 8;
    public const int EntryKeyMode = 9;

    public const byte TypeDirectory = 0;
    public const byte TypeFile = 1;

    public static byte[] RootDirectoryId { get; } = new byte[16];

    // TOTP
    public const int TotpPeriod = 30;
    public const long TotpT0 = 0;

    public const int MaxDirectoryDepth = 4096;
}
