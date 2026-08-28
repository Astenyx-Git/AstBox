// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
//! Deterministic (canonical) CBOR encode/decode for ASTBOX v1 metadata.
//! Port of astbox/cbor_det.py (ASTBOX-v1.0-03 §13-19):
//! RFC 8949 deterministic encoding restricted to unsigned ints, byte strings,
//! UTF-8 text, arrays and maps; floats/tags/indefinite lengths/non-minimal
//! integers/duplicate or out-of-canonical-order map keys are rejected.

using System.Buffers.Binary;
using System.Text;

namespace Astbox;

/// <summary>Decoded CBOR value model (UInt | Bytes | Text | Array | Map).</summary>
public sealed class CborValue : IEquatable<CborValue>
{
    public enum Kinds : byte { UInt, Bytes, Text, Array, Map }

    public Kinds Kind { get; }
    public ulong AsUInt { get; }
    public byte[] AsBytes { get; }
    public string AsText { get; }
    public IReadOnlyList<CborValue> Items { get; }
    /// <summary>Map entries in decoded (canonical) order.</summary>
    public IReadOnlyList<KeyValuePair<CborValue, CborValue>> Entries { get; }

    private CborValue(Kinds kind, ulong u = 0, byte[]? bytes = null,
        string? text = null, IReadOnlyList<CborValue>? items = null,
        IReadOnlyList<KeyValuePair<CborValue, CborValue>>? entries = null)
    {
        Kind = kind;
        AsUInt = u;
        AsBytes = bytes ?? Array.Empty<byte>();
        AsText = text ?? string.Empty;
        Items = items ?? Array.Empty<CborValue>();
        Entries = entries ?? Array.Empty<KeyValuePair<CborValue, CborValue>>();
    }

    // ---- builders -------------------------------------------------------
    public static CborValue UInt(ulong v) => new(Kinds.UInt, u: v);
    public static CborValue Bytes(byte[] b) => new(Kinds.Bytes, bytes: b);
    public static CborValue Text(string s) => new(Kinds.Text, text: s);
    public static CborValue Arr(IReadOnlyList<CborValue> items)
        => new(Kinds.Array, items: items);
    public static CborValue Arr(params CborValue[] items)
        => new(Kinds.Array, items: items);
    public static CborValue Map(
        IReadOnlyList<KeyValuePair<CborValue, CborValue>> entries)
        => new(Kinds.Map, entries: entries);
    public static CborValue Map(params (ulong key, CborValue val)[] pairs)
        => new(Kinds.Map,
            entries: pairs.Select(p =>
                new KeyValuePair<CborValue, CborValue>(UInt(p.key), p.val))
                .ToList());

    public bool IsUInt => Kind == Kinds.UInt;
    public bool IsBytes => Kind == Kinds.Bytes;
    public bool IsText => Kind == Kinds.Text;
    public bool IsArray => Kind == Kinds.Array;
    public bool IsMap => Kind == Kinds.Map;

    public bool Equals(CborValue? other)
    {
        if (other is null || other.Kind != Kind) return false;
        return Kind switch
        {
            Kinds.UInt => AsUInt == other.AsUInt,
            Kinds.Bytes => AsBytes.AsSpan().SequenceEqual(other.AsBytes),
            Kinds.Text => string.Equals(AsText, other.AsText, StringComparison.Ordinal),
            Kinds.Array => Items.Count == other.Items.Count &&
                Items.Zip(other.Items, (a, b) => a.Equals(b)).All(x => x),
            Kinds.Map => Entries.Count == other.Entries.Count &&
                Entries.Zip(other.Entries, (a, b) =>
                    a.Key.Equals(b.Key) && a.Value.Equals(b.Value)).All(x => x),
            _ => false,
        };
    }

    public override bool Equals(object? obj) => Equals(obj as CborValue);

    public override int GetHashCode()
    {
        var h = new HashCode();
        h.Add(Kind);
        switch (Kind)
        {
            case Kinds.UInt: h.Add(AsUInt); break;
            case Kinds.Bytes:
                foreach (var b in AsBytes) h.Add(b);
                break;
            case Kinds.Text: h.Add(AsText, StringComparer.Ordinal); break;
            case Kinds.Array:
                foreach (var i in Items) h.Add(i); break;
            case Kinds.Map:
                foreach (var kv in Entries) { h.Add(kv.Key); h.Add(kv.Value); }
                break;
        }
        return h.ToHashCode();
    }

    public override string ToString()
        => Kind switch
        {
            Kinds.UInt => $"uint({AsUInt})",
            Kinds.Bytes => $"bytes[{AsBytes.Length}]",
            Kinds.Text => $"text({AsText.Length})",
            Kinds.Array => $"array[{Items.Count}]",
            Kinds.Map => $"map[{Entries.Count}]",
            _ => Kind.ToString(),
        };
}

