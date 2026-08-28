// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
//! ASTBOX v1.0 cryptographic primitives (port of astbox/crypto.py,
//! ASTBOX-v1.0-02-Key-Crypto.txt).
//!
//! Native path : NSec (libsodium) — Argon2id raw output + XChaCha20-Poly1305.
//! Fallback    : pure C# XChaCha20-Poly1305 (RFC 8439 + HChaCha20), validated
//!               against libsodium by Selftest() — mirrors the Python design.

using System.Buffers.Binary;
using System.Numerics;
using System.Security.Cryptography;
using NSec.Cryptography;

namespace Astbox;

/// <summary>The five ASTBOX subkeys derived from VaultKey.</summary>
public sealed record Subkeys(
    byte[] Header, byte[] Metadata, byte[] Data, byte[] SlotMac, byte[] Footer);

public static partial class Crypto
{
    private const int AeadTagSize = 16;

    // ------------------------------------------------------------------
    // Argon2id (raw output)
    //
    // Dual-path design (important):
    //   - ASTBOX KeySlot salts are 32 bytes and profiles may specify p>1;
    //     libsodium/NSec only accept 16-byte salts with p==1, so the fully
    //     compatible path is Konscious (managed, RFC 9106).
    //   - For 16-byte-salt + p==1 inputs we take the NSec/libsodium fast
    //     path; Selftest() cross-validates both implementations bitwise.
    // ------------------------------------------------------------------

    public static byte[] Argon2idRaw(
        ReadOnlySpan<byte> secret, ReadOnlySpan<byte> salt,
        uint memoryKiB, uint timeCost, uint parallelism, int hashLen = 32)
    {
        if (salt.Length == 16 && parallelism == 1)
        {
            // fast path: libsodium via NSec (MemorySize is expressed in KiB)
            try
            {
                var alg = new Argon2id(new Argon2Parameters
                {
                    DegreeOfParallelism = 1,
                    MemorySize = memoryKiB,
                    NumberOfPasses = timeCost,
                });
                return alg.DeriveBytes(secret, salt, hashLen);
            }
            catch (Exception exc) when (exc is not AstboxError)
            {
                throw MapArgonError(exc, memoryKiB);
            }
        }

        // compatible path: Konscious managed implementation
        try
        {
            return Argon2idRawKonscious(secret, salt,
                memoryKiB, timeCost, parallelism, hashLen);
        }
        catch (Exception exc) when (exc is not AstboxError)
        {
            throw MapArgonError(exc, memoryKiB);
        }
    }

    /// <summary>Force the fully-managed Konscious path (used by Selftest
    /// to cross-validate against the libsodium fast path).</summary>
    public static byte[] Argon2idRawKonscious(
        ReadOnlySpan<byte> secret, ReadOnlySpan<byte> salt,
        uint memoryKiB, uint timeCost, uint parallelism, int hashLen)
    {
        try
        {
            using var argon2 = new Konscious.Security.Cryptography.Argon2id(
                secret.ToArray())
            {
                Salt = salt.ToArray(),
                MemorySize = (int)memoryKiB,
                Iterations = (int)timeCost,
                DegreeOfParallelism = (int)parallelism,
            };
            return argon2.GetBytes(hashLen);
        }
        catch (Exception exc) when (exc is not AstboxError)
        {
            throw MapArgonError(exc, memoryKiB);
        }
    }

    private static AstboxError MapArgonError(Exception exc, uint memoryKiB)
    {
        var msg = exc.Message ?? string.Empty;
        if (exc is OutOfMemoryException ||
            msg.Contains("memory", StringComparison.OrdinalIgnoreCase))
            return new AstboxError(E.KdfResourceLimit,
                $"Argon2id requires {memoryKiB} KiB of memory which could " +
                $"not be allocated.");
        return new AstboxError(E.KdfFailure, $"Argon2id failed: {msg}");
    }

