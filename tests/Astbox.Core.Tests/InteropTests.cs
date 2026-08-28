// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
//! Interop tests against the fixture produced by the REFERENCE Python
//! implementation (tests/fixtures/demo.astbox), plus writer/modify roundtrips.

using System.Text.Json;
using System.Text;
using Xunit;

namespace Astbox.Core.Tests;

public class InteropTests : IDisposable
{
    private readonly string _workDir;

    public InteropTests()
    {
        _workDir = Path.Combine(Path.GetTempPath(),
            "astbox-cs-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_workDir);
    }

    public void Dispose()
    {
        try { Directory.Delete(_workDir, recursive: true); }
        catch { /* best effort */ }
    }

    [Fact]
    public void UnlockFixture_ListingMatchesManifest()
    {
        var uc = Container.UnlockContainer(TestPaths.DemoContainer,
            secretB32: TestPaths.FixtureSecret);

        var manifest = TestPaths.ManifestJson();
        var expected = manifest.GetProperty("entries").EnumerateArray()
            .Select(e => (
                Path: e.GetProperty("path").GetString()!,
                Size: (ulong)e.GetProperty("size").GetUInt64(),
                IsDir: e.GetProperty("is_dir").GetBoolean()))
            .OrderBy(t => t.Path, StringComparer.Ordinal)
            .ToList();

        var actual = Container.WalkEntries(uc)
            .Select(t => (t.Path, t.Entry.Size, t.Entry.IsDir))
            .OrderBy(t => t.Item1, StringComparer.Ordinal)
            .ToList();

        Assert.Equal(expected.Count, actual.Count);
        for (int i = 0; i < expected.Count; i++)
        {
            Assert.Equal(expected[i].Path, actual[i].Item1);
            Assert.Equal(expected[i].Size, actual[i].Size);
            Assert.Equal(expected[i].IsDir, actual[i].IsDir);
        }
        Assert.Equal((ulong)manifest.GetProperty("created").GetUInt64(), uc.Created);
        Assert.Equal((ulong)manifest.GetProperty("modified").GetUInt64(), uc.Modified);
        Assert.Equal(0UL, uc.Parsed.Header.Generation);
    }

    [Fact]
    public void ExtractFixture_BytesIdenticalToSource()
    {
        var uc = Container.UnlockContainer(TestPaths.DemoContainer,
            secretB32: TestPaths.FixtureSecret);
        string outDir = Path.Combine(_workDir, "out");

        var extracted = Extractor.ExtractAll(uc, outDir);
        Assert.True(extracted.Count > 0);

        foreach (var (logicalPath, absPath) in extracted)
        {
            string srcFile = Path.Combine(TestPaths.SrcDir,
                logicalPath.Replace('/', Path.DirectorySeparatorChar));
            Assert.True(File.Exists(srcFile),
                $"missing source fixture for {logicalPath}");
            byte[] want = File.ReadAllBytes(srcFile);
            byte[] got = File.ReadAllBytes(absPath);
            Assert.True(want.AsSpan().SequenceEqual(got),
                $"content mismatch for {logicalPath}");
        }

        // in-memory read path must agree as well
        foreach (var (_, entry) in Container.WalkEntries(uc))
        {
            if (!entry.IsFile) continue;
            string srcFile = Path.Combine(TestPaths.SrcDir,
                Container.EntryPathParts(uc, entry)
                    .Aggregate((a, b) => Path.Combine(a, b)));
            var want = File.ReadAllBytes(srcFile);
            Assert.Equal(want, Container.ReadFile(uc, entry));
        }
    }

    [Fact]
    public void UnlockFixture_WithWrongCode_FailsClosed()
    {
        // The fixture credential is the Base32 secret; a wrong TOTP code
        // must fail with the unified authentication-failed code.
        var exc = Assert.Throws<AstboxError>(() =>
            Container.UnlockContainer(TestPaths.DemoContainer, totp: "000000"));
        Assert.Equal(E.AuthenticationFailed, exc.Code);
    }

    [Fact]
    public void TamperedDataRegion_Rejected()
    {
        var raw = File.ReadAllBytes(TestPaths.DemoContainer);
        var header = Container.ParseHeader(raw);
        int dataOffset = (int)header.DataOffset;
        raw[dataOffset + 100] ^= 0xFF;   // corrupt one ciphertext byte

        string tampered = Path.Combine(_workDir, "tampered.astbox");
        File.WriteAllBytes(tampered, raw);

        var exc = Assert.Throws<AstboxError>(() =>
            Container.UnlockContainer(tampered,
                secretB32: TestPaths.FixtureSecret));
        Assert.Contains(exc.Code,
            new ushort[] { E.MetadataDigestFailure, E.DataDigestFailure });
    }

    [Fact]
    public void Modify_AddFile_GenerationIncrements_AndPythonReadableLayout()
    {
        var uc = Container.UnlockContainer(TestPaths.DemoContainer,
            secretB32: TestPaths.FixtureSecret);
        string outPath = Path.Combine(_workDir, "added.astbox");

        var noteText = "added by the C# port\n中文内容验证\n"u8.ToArray();
        var newFiles = new List<KeyValuePair<string, byte[]>>
        {
            KeyValuePair.Create("newdir/note.txt", noteText),
        };

        var reopened = Modifier.AddFiles(uc, newFiles, outPath,
            totp: null)!;
        Assert.NotNull(reopened);
        // no totp → structural-only self-check; unlock explicitly instead:
        reopened = Container.UnlockContainer(outPath,
            secretB32: TestPaths.FixtureSecret);

        Assert.Equal(1UL, reopened.Parsed.Header.Generation);

        var addedEntry = reopened.Entries.Values.Single(e =>
            e.Name == "note.txt");
        var parts = Container.EntryPathParts(reopened, addedEntry).ToList();
        Assert.Equal(new[] { "newdir", "note.txt" }, parts);
        Assert.Equal(noteText, Container.ReadFile(reopened, addedEntry));

        // all original files still intact under the new generation
        string outDir = Path.Combine(_workDir, "out2");
        Extractor.ExtractAll(reopened, outDir);
        foreach (var (logicalPath, absPath) in
                 Extractor.ExtractAll(reopened, outDir))
        {
            string srcFile = Path.Combine(TestPaths.SrcDir,
                logicalPath.Replace('/', Path.DirectorySeparatorChar));
            if (!File.Exists(srcFile)) continue;   // the newly added file
            Assert.True(
                File.ReadAllBytes(srcFile).AsSpan()
                    .SequenceEqual(File.ReadAllBytes(absPath)),
                $"regression in {logicalPath} after modify");
        }
    }

    [Fact]
    public void Passbox_Roundtrip_WithAndWithoutPassphrase()
    {
        var uc = Container.UnlockContainer(TestPaths.DemoContainer,
            secretB32: TestPaths.FixtureSecret);

        // --- quick pack ---
        string quick = Path.Combine(_workDir, "quick.passbox");
        PassboxFile.PackPassbox(TestPaths.DemoContainer,
            TestPaths.FixtureSecret, digits: 6, created: 1700000000,
            outPath: quick, passphrase: null);
        var info = PassboxFile.ReadInfo(quick);
        Assert.False(info.NeedsPassphrase);
        string quickOut = Path.Combine(_workDir, "quick-out");
        Directory.CreateDirectory(quickOut);
        string targetQuick = Path.Combine(quickOut, "quick.astbox");
        // unwrap writes next to the package; copy package into its own dir
        string quickPb = Path.Combine(quickOut, "quick.passbox");
        File.Copy(quick, quickPb, overwrite: true);
        var r1 = PassboxFile.UnwrapSecret(quickPb);
        Assert.Equal(TestPaths.FixtureSecret.Replace(" ", ""), r1.SecretBase32);
        var unlockedQuick = Container.UnlockContainer(r1.ContainerPath,
            secretB32: r1.SecretBase32);
        Assert.Equal(uc.Created, unlockedQuick.Created);

        // --- passphrase pack ---
        string locked = Path.Combine(_workDir, "locked.passbox");
        PassboxFile.PackPassbox(TestPaths.DemoContainer,
            TestPaths.FixtureSecret, digits: 6, created: 1700000000,
            outPath: locked, passphrase: "口令-pass-123");
        var info2 = PassboxFile.ReadInfo(locked);
        Assert.True(info2.NeedsPassphrase);

        // wrong passphrase fails closed
        string lockedDir = Path.Combine(_workDir, "locked-out");
        Directory.CreateDirectory(lockedDir);
        string lockedPb = Path.Combine(lockedDir, "locked.passbox");
        File.Copy(locked, lockedPb, overwrite: true);
        Assert.Throws<AstboxError>(() =>
            PassboxFile.UnwrapSecret(lockedPb, passphrase: "wrong"));

        // correct passphrase unwraps and yields a working container
        var r2 = PassboxFile.UnwrapSecret(lockedPb, passphrase: "口令-pass-123");
        Assert.Equal(TestPaths.FixtureSecret, r2.SecretBase32);
        var unlockedLocked = Container.UnlockContainer(r2.ContainerPath,
            secretB32: r2.SecretBase32);
        Assert.Equal(unlockedQuick.Created, unlockedLocked.Created);
    }
}

public class CreatorRoundtripTests : IDisposable
{
    private readonly string _workDir;

