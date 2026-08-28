// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
//! ASTBOX propagation package (.passbox) — self-contained credential wrapper
//! (port of astbox/passbox.py).
//!
//! Layout:
//!   MAGIC       16B   b"ASTPASSBX1" + 6x\0
//!   HDRLEN       4B   big-endian, JSON header byte count
//!   HEADER      JSON   {v, digits, created?, name, csha?, wrap:"none"|"pass",
//!                       salt/snonce/kdf (pass only)}
//!   SECRETLEN    4B   big-endian
//!   SECRET_BLK         none: Base32 ASCII; pass: XChaCha20-Poly1305(
//!                          key=Argon2id("ASTBOX-PASSBOX-v1"+passphrase,...),
//!                          aad=MAGIC)
//!   CONTAINER          complete .astbox bytes
//!   TRAILER     32B    SHA-256 of all preceding content

using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Astbox;

/// <summary>Propagation-package error code used by the reference impl.</summary>
public static class PassboxError
{
    public const ushort Code = 0x0399;
}

public sealed record PassboxInfo(
    JsonElement Header, bool NeedsPassphrase);

public sealed record PassboxUnwrapResult(
    string SecretBase32, JsonElement Header, string ContainerPath);

public static class PassboxFile
{
    public static readonly byte[] Magic =
        "ASTPASSBX1"u8.ToArray().Concat(new byte[6]).ToArray();
    private static readonly byte[] PbDomain = "ASTBOX-PASSBOX-v1"u8.ToArray();
    private const int SaltLen = 16;

    private static AstboxError Err(string msg) => new(PassboxError.Code, msg);

    private static byte[] DeriveWrapKey(string passphrase,
        ReadOnlySpan<byte> salt, uint memKiB, uint t, uint p)
    {
        var input = new byte[PbDomain.Length + Encoding.UTF8.GetByteCount(passphrase)];
        PbDomain.CopyTo(input, 0);
        Encoding.UTF8.GetBytes(passphrase).CopyTo(input, PbDomain.Length);
        return Crypto.Argon2idRaw(input, salt, memKiB, t, p, 32);
    }