    // ------------------------------------------------------------------
    // XChaCha20-Poly1305 — direct libsodium P/Invoke
    //
    // NOTE: We deliberately bypass NSec's AEAD wrapper here: it stores keys
    // in libsodium guarded (mprotect'ed) memory via SecureMemoryHandle,
    // which proved unreliable inside restricted application-control
    // environments. Raw byte[] marshalling is used instead.
    // ------------------------------------------------------------------

    public static partial class Sodium
    {
        private const string Lib = "libsodium";

        [System.Runtime.InteropServices.LibraryImport(Lib,
            EntryPoint = "crypto_aead_xchacha20poly1305_ietf_encrypt")]
        internal static partial int XChaChaEncrypt(
            byte[] c, out long clenLen,
            byte[] m, long mLen,
            byte[] ad, long adLen,
            System.IntPtr nSec,
            byte[] npub, byte[] key);

        // Raw XChaCha20 stream (RFC-style: block counter starts at 0, so the
        // full keystream INCLUDING the Poly1305-OTK region is exposed).
        [System.Runtime.InteropServices.DllImport(Lib,
            EntryPoint = "crypto_stream_xchacha20_xor",
            CallingConvention = System.Runtime.InteropServices.CallingConvention.Cdecl)]
        public static extern int StreamXChaChaXor(
            byte[] c, byte[] m, long mLen,
            byte[] n, byte[] k);
    }

    /// <summary>XChaCha20-Poly1305. Returns ciphertext||tag (ptLen + 16).</summary>
    public static byte[] AeadEncrypt(byte[] key, byte[] nonce,
        ReadOnlySpan<byte> plaintext, ReadOnlySpan<byte> aad)
    {
        if (key.Length != 32)
            throw new AstboxError(E.AeadFailure, "XChaCha key must be 32 bytes");
        if (nonce.Length != 24)
            throw new AstboxError(E.AeadFailure, "XChaCha nonce must be 24 bytes");
        var pt = plaintext.ToArray();
        var ad = aad.ToArray();
        var ct = new byte[pt.Length + AeadTagSize];
        int rc = Sodium.XChaChaEncrypt(ct, out long clen,
            pt, pt.Length, ad, ad.Length, IntPtr.Zero, nonce, key);
        if (rc != 0 || clen != ct.Length)
            throw new AstboxError(E.AeadFailure, "XChaCha20-Poly1305 encrypt failed");
        return ct;
    }

    /// <summary>Raw XChaCha20 keystream (block counter 0.., includes the
    /// Poly1305-OTK region), via the native stream primitive.</summary>
    private static byte[] XChaChaStream(byte[] key, byte[] nonce, int length)
    {
        var zeros = new byte[length];
        var raw = new byte[length];
        int rc = Sodium.StreamXChaChaXor(raw, zeros, length, nonce, key);
        if (rc != 0)
            throw new AstboxError(E.AeadFailure, "XChaCha20 stream failed");
        return raw;
    }

    /// <summary>XChaCha20-Poly1305 decrypt; raises AstboxError on auth failure.
    /// Implemented as keystream XOR + Poly1305 verification because this
    /// environment's libsodium AEAD-decrypt entry point crashes under
    /// NativeAOT; the stream primitive is draft-vector verified.</summary>
    public static byte[] AeadDecrypt(byte[] key, byte[] nonce,
        ReadOnlySpan<byte> ctWithTag, ReadOnlySpan<byte> aad)
    {
        if (ctWithTag.Length < AeadTagSize)
            throw new AstboxError(E.AeadFailure, "ciphertext shorter than tag");
        if (nonce.Length != 24)
            throw new AstboxError(E.AeadFailure, "XChaCha nonce must be 24 bytes");
        int bodyLen = ctWithTag.Length - AeadTagSize;
        // RFC 8439 layout over the RAW stream: counter-0 block provides the
        // Poly1305 OTK (bytes 0..32); ciphertext keystream starts at byte 64.
        var raw = XChaChaStream(key, nonce, 64 + bodyLen);
        var body = ctWithTag.Slice(0, bodyLen).ToArray();
        var expect = Poly1305(MacData(aad, body), raw.AsSpan(0, 32));
        if (!ConstantTimeEquals(expect, ctWithTag.Slice(bodyLen)))
            throw new AstboxError(E.AeadFailure, "authentication failed");
        var pt = new byte[bodyLen];
        for (int i = 0; i < bodyLen; i++)
            pt[i] = (byte)(body[i] ^ raw[64 + i]);
        return pt;
    }

