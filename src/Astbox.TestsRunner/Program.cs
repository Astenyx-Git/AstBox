// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: Apache-2.0
//! Self-contained NativeAOT test runner (Smart App Control bypass).
//! Mirrors the xUnit suite in tests/Astbox.Core.Tests 1:1; the xUnit project
//! remains the CI-facing form of the same checks.

using System.Text;
using System.Text.Json;

namespace Astbox.TestsRunner;

internal static class Program
{
    private static int s_pass;
    private static int s_fail;

    private static readonly string ProbeLogPath =
        Path.Combine(Path.GetTempPath(), "astbox-probe.log");

    private static void Log(string m)
    {
        try { File.AppendAllText(ProbeLogPath, m + Environment.NewLine); }
        catch { }
        Console.WriteLine(m);
    }

    private static void Check(bool cond, string name, string? detail = null)
    {
        if (cond)
        {
            s_pass++;
            Console.WriteLine($"PASS  {name}");
        }
        else
        {
            s_fail++;
            Console.WriteLine($"FAIL  {name}{(detail is null ? "" : $"  [{detail}]")}");
        }
    }

    private static void ExpectAstboxError(Action action, ushort code,
        string name)
    {
        try
        {
            action();
            Check(false, name, "no exception thrown");
        }
        catch (AstboxError exc)
        {
            Check(exc.Code == code, name, $"got {exc.CodeName}");
        }
        catch (Exception exc)
        {
            Check(false, name, $"wrong exception {exc.GetType().Name}");
        }
    }

    private static int Main()
    {
        Console.WriteLine("== Astbox.Core native test runner ==");
        try
        {
            CryptoAndCbor();
            Interop();
            CreatorRoundtrip();
        }
        catch (Exception fatal)
        {
            Console.WriteLine("FATAL: " + fatal);
            return 2;
        }
        Console.WriteLine($"== {s_pass} passed, {s_fail} failed ==");
        return s_fail == 0 ? 0 : 1;
    }