    /// <summary>Pack a container and its Base32 secret into a .passbox file.
    /// passphrase=null produces a no-passphrase quick pack; streaming copy.</summary>
    public static string PackPassbox(string astboxPath, string secretB32,
        int digits, long? created, string outPath, string? passphrase = null)
    {
        if (!File.Exists(astboxPath))
            throw Err($"容器文件不存在: {astboxPath}");
        string norm = secretB32.Trim().ToUpperInvariant().Replace(" ", "");
        byte[] raw;
        try
        {
            raw = Crypto.Base32Decode(norm);
            if (raw.Length < 10) throw new AstboxError(E.InvalidArgument, "short");
        }
        catch (AstboxError)
        {
            throw Err("无效的 Base32 密钥");
        }
        _ = raw;

        // prepare secret block first
        byte[] blk;
        byte[]? salt = null, snonce = null;
        uint kMem = 0, kT = 0, kP = 0;
        string wrapMode;
        if (passphrase is not null)
        {
            salt = Crypto.RandomBytes(SaltLen);
            snonce = Crypto.RandomBytes(24);
            (kMem, kT, kP) =
                Constants.Argon2Profile(Constants.KdfProfileMemoryConstrained);
            var wk = DeriveWrapKey(passphrase, salt, kMem, kT, kP);
            blk = Crypto.AeadEncrypt(wk, snonce,
                Encoding.ASCII.GetBytes(norm), Magic);
            wrapMode = "pass";
        }
        else
        {
            blk = Encoding.ASCII.GetBytes(norm);
            wrapMode = "none";
        }

        // JSON header, keys in sorted order (matches json.dumps(sort_keys=True))
        // C# 扩展(有意偏离 python 参考实现): 写入 csha 使导入端强制校验内嵌容器
        string cshaHex = Convert.ToHexStringLower(
            SHA256.HashData(File.ReadAllBytes(astboxPath)));
        using var ms = new MemoryStream();
        using (var writer = new Utf8JsonWriter(ms))
        {
            writer.WriteStartObject();
            if (created is { } c)
                writer.WriteNumber("created", c);
            else
                writer.WriteNull("created");
            writer.WriteString("csha", cshaHex);
            writer.WriteNumber("digits", digits);
            if (wrapMode == "pass")
            {
                writer.WritePropertyName("salt");
                writer.WriteStringValue(Convert.ToHexString(salt!).ToLowerInvariant());
                writer.WritePropertyName("snonce");
                writer.WriteStringValue(Convert.ToHexString(snonce!).ToLowerInvariant());
                writer.WriteStartObject("kdf");
                writer.WriteNumber("mem_kib", kMem);
                writer.WriteNumber("p", kP);
                writer.WriteNumber("t", kT);
                writer.WriteEndObject();
            }
            writer.WriteString("name", Path.GetFileName(astboxPath));
            writer.WriteString("wrap", wrapMode);
            writer.WriteEndObject();
        }
        byte[] headerBytes = ms.ToArray();

        using var sha = SHA256.Create();
        string tmp = outPath + ".part";
        try
        {
            using (var fsrc = File.OpenRead(astboxPath))
            using (var fdst = File.Create(tmp))
            {
                void Feed(byte[] b)
                {
                    sha.TransformBlock(b, 0, b.Length, null, 0);
                    fdst.Write(b, 0, b.Length);
                }
                Feed(Magic);
                var lenBuf = new byte[4];
                BinaryPrimitives.WriteUInt32BigEndian(lenBuf,
                    (uint)headerBytes.Length);
                Feed(lenBuf);
                Feed(headerBytes);
                BinaryPrimitives.WriteUInt32BigEndian(lenBuf,
                    (uint)blk.Length);
                Feed(lenBuf);
                Feed(blk);

                var buffer = new byte[1024 * 1024];
                int read;
                while ((read = fsrc.Read(buffer, 0, buffer.Length)) > 0)
                {
                    sha.TransformBlock(buffer, 0, read, null, 0);
                    fdst.Write(buffer, 0, read);
                }
                sha.TransformFinalBlock(Array.Empty<byte>(), 0, 0);
                fdst.Write(sha.Hash!);
            }
            File.Move(tmp, outPath, overwrite: true);
        }
        finally
        {
            try { if (File.Exists(tmp)) File.Delete(tmp); }
            catch { /* best effort */ }
        }
        return outPath;
    }

    /// <summary>Read header info without decrypting the secret block.</summary>
    public static PassboxInfo ReadInfo(string path)
    {
        using var f = File.OpenRead(path);
        Span<byte> magic = stackalloc byte[16];
        if (f.Read(magic) != 16 || !magic.SequenceEqual(Magic))
            throw Err("不是有效的 .passbox 文件");
        Span<byte> lenBuf = stackalloc byte[4];
        _ = f.Read(lenBuf);
        uint hlen = BinaryPrimitives.ReadUInt32BigEndian(lenBuf);
        var hdrBytes = new byte[hlen];
        int got = 0;
        while (got < hlen)
        {
            int r = f.Read(hdrBytes, got, (int)hlen - got);
            if (r <= 0) break;
            got += r;
        }
        var doc = JsonDocument.Parse(hdrBytes);
        bool needsPass =
            doc.RootElement.TryGetProperty("wrap", out var w) &&
            w.ValueEquals("pass");
        return new PassboxInfo(doc.RootElement.Clone(), needsPass);
    }