    // ------------------------------------------------------------------
    // Pure C# XChaCha20-Poly1305 (fallback; validated against native)
    // ------------------------------------------------------------------

    private static uint Rotl32(uint x, int n) => (x << n) | (x >> (32 - n));

    private static readonly uint[] Const =
        { 0x61707865u, 0x3320646Eu, 0x79622D32u, 0x6B206574u };

    private static void Quarter(ref uint a, ref uint b, ref uint c, ref uint d)
    {
        a += b; d = Rotl32(d ^ a, 16);
        c += d; b = Rotl32(b ^ c, 12);
        a += b; d = Rotl32(d ^ a, 8);
        c += d; b = Rotl32(b ^ c, 7);
    }

    private static void ChaChaRounds(Span<uint> s)
    {
        Quarter(ref s[0], ref s[4], ref s[8], ref s[12]);
        Quarter(ref s[1], ref s[5], ref s[9], ref s[13]);
        Quarter(ref s[2], ref s[6], ref s[10], ref s[14]);
        Quarter(ref s[3], ref s[7], ref s[11], ref s[15]);
        Quarter(ref s[0], ref s[5], ref s[10], ref s[15]);
        Quarter(ref s[1], ref s[6], ref s[11], ref s[12]);
        Quarter(ref s[2], ref s[7], ref s[8], ref s[13]);
        Quarter(ref s[3], ref s[4], ref s[9], ref s[14]);
    }

    private static uint LoadLe32(ReadOnlySpan<byte> b, int i)
        => b[i] | ((uint)b[i + 1] << 8) | ((uint)b[i + 2] << 16) | ((uint)b[i + 3] << 24);

    private static void StoreLe32(Span<byte> dst, uint v)
    {
        dst[0] = (byte)v; dst[1] = (byte)(v >> 8);
        dst[2] = (byte)(v >> 16); dst[3] = (byte)(v >> 24);
    }

    /// <summary>HChaCha20: key=32B, nonce16=16B → 32B subkey.</summary>
    public static byte[] HChaCha20(ReadOnlySpan<byte> key, ReadOnlySpan<byte> nonce16)
    {
        Span<uint> state = stackalloc uint[16];
        Span<uint> working = stackalloc uint[16];
        for (int i = 0; i < 4; i++) state[i] = Const[i];
        for (int i = 0; i < 8; i++) state[4 + i] = LoadLe32(key, i * 4);
        for (int i = 0; i < 4; i++) state[12 + i] = LoadLe32(nonce16, i * 4);
        state.CopyTo(working);
        for (int i = 0; i < 10; i++) ChaChaRounds(working);
        var output = new byte[32];
        for (int i = 0; i < 4; i++) StoreLe32(output.AsSpan(i * 4), working[i]);
        for (int i = 0; i < 4; i++) StoreLe32(output.AsSpan(16 + i * 4), working[12 + i]);
        return output;
    }

    /// <summary>ChaCha20 block, RFC 8439 layout: word12=counter, 13-15=nonce.</summary>
    private static byte[] ChaCha20BlockIetf(
        ReadOnlySpan<byte> key, ReadOnlySpan<byte> nonce12, uint counter)
    {
        Span<uint> state = stackalloc uint[16];
        Span<uint> working = stackalloc uint[16];
        for (int i = 0; i < 4; i++) state[i] = Const[i];
        for (int i = 0; i < 8; i++) state[4 + i] = LoadLe32(key, i * 4);
        state[12] = counter;
        for (int i = 0; i < 3; i++) state[13 + i] = LoadLe32(nonce12, i * 4);
        state.CopyTo(working);
        for (int i = 0; i < 10; i++) ChaChaRounds(working);
        var output = new byte[64];
        for (int i = 0; i < 16; i++)
            StoreLe32(output.AsSpan(i * 4), state[i] + working[i]);
        return output;
    }

