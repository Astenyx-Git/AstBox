// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: Apache-2.0
// Shared helpers for the Astbox.Core test suite.

using System.Text.Json;

namespace Astbox.Core.Tests;

public static class TestPaths
{
    /// <summary>Walk up from the test binary until the repository root
    /// (the directory containing "astbox-decoder") is found.</summary>
    public static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null &&
               !Directory.Exists(Path.Combine(dir.FullName, "astbox-decoder")))
            dir = dir.Parent!;
        if (dir is null)
            throw new InvalidOperationException("repo root not found");
        return dir.FullName;
    }

    public static string Fixtures => Path.Combine(RepoRoot(), "tests", "fixtures");
    public static string DemoContainer => Path.Combine(Fixtures, "demo.astbox");
    public static string Manifest => Path.Combine(Fixtures, "manifest.json");
    public static string SrcDir => Path.Combine(Fixtures, "src");

    private static JsonElement? s_manifest;

    public static JsonElement ManifestJson()
    {
        if (s_manifest is null)
            s_manifest = JsonDocument.Parse(File.ReadAllText(Manifest)).RootElement;
        return s_manifest.Value;
    }

    public const string FixtureSecret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
}