    public CreatorRoundtripTests()
    {
        _workDir = Path.Combine(Path.GetTempPath(),
            "astbox-cs-create-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_workDir);
    }

    public void Dispose()
    {
        try { Directory.Delete(_workDir, recursive: true); }
        catch { /* best effort */ }
    }

    [Fact]
    public void Create_Unlock_Extract_Roundtrip()
    {
        string containerPath = Path.Combine(_workDir, "made.astbox");
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
            totpSecret: secret,
            files: files,
            kdfProfile: Constants.KdfProfileMemoryConstrained,
            created: 1700000500, modified: 1700000600);

        Assert.Equal(0UL, created.Parsed.Header.Generation);

        // re-unlock from scratch and compare every file
        var uc = Container.UnlockContainer(containerPath, secretB32: secret);
        foreach (var (path, entry) in Container.WalkEntries(uc))
        {
            if (!entry.IsFile) continue;
            var want = files.First(kv =>
                kv.Key.Normalize(NormalizationForm.FormC) == path).Value;
            Assert.Equal(want, Container.ReadFile(uc, entry));
        }

        // structural verification passes (Level 5)
        Container.VerifyFull(uc);
    }

    [Fact]
    public void Create_TotpCode_LegacyCredential_UnlocksWithCode()
    {
        string containerPath = Path.Combine(_workDir, "code.astbox");
        Creator.CreateContainer(containerPath,
            totpCode: "123456", totpDigits: 6,
            files: new List<KeyValuePair<string, byte[]>>
            {
                KeyValuePair.Create("x.txt", "x"u8.ToArray()),
            },
            kdfProfile: Constants.KdfProfileMemoryConstrained);

        var uc = Container.UnlockContainer(containerPath, totp: "123456");
        Assert.Single(uc.Entries.Values.Where(e => e.IsFile));
    }
}