    private static byte[] ChaCha20IetfXor(
        ReadOnlySpan<byte> key, ReadOnlySpan<byte> nonce12,
        ReadOnlySpan<byte> data, uint initialCounter = 0)
    {
        var output = new byte[data.Length];
        uint counter = initialCounter;
        for (int off = 0; off < data.Length; off += 64)
        {
            var block = ChaCha20BlockIetf(key, nonce12, counter);
            int chunk = Math.Min(64, data.Length - off);
            for (int i = 0; i < chunk; i++)
                output[off + i] = (byte)(data[off + i] ^ block[i]);
            counter++;
        }
        return output;
    }

    private static readonly BigInteger PolyP = (BigInteger.One << 130) - 5;

    private static BigInteger FromLittleEndian(ReadOnlySpan<byte> le)
    {
        // BigInteger(byte[]) interprets input as little-endian two's
        // complement; pad a zero byte so high-bit blocks stay positive.
        var buf = new byte[le.Length + 1];
        le.CopyTo(buf);
        return new BigInteger(buf);
    }

    private static byte[] Poly1305(ReadOnlySpan<byte> msg, ReadOnlySpan<byte> key32)
    {
        var rBytes = key32[..16].ToArray();
        // clamp
        rBytes[3] &= 15; rBytes[7] &= 15; rBytes[11] &= 15; rBytes[15] &= 15;
        rBytes[4] &= 252; rBytes[8] &= 252; rBytes[12] &= 252;
        BigInteger r = FromLittleEndian(rBytes);
        BigInteger s = FromLittleEndian(key32[16..32]);
        BigInteger acc = BigInteger.Zero;
        for (int i = 0; i < msg.Length; i += 16)
        {
            int len = Math.Min(16, msg.Length - i);
            var block = msg.Slice(i, len).ToArray();
            BigInteger n = FromLittleEndian(block) + (BigInteger.One << (8 * len));
            acc = (acc + n) * r % PolyP;
        }
        acc = (acc + s) & ((BigInteger.One << 128) - 1);
        var outp = new byte[16];
        var ab = acc.ToByteArray();          // little-endian, possibly shorter
        Array.Copy(ab, outp, Math.Min(ab.Length, 16));
        return outp;
    }

    private static byte[] Pad16(ReadOnlySpan<byte> data)
    {
        int rem = data.Length % 16;
        if (rem == 0) return data.ToArray();
        var padded = new byte[data.Length + (16 - rem)];
        data.CopyTo(padded);
        return padded;
    }

    private static byte[] MacData(ReadOnlySpan<byte> aad, ReadOnlySpan<byte> ct)
    {
        var ms = new List<byte>(aad.Length + ct.Length + 32);
        ms.AddRange(Pad16(aad));
        ms.AddRange(Pad16(ct));
        var lens = new byte[16];
        BinaryPrimitives.WriteUInt64LittleEndian(lens.AsSpan(0), (ulong)aad.Length);
        BinaryPrimitives.WriteUInt64LittleEndian(lens.AsSpan(8), (ulong)ct.Length);
        ms.AddRange(lens);
        return ms.ToArray();
    }

    private static byte[] Chacha20Poly1305EncryptManaged(
        ReadOnlySpan<byte> key, ReadOnlySpan<byte> nonce12,
        ReadOnlySpan<byte> plaintext, ReadOnlySpan<byte> aad)
    {
        var otkBlock = ChaCha20BlockIetf(key, nonce12, 0);
        var otk = otkBlock.AsSpan(0, 32).ToArray();
        var ct = ChaCha20IetfXor(key, nonce12, plaintext, initialCounter: 1);
        var tag = Poly1305(MacData(aad, ct), otk);
        var output = new byte[ct.Length + 16];
        ct.CopyTo(output, 0);
        tag.CopyTo(output, ct.Length);
        return output;
    }

