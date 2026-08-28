// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only

using Xunit;

namespace Astbox.Core.Tests;

public class CryptoTests
{
    [Fact]
    public void FullSelftest_AllVectorsPass()
    {
        // Throws AstboxError on any failure; returns human-readable results.
        var results = Crypto.Selftest();
        Assert.Contains(results, r => r.Contains("XChaCha20"));
        Assert.Contains(results, r => r.Contains("Argon2id"));
        Assert.Contains(results, r => r.Contains("TOTP"));
        Assert.Contains(results, r => r.Contains("HKDF"));
    }

    [Theory]
    [InlineData("", new byte[0])]
    [InlineData("JBSWY3DPEHPK3PXP", new byte[] {
        0x21, 0x26, 0x44, 0x75, 0x27, 0x09, 0xC4, 0x7C, 0xEA, 0xF3 })]
    [InlineData("jbsw y3dp ehpk 3pxp", new byte[] {
        0x21, 0x26, 0x44, 0x75, 0x27, 0x09, 0xC4, 0x7C, 0xEA, 0xF3 })]
    public void Base32Decode_KnownVectors(string input, byte[] expected)
    {
        Assert.Equal(expected, Crypto.Base32Decode(input));
    }

    [Fact]
    public void Base32EncodeDecode_Roundtrip()
    {
        for (int len = 0; len <= 40; len++)
        {
            var data = Crypto.RandomBytes(len);
            string encoded = Crypto.Base32Encode(data);
            Assert.False(encoded.EndsWith('='));
            Assert.Equal(data, Crypto.Base32Decode(encoded));
        }
    }

    [Fact]
    public void TotpAt_Rfc6238Vectors()
    {
        const string secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
        Assert.Equal("94287082", Crypto.TotpAt(secret, 8, t: 59));
        Assert.Equal("287082", Crypto.TotpAt(secret, 6, t: 59));
    }

    [Fact]
    public void AeadDecrypt_WrongKey_ThrowsAuthFailure()
    {
        var key = Crypto.RandomBytes(32);
        var nonce = Crypto.RandomBytes(24);
        var ct = Crypto.AeadEncrypt(key, nonce, "hello"u8.ToArray(), "aad"u8.ToArray());
        var wrongKey = Crypto.RandomBytes(32);
        var exc = Assert.Throws<AstboxError>(() =>
            Crypto.AeadDecrypt(wrongKey, nonce, ct, "aad"u8));
        Assert.Equal(E.AeadFailure, exc.Code);
    }

    [Fact]
    public void Argon2idRaw_Deterministic()
    {
        var sec = new byte[32]; Array.Fill(sec, (byte)7);
        var salt = new byte[16]; Array.Fill(salt, (byte)9);
        var a = Crypto.Argon2idRaw(sec, salt, 65536, 3, 1);
        var b = Crypto.Argon2idRaw(sec, salt, 65536, 3, 1);
        Assert.Equal(a, b);
        Assert.Equal(32, a.Length);
    }
}

public class CborDetTests
{
    [Fact]
    public void CanonicalRoundtrip_Tree()
    {
        var value = CborValue.Map(
            (1, CborValue.UInt(5)),
            (2, CborValue.Bytes(new byte[] { 1, 2, 3 })),
            (3, CborValue.Text("hello 世界")),
            (4, CborValue.Arr(CborValue.UInt(0), CborValue.Text("x"))),
            (5, CborValue.Map(
                (1, CborValue.Bytes(new byte[16])),
                (9, CborValue.UInt(ulong.MaxValue)))));
        var encoded = CborDet.Dumps(value);
        var decoded = CborDet.Loads(encoded);
        Assert.True(value.Equals(decoded));
        // canonical: re-encoding decoded value yields identical bytes
        Assert.Equal(encoded, CborDet.Dumps(decoded));
    }

    [Fact]
    public void Text_IsNfcNormalized_OnEncode()
    {
        // decomposed e + combining acute
        var decomposed = "cafe\u0301";
        var encoded = CborDet.Dumps(CborValue.Text(decomposed));
        var decoded = CborDet.Loads(encoded);
        Assert.Equal("caf\u00e9", decoded.AsText);   // precomposed é
    }

    [Theory]
    [InlineData("18")]                       // ai=24 but length 0 < 24 → non-minimal
    public void RejectsNonMinimalUint(string hex)
    {
        Assert.Throws<AstboxError>(() => CborDet.Loads(Convert.FromHexString(hex)));
    }

    [Fact]
    public void RejectsDuplicateMapKeys()
    {
        // map(2): {1: 0x00}, {1: 0x01} — duplicate key 1
        var bytes = new byte[] { 0xA2, 0x01, 0x00, 0x01, 0x01 };
        var exc = Assert.Throws<AstboxError>(() => CborDet.Loads(bytes));
        Assert.Equal(E.DuplicateCborKey, exc.Code);
    }

    [Fact]
    public void RejectsNonCanonicalKeyOrder()
    {
        // map(2): {2: 0} then {1: 0} — keys must ascend
        var bytes = new byte[] { 0xA2, 0x02, 0x00, 0x01, 0x00 };
        var exc = Assert.Throws<AstboxError>(() => CborDet.Loads(bytes));
        Assert.Equal(E.NonCanonicalCbor, exc.Code);
    }

    [Fact]
    public void RejectsNegativeInteger()
    {
        var exc = Assert.Throws<AstboxError>(() =>
            CborDet.Loads(new byte[] { 0x20 }));
        Assert.Equal(E.InvalidCbor, exc.Code);
    }

    [Fact]
    public void RejectsFloatAndTag()
    {
        Assert.Throws<AstboxError>(() =>
            CborDet.Loads(new byte[] { 0xFB, 0, 0, 0, 0, 0, 0, 0, 0 }));
        Assert.Throws<AstboxError>(() =>
            CborDet.Loads(new byte[] { 0xC0, 0x00 }));
    }

    [Fact]
    public void RejectsIndefiniteLength()
    {
        Assert.Throws<AstboxError>(() =>
            CborDet.Loads(new byte[] { 0x9F, 0xFF }));
    }

    [Fact]
    public void RejectsTrailingBytes()
    {
        var exc = Assert.Throws<AstboxError>(() =>
            CborDet.Loads(new byte[] { 0x00, 0x00 }));
        Assert.Equal(E.InvalidCbor, exc.Code);
    }
}