    /// <summary>Verify overall SHA-256 → unwrap the secret → drop the embedded
    /// container next to the package with an .astbox extension.</summary>
    public static PassboxUnwrapResult UnwrapSecret(string path,
        string? passphrase = null)
    {
        string baseName = Path.GetFileName(path);
        string stem = baseName.ToLowerInvariant().EndsWith(".passbox")
            ? baseName[..^".passbox".Length]
            : baseName;
        string dir = Path.GetDirectoryName(Path.GetFullPath(path)) ?? ".";
        string containerPath = Path.Combine(dir, stem + ".astbox");

        var data = File.ReadAllBytes(path);
        if (data.Length < 16 + 4 + 2 + 4 + 32)
            throw Err(".passbox 文件过短或损坏");
        var body = data[..^32];
        var trailer = data[^32..];
        var digest = SHA256.HashData(body);
        if (!Crypto.ConstantTimeEquals(digest, trailer))
            throw Err(".passbox 完整性校验失败(文件被截断或篡改)");

        int off = 0;
        if (!body.AsSpan(off, 16).SequenceEqual(Magic))
            throw Err("不是有效的 .passbox 文件");
        off += 16;
        uint hlen = BinaryPrimitives.ReadUInt32BigEndian(body.AsSpan(off)); off += 4;
        var headerDoc = JsonDocument.Parse(body.AsSpan(off, (int)hlen).ToArray());
        var header = headerDoc.RootElement.Clone();
        off += (int)hlen;
        uint blen = BinaryPrimitives.ReadUInt32BigEndian(body.AsSpan(off)); off += 4;
        var blk = body.AsSpan(off, (int)blen).ToArray();
        off += (int)blen;
        var containerBytes = body[off..];

        string GetStr(string name)
            => header.TryGetProperty(name, out var v) &&
               v.ValueKind == JsonValueKind.String
                ? v.GetString() ?? ""
                : "";

        if (header.TryGetProperty("csha", out var cshaEl) &&
            cshaEl.ValueKind == JsonValueKind.String)
        {
            string csha = Convert.ToHexStringLower(
                SHA256.HashData(containerBytes));
            if (csha != cshaEl.GetString())
                throw Err("内嵌容器校验和不匹配");
        }

        string plain;
        bool isPass = false;
        if (header.TryGetProperty("wrap", out var wrapEl))
            isPass = wrapEl.ValueEquals("pass");

        if (isPass)
        {
            if (string.IsNullOrEmpty(passphrase))
                throw Err("该传播包受口令保护，需要输入口令");
            ulong memKiB = 65536, t = 3, p = 1;
            if (header.TryGetProperty("kdf", out var kdf))
            {
                if (kdf.TryGetProperty("mem_kib", out var m) &&
                    m.ValueKind == JsonValueKind.Number)
                    memKiB = m.GetUInt64();
                if (kdf.TryGetProperty("t", out var tt) &&
                    tt.ValueKind == JsonValueKind.Number)
                    t = tt.GetUInt64();
                if (kdf.TryGetProperty("p", out var pp) &&
                    pp.ValueKind == JsonValueKind.Number)
                    p = pp.GetUInt64();
            }
            var salt = Convert.FromHexString(GetStr("salt"));
            var snonce = Convert.FromHexString(GetStr("snonce"));
            var wk = DeriveWrapKey(passphrase!, salt, (uint)memKiB,
                (uint)t, (uint)p);
            try
            {
                plain = Encoding.ASCII.GetString(
                    Crypto.AeadDecrypt(wk, snonce, blk, Magic));
            }
            catch (AstboxError)
            {
                throw Err("口令错误或传播包已损坏");
            }
        }
        else
        {
            try { plain = Encoding.ASCII.GetString(blk); }
            catch
            {
                throw Err("传播包内的密钥块无效");
            }
        }

        string norm = plain.Trim().ToUpperInvariant().Replace(" ", "");
        try
        {
            var raw = Crypto.Base32Decode(norm);
            if (raw.Length < 10) throw new AstboxError(E.InvalidArgument, "short");
        }
        catch (AstboxError)
        {
            throw Err("传播包内的密钥块无效");
        }

        File.WriteAllBytes(containerPath, containerBytes);
        return new PassboxUnwrapResult(norm, header, containerPath);
    }
}