    private static byte[] Chacha20Poly1305DecryptManaged(
        ReadOnlySpan<byte> key, ReadOnlySpan<byte> nonce12,
        ReadOnlySpan<byte> ctWithTag, ReadOnlySpan<byte> aad)
    {
        if (ctWithTag.Length < 16)
            throw new ArgumentException("ciphertext too short");
        var ct = ctWithTag[..^16].ToArray();
        var tag = ctWithTag[^16..].ToArray();
        var otkBlock = ChaCha20BlockIetf(key, nonce12, 0);
        var otk = otkBlock.AsSpan(0, 32).ToArray();
        var expect = Poly1305(MacData(aad, ct), otk);
        if (!ConstantTimeEquals(expect, tag))
            throw new CryptographicException("authentication failed");
        return ChaCha20IetfXor(key, nonce12, ct, initialCounter: 1);
    }

    /// <summary>Pure-C# XChaCha20-Poly1305 encrypt (fallback path).</summary>
    public static byte[] XChaChaPoly1305EncryptManaged(
        byte[] key, byte[] nonce24, ReadOnlySpan<byte> plaintext,
        ReadOnlySpan<byte> aad)
    {
        var subkey = HChaCha20(key, nonce24.AsSpan(0, 16));
        Span<byte> nonce12 = stackalloc byte[12];
        nonce12[0] = nonce12[1] = nonce12[2] = nonce12[3] = 0;
        nonce24.AsSpan(16, 8).CopyTo(nonce12[4..]);
        return Chacha20Poly1305EncryptManaged(subkey, nonce12, plaintext, aad);
    }

    /// <summary>Pure-C# XChaCha20-Poly1305 decrypt (fallback path).</summary>
    public static byte[] XChaChaPoly1305DecryptManaged(
        byte[] key, byte[] nonce24, ReadOnlySpan<byte> ctWithTag,
        ReadOnlySpan<byte> aad)
    {
        var subkey = HChaCha20(key, nonce24.AsSpan(0, 16));
        Span<byte> nonce12 = stackalloc byte[12];
        nonce12[0] = nonce12[1] = nonce12[2] = nonce12[3] = 0;
        nonce24.AsSpan(16, 8).CopyTo(nonce12[4..]);
        return Chacha20Poly1305DecryptManaged(subkey, nonce12, ctWithTag, aad);
    }

    // ------------------------------------------------------------------
    // HKDF-SHA-256 (RFC 5869)
    // ------------------------------------------------------------------

    public static byte[] HkdfExtract(ReadOnlySpan<byte> salt, ReadOnlySpan<byte> ikm)
    {
        byte[] realSalt = salt.IsEmpty ? new byte[32] : salt.ToArray();
        return HKDF.Extract(HashAlgorithmName.SHA256, ikm.ToArray(), realSalt);
    }

    public static byte[] HkdfExpand(
        ReadOnlySpan<byte> prk, ReadOnlySpan<byte> info, int length)
    {
        if (length > 255 * 32)
            throw new AstboxError(E.InvalidArgument,
                "HKDF-Expand output too long");
        return HKDF.Expand(HashAlgorithmName.SHA256, prk.ToArray(), length,
            info.IsEmpty ? null : info.ToArray());
    }

    /// <summary>Derive the five ASTBOX subkeys from VaultKey (doc 02 §31).</summary>
    public static Subkeys HkdfDerive(ReadOnlySpan<byte> vaultKey,
        ReadOnlySpan<byte> vaultId)
    {
        var salt = new byte[Constants.LabelHkdfSalt.Length + vaultId.Length];
        Constants.LabelHkdfSalt.CopyTo(salt);
        vaultId.CopyTo(salt.AsSpan(Constants.LabelHkdfSalt.Length));

        var prk = HkdfExtract(salt, vaultKey);
        return new Subkeys(
            Header: HkdfExpand(prk, Constants.LabelHdrm, 32),
            Metadata: HkdfExpand(prk, Constants.LabelMeta, 32),
            Data: HkdfExpand(prk, Constants.LabelData, 32),
            SlotMac: HkdfExpand(prk, Constants.LabelSlotm, 32),
            Footer: HkdfExpand(prk, Constants.LabelFoot, 32));
    }