public static class CborDet
{
    private const int MaxDepth = 64;
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);

    // ------------------------------------------------------------------
    // Strict decoding
    // ------------------------------------------------------------------

    /// <summary>Strictly decode canonical CBOR; trailing bytes forbidden.</summary>
    public static CborValue Loads(ReadOnlySpan<byte> data)
    {
        var r = new Reader(data.ToArray());
        var obj = DecodeItem(r, 0);
        if (r.Remaining != 0)
            throw new AstboxError(E.InvalidCbor, "trailing bytes after CBOR item");
        return obj;
    }

    private sealed class Reader
    {
        public Reader(byte[] data) => Data = data;
        public byte[] Data { get; }
        public int Pos { get; set; }
        public int End => Data.Length;
        public int Remaining => End - Pos;

        public byte[] Take(int n)
        {
            if (Pos + n > End)
                throw new AstboxError(E.InvalidCbor, "truncated CBOR item");
            var outp = new byte[n];
            Buffer.BlockCopy(Data, Pos, outp, 0, n);
            Pos += n;
            return outp;
        }

        public ReadOnlySpan<byte> TakeSpan(int n)
        {
            if (Pos + n > End)
                throw new AstboxError(E.InvalidCbor, "truncated CBOR item");
            var s = Data.AsSpan(Pos, n);
            Pos += n;
            return s;
        }
    }

    // (major, additionalInfo, length)
    private static (int Major, int Ai, ulong Length) ReadHead(Reader r)
    {
        if (r.Remaining < 1)
            throw new AstboxError(E.InvalidCbor, "truncated CBOR item");
        int b0 = r.Data[r.Pos];
        r.Pos++;
        int major = b0 >> 5;
        int ai = b0 & 0x1F;
        switch (ai)
        {
            case < 24: return (major, ai, (ulong)ai);
            case 24: return (major, ai, r.Take(1)[0]);
            case 25: return (major, ai, BinaryPrimitives.ReadUInt16BigEndian(r.TakeSpan(2)));
            case 26: return (major, ai, BinaryPrimitives.ReadUInt32BigEndian(r.TakeSpan(4)));
            case 27: return (major, ai, BinaryPrimitives.ReadUInt64BigEndian(r.TakeSpan(8)));
            default:
                throw new AstboxError(E.InvalidCbor, "indefinite-length item forbidden");
        }
    }

    private static void CheckMinimal(int ai, ulong length)
    {
        // Reject non-minimal integer encodings (RFC 8949 4.2.1).
        if (ai == 24 && length < 24)
            throw new AstboxError(E.NonCanonicalCbor, "non-minimal uint encoding");
        if (ai == 25 && length < 0x100)
            throw new AstboxError(E.NonCanonicalCbor, "non-minimal uint encoding");
        if (ai == 26 && length < 0x10000)
            throw new AstboxError(E.NonCanonicalCbor, "non-minimal uint encoding");
        if (ai == 27 && length < 0x1_0000_0000)
            throw new AstboxError(E.NonCanonicalCbor, "non-minimal uint encoding");
    }

    private static CborValue DecodeItem(Reader r, int depth)
    {
        if (depth > MaxDepth)
            throw new AstboxError(E.InvalidCbor, "CBOR nesting too deep");
        if (r.Remaining < 1)
            throw new AstboxError(E.InvalidCbor, "truncated CBOR item");
        int major;
        int ai;
        ulong length;
        {
            int b0 = r.Data[r.Pos];
            (major, ai, length) = ReadHead(r);
            if (major != 0)
            {
                // rewind not needed; only uint uses minimal check below
            }
            else
            {
                CheckMinimal(ai, length);
                return CborValue.UInt(length);
            }
        }

        switch (major)
        {
            case 1: // negative integer: not permitted by ASTBOX metadata
                throw new AstboxError(E.InvalidCbor, "negative CBOR integer forbidden");

            case 2: // byte string
            {
                if (length > int.MaxValue)
                    throw new AstboxError(E.InvalidCbor, "byte string too large");
                return CborValue.Bytes(r.Take((int)length));
            }

            case 3: // text string
            {
                if (length > int.MaxValue)
                    throw new AstboxError(E.InvalidCbor, "text string too large");
                var raw = r.Take((int)length);
                string text;
                try { text = StrictUtf8.GetString(raw); }
                catch (DecoderFallbackException)
                {
                    throw new AstboxError(E.InvalidCbor, "text string is not UTF-8");
                }
                return CborValue.Text(text);
            }

            case 4: // array
            {
                if (length > int.MaxValue)
                    throw new AstboxError(E.InvalidCbor, "array too large");
                int n = (int)length;
                var arr = new List<CborValue>(n);
                for (int i = 0; i < n; i++)
                    arr.Add(DecodeItem(r, depth + 1));
                return CborValue.Arr(arr);
            }

            case 5: // map
            {
                if (length > int.MaxValue)
                    throw new AstboxError(E.InvalidCbor, "map too large");
                int n = (int)length;
                (int Len, byte[] Bytes)? prevEncoded = null;
                var result = new List<KeyValuePair<CborValue, CborValue>>(n);
                var seenKeys = new List<CborValue>(n);
                for (int i = 0; i < n; i++)
                {
                    int keyStart = r.Pos;
                    var key = DecodeItem(r, depth + 1);
                    int keyEnd = r.Pos;
                    var value = DecodeItem(r, depth + 1);
                    if (seenKeys.Any(k => k.Equals(key)))
                        throw new AstboxError(E.DuplicateCborKey,
                            $"duplicate map key {key}");
                    seenKeys.Add(key);
                    result.Add(new KeyValuePair<CborValue, CborValue>(key, value));
                    // canonical key order: keys sorted by (encoded length, bytes)
                    int keyLen = keyEnd - keyStart;
                    var keyBytes = r.Data[keyStart..keyEnd];
                    if (prevEncoded is { } prev &&
                        (keyLen < prev.Len ||
                         (keyLen == prev.Len &&
                          keyBytes.AsSpan().SequenceCompareTo(prev.Bytes) <= 0)))
                    {
                        throw new AstboxError(E.NonCanonicalCbor,
                            "map keys not in canonical order");
                    }
                    prevEncoded = (keyLen, keyBytes.ToArray());
                }
                return CborValue.Map(result);
            }

            // majors 6 (tags) and 7 (floats/specials) are forbidden
            default:
                throw new AstboxError(E.InvalidCbor,
                    $"CBOR major type {major} forbidden in ASTBOX metadata");
        }
    }

    // ------------------------------------------------------------------
    // Canonical encoding (subset used by ASTBOX metadata)
    // ------------------------------------------------------------------

    private static byte[] EncodeUint(ulong value)
    {
        if (value < 24) return [(byte)value];
        if (value < 0x100) return [0x18, (byte)value];
        if (value < 0x1_0000)
        {
            var b = new byte[3];
            b[0] = 0x19;
            BinaryPrimitives.WriteUInt16BigEndian(b.AsSpan(1), (ushort)value);
            return b;
        }
        if (value < 0x1_0000_0000)
        {
            var b = new byte[5];
            b[0] = 0x1A;
            BinaryPrimitives.WriteUInt32BigEndian(b.AsSpan(1), (uint)value);
            return b;
        }
        {
            var b = new byte[9];
            b[0] = 0x1B;
            BinaryPrimitives.WriteUInt64BigEndian(b.AsSpan(1), value);
            return b;
        }
    }

    private static byte[] EncodeHead(int major, ulong length)
    {
        if (length < 24) return [(byte)((major << 5) | (int)length)];
        if (length < 0x100) return [(byte)((major << 5) | 24), (byte)length];
        if (length < 0x1_0000)
        {
            var b = new byte[3];
            b[0] = (byte)((major << 5) | 25);
            BinaryPrimitives.WriteUInt16BigEndian(b.AsSpan(1), (ushort)length);
            return b;
        }
        if (length < 0x1_0000_0000)
        {
            var b = new byte[5];
            b[0] = (byte)((major << 5) | 26);
            BinaryPrimitives.WriteUInt32BigEndian(b.AsSpan(1), (uint)length);
            return b;
        }
        {
            var b = new byte[9];
            b[0] = (byte)((major << 5) | 27);
            BinaryPrimitives.WriteUInt64BigEndian(b.AsSpan(1), length);
            return b;
        }
    }

    private static void AppendItem(List<byte> acc, CborValue obj)
    {
        switch (obj.Kind)
        {
            case CborValue.Kinds.UInt:
                acc.AddRange(EncodeUint(obj.AsUInt));
                break;

            case CborValue.Kinds.Bytes:
                acc.AddRange(EncodeHead(2, (ulong)obj.AsBytes.Length));
                acc.AddRange(obj.AsBytes);
                break;

            case CborValue.Kinds.Text:
            {
                // metadata strings are NFC-normalized
                var norm = obj.AsText.Normalize(NormalizationForm.FormC);
                var data = StrictUtf8.GetBytes(norm);
                acc.AddRange(EncodeHead(3, (ulong)data.Length));
                acc.AddRange(data);
                break;
            }

            case CborValue.Kinds.Array:
            {
                acc.AddRange(EncodeHead(4, (ulong)obj.Items.Count));
                foreach (var item in obj.Items)
                    AppendItem(acc, item);
                break;
            }

            case CborValue.Kinds.Map:
            {
                var ordered = obj.Entries
                    .Select(kv => (
                        Key: kv.Key,
                        Value: kv.Value,
                        EncKey: EncodeKey(kv.Key)))
                    .OrderBy(t => t.EncKey, ByteArrayOrderComparer.Instance)
                    .ToList();
                acc.AddRange(EncodeHead(5, (ulong)ordered.Count));
                foreach (var t in ordered)
                {
                    acc.AddRange(t.EncKey);
                    AppendItem(acc, t.Value);
                }
                break;
            }
        }
    }

    private static byte[] EncodeKey(CborValue k)
    {
        if (!k.IsUInt)
            throw new AstboxError(E.InvalidCbor, "map keys must be integers");
        return EncodeUint(k.AsUInt);
    }

    /// <summary>Canonically encode an ASTBOX metadata object.</summary>
    public static byte[] Dumps(CborValue obj)
    {
        var acc = new List<byte>(256);
        AppendItem(acc, obj);
        return acc.ToArray();
    }
}
