// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
// Big-endian write helpers and byte-array ordering shared by container builders.

using System.Buffers.Binary;

namespace Astbox;

internal static class Bin
{
    public static void Put(byte[] dst, int offset, ReadOnlySpan<byte> src)
        => src.CopyTo(dst.AsSpan(offset));

    public static void U16(byte[] dst, int offset, ushort v)
        => BinaryPrimitives.WriteUInt16BigEndian(dst.AsSpan(offset), v);

    public static void U32(byte[] dst, int offset, uint v)
        => BinaryPrimitives.WriteUInt32BigEndian(dst.AsSpan(offset), v);

    public static void U64(byte[] dst, int offset, ulong v)
        => BinaryPrimitives.WriteUInt64BigEndian(dst.AsSpan(offset), v);
}

/// <summary>Ordering for byte arrays (lexicographic by content).</summary>
public sealed class ByteArrayOrderComparer : IComparer<byte[]>
{
    public static readonly ByteArrayOrderComparer Instance = new();
    public int Compare(byte[]? x, byte[]? y)
        => x is null ? (y is null ? 0 : -1)
           : y is null ? 1
           : x.AsSpan().SequenceCompareTo(y);
}