    // ------------------------------------------------------------------
    // HMAC helpers
    // ------------------------------------------------------------------

    public static byte[] HmacSha256Trunc16(ReadOnlySpan<byte> key,
        ReadOnlySpan<byte> message)
    {
        using var h = new HMACSHA256(key.ToArray());
        var digest = h.ComputeHash(message.ToArray());
        return digest[..16];
    }

    public static byte[] Sha256First16(ReadOnlySpan<byte> data)
        => SHA256.HashData(data)[..16];

    /// <summary>Constant-time comparison (equal-length guarded).</summary>
    public static bool ConstantTimeEquals(
        ReadOnlySpan<byte> a, ReadOnlySpan<byte> b)
        => a.Length == b.Length && CryptographicOperations.FixedTimeEquals(a, b);

    // ------------------------------------------------------------------
    // TOTP credential / Argon2 input
    // ------------------------------------------------------------------

    /// <summary>Domain-separated Argon2id input (doc 02 §18).</summary>
    public static byte[] BuildArgon2Input(
        ushort credentialType, byte credentialParameters,
        ReadOnlySpan<byte> credential)
    {
        var buf = new byte[2 + 1 + Constants.LabelKdf.Length + credential.Length];
        BinaryPrimitives.WriteUInt16BigEndian(buf, credentialType);
        buf[2] = credentialParameters;
        Constants.LabelKdf.CopyTo(buf.AsSpan(3));
        credential.CopyTo(buf.AsSpan(3 + Constants.LabelKdf.Length));
        return buf;
    }

    /// <summary>RFC 6238 TOTP with HMAC-SHA-1, 30 s period, T0=0.</summary>
    public static string TotpAt(string secretBase32, int digits, long? t = null)
    {
        if (digits is not (6 or 8))
            throw new AstboxError(E.InvalidTotp, "TOTP digits must be 6 or 8");
        byte[] secret;
        try { secret = Base32Decode(secretBase32); }
        catch (AstboxError)
        {
            throw new AstboxError(E.InvalidTotp, "invalid Base32 TOTP secret");
        }
        if (secret.Length == 0)
            throw new AstboxError(E.InvalidTotp, "empty TOTP secret");

        long now = t ?? DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        long counter = (now - Constants.TotpT0) / Constants.TotpPeriod;
        Span<byte> msg = stackalloc byte[8];
        BinaryPrimitives.WriteUInt64BigEndian(msg, (ulong)counter);

        using var hmac = new HMACSHA1(secret);
        var digest = hmac.ComputeHash(msg.ToArray());
        int offset = digest[^1] & 0x0F;
        uint code = (((uint)digest[offset] & 0x7Fu) << 24)
                    | ((uint)digest[offset + 1] << 16)
                    | ((uint)digest[offset + 2] << 8)
                    | digest[offset + 3];
        code %= (uint)Math.Pow(10, digits);
        return code.ToString(new string('0', digits));
    }

    /// <summary>RFC 4648 Base32 (case-insensitive; spaces/padding tolerated).</summary>
    public static byte[] Base32Decode(string input)
    {
        const string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        var sb = new System.Text.StringBuilder(input.Length);
        foreach (var ch in input.Trim().ToUpperInvariant())
        {
            if (ch == ' ' || ch == '-' || ch == '=') continue;
            sb.Append(ch);
        }
        string clean = sb.ToString();
        int bitBuf = 0, bits = 0;
        var output = new List<byte>(clean.Length * 5 / 8 + 1);
        foreach (var ch in clean)
        {
            int val = alphabet.IndexOf(ch);
            if (val < 0)
                throw new AstboxError(E.InvalidArgument,
                    $"invalid Base32 character '{ch}'");
            bitBuf = (bitBuf << 5) | val;
            bits += 5;
            if (bits >= 8)
            {
                output.Add((byte)(bitBuf >> (bits - 8)));
                bits -= 8;
            }
        }
        return output.ToArray();
    }