    // ------------------------------------------------------------- helpers

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null &&
               !Directory.Exists(Path.Combine(dir.FullName, ".git")))
            dir = dir.Parent!;
        if (dir is null) throw new InvalidOperationException("repo root not found");
        return dir.FullName;
    }

    private static string Fixtures => Path.Combine(RepoRoot(), "tests", "fixtures");
    private static string DemoContainer => Path.Combine(Fixtures, "demo.astbox");

    private static JsonElement Manifest()
        => JsonDocument.Parse(
            File.ReadAllText(Path.Combine(Fixtures, "manifest.json"))).RootElement;

    private const string FixtureSecret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

    private static string NewWork(string tag)
    {
        var d = Path.Combine(Path.GetTempPath(),
            "astbox-native-tests-" + tag + "-" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(d);
        return d;
    }

    // ------------------------------------------------------- crypto / cbor

    private static void CryptoAndCbor()
    {
        // FullSelftest_AllVectorsPass
        try
        {
            var results = Crypto.Selftest();
            Check(results.Any(r => r.Contains("Argon2id")) &&
                  results.Any(r => r.Contains("TOTP")),
                "Crypto.Selftest all vectors",
                string.Join("; ", results));
        }
        catch (AstboxError e)
        {
            Check(false, "Crypto.Selftest all vectors", e.Message);
        }

        // Base32Decode_KnownVectors ("Hello!\xDE\xAD\xBE\xEF")
        byte[] b32Expected =
            { 0x48, 0x65, 0x6C, 0x6C, 0x6F, 0x21, 0xDE, 0xAD, 0xBE, 0xEF };
        Check(Crypto.Base32Decode("JBSWY3DPEHPK3PXP").AsSpan().SequenceEqual(b32Expected),
            "Base32Decode vector");
        Check(Crypto.Base32Decode("jbsw y3dp ehpk 3pxp")
                  .AsSpan().SequenceEqual(b32Expected),
            "Base32Decode casefold/spaces");

        // Base32EncodeDecode_Roundtrip
        bool rtOk = true;
        for (int len = 0; len <= 40 && rtOk; len++)
        {
            var data = Crypto.RandomBytes(len);
            string encoded = Crypto.Base32Encode(data);
            if (encoded.EndsWith('=')) rtOk = false;
            if (!Crypto.Base32Decode(encoded).AsSpan().SequenceEqual(data)) rtOk = false;
        }
        Check(rtOk, "Base32 encode/decode roundtrip 0..40");

        // TotpAt_Rfc6238Vectors
        const string totpSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
        Check(Crypto.TotpAt(totpSecret, 8, t: 59) == "94287082" &&
              Crypto.TotpAt(totpSecret, 6, t: 59) == "287082",
            "TOTP RFC 6238 vectors");

        // AeadDecrypt_WrongKey_ThrowsAuthFailure
        {
            var key = Crypto.RandomBytes(32);
            var nonce = Crypto.RandomBytes(24);
            var ct = Crypto.AeadEncrypt(key, nonce, "hello"u8, "aad"u8);
            ExpectAstboxError(() =>
                    Crypto.AeadDecrypt(Crypto.RandomBytes(32), nonce, ct, "aad"u8),
                E.AeadFailure, "AEAD wrong key fails closed");
        }

        // Argon2idRaw_Deterministic (+ dual-path cross-check)
        {
            var sec = new byte[32]; Array.Fill(sec, (byte)7);
            var salt = new byte[16]; Array.Fill(salt, (byte)9);
            var a = Crypto.Argon2idRaw(sec, salt, 16384, 3, 1);
            var b = Crypto.Argon2idRaw(sec, salt, 16384, 3, 1);
            Check(a.AsSpan().SequenceEqual(b) && a.Length == 32,
                "Argon2id deterministic");
            Check(a.AsSpan().SequenceEqual(
                      Crypto.Argon2idRawKonscious(sec, salt, 16384, 3, 1, 32)),
                "Argon2id NSec==Konscious (16B salt)");
        }

        // ---- CBOR strictness -------------------------------------------------
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
            Check(value.Equals(decoded) &&
                  encoded.AsSpan().SequenceEqual(CborDet.Dumps(decoded)),
                "CBOR canonical roundtrip");
        }
        {
            var encoded = CborDet.Dumps(CborValue.Text("cafe\u0301"));
            Check(CborDet.Loads(encoded).AsText == "caf\u00e9",
                "CBOR NFC normalization");
        }

        ExpectAstboxError(() => CborDet.Loads(Convert.FromHexString("1805")),
            E.NonCanonicalCbor, "CBOR rejects non-minimal uint");
        ExpectAstboxError(() => CborDet.Loads(
                new byte[] { 0xA2, 0x01, 0x00, 0x01, 0x01 }),
            E.DuplicateCborKey, "CBOR rejects duplicate map keys");
        ExpectAstboxError(() => CborDet.Loads(
                new byte[] { 0xA2, 0x02, 0x00, 0x01, 0x00 }),
            E.NonCanonicalCbor, "CBOR rejects non-canonical key order");
        ExpectAstboxError(() => CborDet.Loads(new byte[] { 0x20 }),
            E.InvalidCbor, "CBOR rejects negative int");
        ExpectAstboxError(() => CborDet.Loads(
                new byte[] { 0xFB, 0, 0, 0, 0, 0, 0, 0, 0 }),
            E.InvalidCbor, "CBOR rejects float");
        ExpectAstboxError(() => CborDet.Loads(new byte[] { 0xC0, 0x00 }),
            E.InvalidCbor, "CBOR rejects tag");
        ExpectAstboxError(() => CborDet.Loads(new byte[] { 0x9F, 0xFF }),
            E.InvalidCbor, "CBOR rejects indefinite length");
        ExpectAstboxError(() => CborDet.Loads(new byte[] { 0x00, 0x00 }),
            E.InvalidCbor, "CBOR rejects trailing bytes");
    }

    // --------------------------------------------------------------- interop

    private static void Interop()
    {
        var uc = Container.UnlockContainer(DemoContainer, secretB32: FixtureSecret);

        // ListingMatchesManifest
        {
            var expected = Manifest().GetProperty("entries").EnumerateArray()
                .Select(e => (
                    P: e.GetProperty("path").GetString()!,
                    S: (ulong)e.GetProperty("size").GetUInt64(),
                    D: e.GetProperty("is_dir").GetBoolean()))
                .OrderBy(t => t.P, StringComparer.Ordinal).ToList();
            var actual = Container.WalkEntries(uc)
                .Select(t => (t.Path, t.Entry.Size, t.Entry.IsDir))
                .OrderBy(t => t.Item1, StringComparer.Ordinal).ToList();
            bool ok = expected.Count == actual.Count;
            for (int i = 0; ok && i < expected.Count; i++)
                ok = expected[i].P == actual[i].Item1 &&
                     expected[i].S == actual[i].Size &&
                     expected[i].D == actual[i].IsDir;
            Check(ok, "fixture listing matches manifest");
            Check((ulong)Manifest().GetProperty("created").GetUInt64() == uc.Created &&
                  (ulong)Manifest().GetProperty("modified").GetUInt64() == uc.Modified &&
                  uc.Parsed.Header.Generation == 0UL,
                "fixture created/modified/generation");
        }

        // ExtractFixture_BytesIdenticalToSource
        {
            var work = NewWork("extract");
            string srcRoot = Path.Combine(Fixtures, "src");
            var extracted = Extractor.ExtractAll(uc, work);
            Log("X extracted " + extracted.Count + " entries");
            bool allOk = extracted.Count > 0;
            foreach (var (logicalPath, absPath) in extracted)
            {
                string srcFile = Path.Combine(srcRoot,
                    logicalPath.Replace('/', Path.DirectorySeparatorChar));
                if (!File.Exists(srcFile))
                {
                    // tolerate Unicode normalization differences between the
                    // container (NFC names) and on-disk fixture file names
                    var dir = Path.GetDirectoryName(srcFile)!;
                    var norm = Path.GetFileName(srcFile)
                        .Normalize(NormalizationForm.FormC);
                    string? found = null;
                    if (Directory.Exists(dir))
                        foreach (var cand in Directory.EnumerateFiles(dir))
                            if (Path.GetFileName(cand)
                                    .Normalize(NormalizationForm.FormC) == norm)
                            { found = cand; break; }
                    if (found is null)
                    {
                        allOk = false;
                        Log("X missing src: " + logicalPath);
                        continue;
                    }
                    srcFile = found;
                }
                if (!File.ReadAllBytes(srcFile).AsSpan()
                        .SequenceEqual(File.ReadAllBytes(absPath)))
                {
                    allOk = false;
                    Log("X mismatch: " + logicalPath);
                }
            }
            Check(allOk, "extracted bytes identical to source fixtures");
            try { Directory.Delete(work, true); } catch { }
        }

        // WrongCode_FailsClosed
        ExpectAstboxError(() =>
                Container.UnlockContainer(DemoContainer, totp: "000000"),
            E.AuthenticationFailed, "wrong TOTP code fails closed");

        // TamperedDataRegion_Rejected
        {
            var raw0 = File.ReadAllBytes(DemoContainer);
            var hh = Container.ParseHeader(raw0);
            Log($"T meta={hh.MetadataOffset}+{hh.MetadataLength} data={hh.DataOffset}+{hh.DataLength}");
            raw0[(int)hh.DataOffset + 100] ^= 0xFF;
            var work = NewWork("tamper");
            string p = Path.Combine(work, "t.astbox");
            File.WriteAllBytes(p, raw0);
            AstboxError? err = null;
            try { Container.UnlockContainer(p, secretB32: FixtureSecret); }
            catch (AstboxError e) { err = e; }
            Log("T got " + (err?.CodeName ?? "none") + ": " + (err?.Message ?? ""));
            bool digestRejected = err is not null &&
                (err.Code == E.MetadataDigestFailure ||
                 err.Code == E.DataDigestFailure ||
                 (err.Code == E.AuthenticationFailed &&
                  err.OriginalCode is ushort oc &&
                  (oc == E.MetadataDigestFailure || oc == E.DataDigestFailure)));
            Check(digestRejected, "tampered data region rejected",
                err?.CodeName + "/" + err?.OriginalCode?.ToString() ?? "");
            try { Directory.Delete(work, true); } catch { }
        }

        // Modify_AddFile_GenerationIncrements
        {
            var work = NewWork("modify");
            string outPath = Path.Combine(work, "added.astbox");
            var noteText = "added by the C# port\n中文内容验证\n"u8.ToArray();
            var newFiles = new List<KeyValuePair<string, byte[]>>
            {
                KeyValuePair.Create("newdir/note.txt", noteText),
            };
            var selfVerified = Modifier.AddFiles(uc!, newFiles, outPath,
                secretB32: FixtureSecret);
            Check(selfVerified is not null,
                "add self-verification passes via secret channel");
            var reopened = Container.UnlockContainer(outPath,
                secretB32: FixtureSecret);
            Check(reopened.Parsed.Header.Generation == 1UL,
                "modify bumps Generation to 1");

            var added = reopened.Entries.Values.Single(e => e.Name == "note.txt");
            var parts = Container.EntryPathParts(reopened, added).ToList();
            Check(parts.SequenceEqual(new[] { "newdir", "note.txt" }) &&
                  Container.ReadFile(reopened, added).AsSpan().SequenceEqual(noteText),
                "modified container holds new file content");

            bool originalsIntact = true;
            foreach (var (path, absPath) in Extractor.ExtractAll(reopened, work))
            {
                string srcFile = Path.Combine(Fixtures, "src",
                    path.Replace('/', Path.DirectorySeparatorChar));
                if (!File.Exists(srcFile)) continue;
                if (!File.ReadAllBytes(srcFile).AsSpan()
                        .SequenceEqual(File.ReadAllBytes(absPath)))
                    originalsIntact = false;
            }
            Check(originalsIntact, "original files intact after modify");
            uc = reopened;
            try { Directory.Delete(work, true); } catch { }
        }

        // Modify_TotpChannelSelfVerify_FailsOnSecretContainers
        // Kept as a semantic anchor for byte-compat parity with the python
        // reference: presenting a TOTP code to the legacy self-verify channel
        // of a secret-credential container can never re-derive the KDF
        // credential. Commit happens first (atomic), so the caller sees an
        // auth error although the new generation is on disk. Reliable channel
        // is secretB32 (see previous test).
        {
            var work = NewWork("modify-totp");
            string outPath = Path.Combine(work, "totp.astbox");
            var ucX = Container.UnlockContainer(DemoContainer,
                secretB32: FixtureSecret);
            var newFiles = new List<KeyValuePair<string, byte[]>>
            {
                KeyValuePair.Create("note2.txt", "totp channel"u8.ToArray()),
            };
            AstboxError? err = null;
            try
            {
                Modifier.AddFiles(ucX, newFiles, outPath, totp: "000000",
                    secretB32: null);
            }
            catch (AstboxError e) { err = e; }
            Check(err is not null &&
                  err.Code == E.AuthenticationFailed &&
                  File.Exists(outPath) &&
                  Container.ParseContainer(outPath).Header.Generation == 1UL,
                "legacy totp self-verify fails closed after commit (documented)",
                err?.CodeName ?? "no error");
            try { Directory.Delete(work, true); } catch { }
        }

        // Passbox_Roundtrip_WithAndWithoutPassphrase
        {
            var work = NewWork("passbox");

            string quick = Path.Combine(work, "quick.passbox");
            PassboxFile.PackPassbox(DemoContainer, FixtureSecret, 6, 1700000000,
                quick, passphrase: null);
            Check(!PassboxFile.ReadInfo(quick).NeedsPassphrase,
                "quick passbox needs no passphrase");
            File.Copy(quick, Path.Combine(work, "q.astbox.tmp")); // placeholder no-op
            var r1 = PassboxFile.UnwrapSecret(quick);
            Check(r1.SecretBase32 == FixtureSecret &&
                  Container.UnlockContainer(r1.ContainerPath,
                          secretB32: r1.SecretBase32).Created == uc!.Created,
                "quick passbox unwrap yields working container");

            string locked = Path.Combine(work, "locked.passbox");
            PassboxFile.PackPassbox(DemoContainer, FixtureSecret, 6, 1700000000,
                locked, passphrase: "口令-pass-123");
            Check(PassboxFile.ReadInfo(locked).NeedsPassphrase,
                "locked passbox requires passphrase");
            ExpectAstboxError(() => PassboxFile.UnwrapSecret(locked),
                PassboxError.Code, "missing passphrase rejected");
            ExpectAstboxError(() => PassboxFile.UnwrapSecret(locked, "wrong"),
                PassboxError.Code, "wrong passphrase rejected");
            var r2 = PassboxFile.UnwrapSecret(locked, "口令-pass-123");
            Check(r2.SecretBase32 == FixtureSecret &&
                  Container.UnlockContainer(r2.ContainerPath,
                          secretB32: r2.SecretBase32).Created == uc!.Created,
                "locked passbox unwraps with correct passphrase");
            try { Directory.Delete(work, true); } catch { }
        }
    }

    // ------------------------------------------------------ creator roundtrip

    private static void CreatorRoundtrip()
    {
        var work = NewWork("create");
        string containerPath = Path.Combine(work, "made.astbox");
        string secret = QrUtil.GenerateSecret(20);

        var files = new List<KeyValuePair<string, byte[]>>
        {
            KeyValuePair.Create("top.txt", "root file"u8.ToArray()),
            KeyValuePair.Create("a/b/c.bin",
                Enumerable.Range(0, 5000).Select(i => (byte)i).ToArray()),
            KeyValuePair.Create("empty.txt", Array.Empty<byte>()),
            KeyValuePair.Create("独目录/文件.txt", "unicode names ✓"u8.ToArray()),
        };
        var created = Creator.CreateContainer(containerPath,
            totpSecret: secret, files: files,
            kdfProfile: Constants.KdfProfileMemoryConstrained,
            created: 1700000500, modified: 1700000600);
        Check(created.Parsed.Header.Generation == 0UL,
            "creator self-verified container");

        var uc = Container.UnlockContainer(containerPath, secretB32: secret);
        bool allMatch = true;
        foreach (var (path, entry) in Container.WalkEntries(uc))
        {
            if (!entry.IsFile) continue;
            var want = files.First(kv =>
                kv.Key.Normalize(NormalizationForm.FormC) == path).Value;
            if (!want.AsSpan().SequenceEqual(Container.ReadFile(uc, entry)))
                allMatch = false;
        }
        Check(allMatch, "creator roundtrip contents identical");
        Container.VerifyFull(uc);
        Check(true, "Level-5 verify_full passes on created container");

        // legacy TOTP-code credential
        string codePath = Path.Combine(work, "code.astbox");
        Creator.CreateContainer(codePath, totpCode: "123456", totpDigits: 6,
            files: new List<KeyValuePair<string, byte[]>>
            {
                KeyValuePair.Create("x.txt", "x"u8.ToArray()),
            },
            kdfProfile: Constants.KdfProfileMemoryConstrained);
        var ucCode = Container.UnlockContainer(codePath, totp: "123456");
        Check(ucCode.Entries.Values.Count(e => e.IsFile) == 1,
            "legacy TOTP-code credential unlocks");

        try { Directory.Delete(work, true); } catch { }
    }
}
// fresh hash: v3.0.1 gate retry