    /// <summary>RFC 4648 Base32 encode (unpadded).</summary>
    public static string Base32Encode(ReadOnlySpan<byte> data)
    {
        const string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        var sb = new System.Text.StringBuilder((data.Length * 8 + 4) / 5);
        int bitBuf = 0, bits = 0;
        foreach (var b in data)
        {
            bitBuf = (bitBuf << 8) | b;
            bits += 8;
            while (bits >= 5)
            {
                sb.Append(alphabet[(bitBuf >> (bits - 5)) & 31]);
                bits -= 5;
            }
        }
        if (bits > 0)
            sb.Append(alphabet[(bitBuf << (5 - bits)) & 31]);
        return sb.ToString();
    }

    public static byte[] RandomBytes(int n) => RandomNumberGenerator.GetBytes(n);

    // ------------------------------------------------------------------
    // Self-test vectors (mirrors crypto.selftest())
    // ------------------------------------------------------------------

    // draft-irtf-cfrg-xchacha-03 appendix A.3.1 (XChaCha20-Poly1305)
    private static readonly byte[] VecKey = Convert.FromHexString(
        "808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f");
    private static readonly byte[] VecNonce = Convert.FromHexString(
        "404142434445464748494a4b4c4d4e4f5051525354555657");
    private static readonly byte[] VecAad = Convert.FromHexString(
        "50515253c0c1c2c3c4c5c6c7");
    private static readonly byte[] VecPlaintext =
        "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it."u8.ToArray();
    private static readonly byte[] VecCiphertext = Convert.FromHexString(
        "bd6d179d3e83d43b9576579493c0e939572a1700252bfaccbed2902c21396cbb" +
        "731c7f1b0b4aa6440bf3a82f4eda7e39ae64c6708c54c216cb96b72e1213b452" +
        "2f8c9ba40db5d945b11b69b982c1bb9e3f3fac2bc369488f76b2383565d3fff9" +
        "21f9664c97637da9768812f615c68b13b52e");
    private static readonly byte[] VecTag = Convert.FromHexString(
        "c0875924c1c7987947deafd8780acf49");

    // draft-irtf-cfrg-xchacha-03 section 2.2.1 (HChaCha20 block function)
    private static readonly byte[] HVecKey = Convert.FromHexString(
        "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
    private static readonly byte[] HVecNonce = Convert.FromHexString(
        "000000090000004a0000000031415927");
    private static readonly byte[] HVecOut = Convert.FromHexString(
        "82413b4227b27bfed30e42508a877d73a0f9e4d58a74a853c12ec41326d3ecdc");

    /// <summary>Run cryptographic self-tests; raise AstboxError on failure.</summary>
    public static List<string> Selftest()
    {
        var results = new List<string>();
        void Check(bool cond, string what)
        {
            if (!cond) throw new AstboxError(E.CryptoFailure, what);
        }

        // 1) XChaCha20-Poly1305 draft vector (native / libsodium)
        {
            var output = AeadEncrypt(VecKey, VecNonce, VecPlaintext, VecAad);
            var ct = output[..^16];
            var tag = output[^16..];
            Check(ct.AsSpan().SequenceEqual(VecCiphertext),
                "XChaCha20 ciphertext mismatch: got " +
                Convert.ToHexString(ct, 0, Math.Min(24, ct.Length)) +
                " want " +
                Convert.ToHexString(VecCiphertext, 0,
                    Math.Min(24, VecCiphertext.Length)));
            Check(tag.AsSpan().SequenceEqual(VecTag), "XChaCha20 tag mismatch");
            results.Add("XChaCha20-Poly1305 (native) vector OK");
        }

        // 2) HChaCha20 block-function vector (draft section 2.2.1)
        {
            var h = HChaCha20(HVecKey, HVecNonce);
            Check(h.AsSpan().SequenceEqual(HVecOut), "HChaCha20 vector mismatch");
            results.Add("HChaCha20 vector OK");
        }

        // 3) Pure-C# implementation matches the native one on random data.
        {
            for (int i = 0; i < 3; i++)
            {
                var key = RandomBytes(32);
                var nonce = RandomBytes(24);
                var aad = RandomBytes(i * 7);
                var msg = RandomBytes(1 + i * 40);
                var reference = AeadEncrypt(key, nonce, msg, aad);
                var mine = XChaChaPoly1305EncryptManaged(key, nonce, msg, aad);
                Check(mine.AsSpan().SequenceEqual(reference),
                    "pure-C# XChaCha20 != native");
                var back = XChaChaPoly1305DecryptManaged(key, nonce, mine, aad);
                Check(back.AsSpan().SequenceEqual(msg),
                    "pure-C# XChaCha20 roundtrip failed");
            }
            results.Add("XChaCha20-Poly1305 pure-C# == native (3 cases)");
        }

        // 4) HKDF known-answer (RFC 5869 test case 1).
        {
            var ikm = new byte[22]; Array.Fill(ikm, (byte)0x0b);
            var salt = Enumerable.Range(0x00, 13).Select(x => (byte)x).ToArray();
            var info = Enumerable.Range(0xF0, 10).Select(x => (byte)x).ToArray();
            var prk = HkdfExtract(salt, ikm);
            var okm = HkdfExpand(prk, info, 42);
            Check(Convert.ToHexString(prk) ==
                "077709362C2E32DF0DDC3F0DC47BBA6390B6C73BB50F9C3122EC844AD7C2B3E5",
                "HKDF PRK");
            Check(Convert.ToHexString(okm) ==
                "3CB25F25FAACD57A90434F64D0362F2A" +
                "2D2D0A90CF1A5A4C5DB02D56ECC4C5BF" +
                "34007208D5B887185865",
                "HKDF OKM");
            results.Add("HKDF-SHA-256 RFC 5869 vector OK");
        }

        // 5) Argon2id API/determinism smoke test (reference C regression value;
        //    ASTBOX never uses Argon2 secret/ad — doc 02 §18).
        {
            var sec = new byte[32]; Array.Fill(sec, (byte)0x01);
            var salt = new byte[16]; Array.Fill(salt, (byte)0x02);
            var output = Argon2idRaw(sec, salt,
                memoryKiB: 32, timeCost: 3, parallelism: 4, hashLen: 32);
            Check(output.Length == 32, "Argon2id output length");
            Check(Convert.ToHexString(output) ==
                "03AAB965C12001C9D7D0D2DE33192C0494B684BB148196D73C1DF1ACAF6D0C2E",
                "Argon2id regression mismatch");
            results.Add("Argon2id smoke/regression OK");

            // 5b) dual-path cross-check: libsodium fast path must equal the
            //     managed reference-compatible implementation bit-for-bit.
            {
                var sec5b = RandomBytes(32);
                var salt5b = RandomBytes(16);   // 16B + p==1 → NSec fast path
                var viaNative = Argon2idRaw(sec5b, salt5b, 16384, 2, 1);
                var viaManaged = Argon2idRawKonscious(sec5b, salt5b, 16384, 2, 1, 32);
                Check(viaNative.AsSpan().SequenceEqual(viaManaged),
                    "Argon2id NSec != Konscious");
            }
            results.Add("Argon2id NSec==Konscious cross-check OK");
        }

        // 6) TOTP RFC 6238 appendix B vectors.
        {
            const string testSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
            Check(TotpAt(testSecret, 8, t: 59) == "94287082",
                "TOTP 8-digit vector mismatch");
            Check(TotpAt(testSecret, 6, t: 59) == "287082",
                "TOTP 6-digit vector mismatch");
            results.Add("TOTP RFC 6238 vectors OK");
        }

        return results;
    }
}
