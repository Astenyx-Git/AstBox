// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: Apache-2.0
//! ASTBOX v1.0 command-line decoder (NativeAOT port of astbox_cli.py).
//!
//! Subcommands:
//!     selftest                      run cryptographic self-tests
//!     info   FILE                   structural info (no credentials)
//!     unlock FILE [--totp C] [--list]
//!                                   unlock and verify the container
//!     extract FILE --out DIR [--totp C] [--path P] [--verify]
//!                                   decrypt files to a local directory
//!     create FILE [--totp-code C | --totp-secret B32] [--qr PNG]
//!                   [--totp-digits N] [--seed-dir DIR] [--demo]
//!                   [--profile high|constrained]
//!                                   create a TOTP-only container
//!     add    FILE --from-dir DIR [--totp C] [--out NEW]
//!                                   add files to a container

using System.Globalization;
using System.Text;
using Astbox;

namespace Astbox.Cli;

internal static class Program
{
    // ------------------------------------------------------------- helpers

    /// <summary>Lowercase hex (python bytes.hex()).</summary>
    private static string Hex(byte[] data) => Convert.ToHexString(data).ToLowerInvariant();

    private static string Abspath(string path) => Path.GetFullPath(path);

    private static string Basename(string path) => Path.GetFileName(path);

    /// <summary>Port of astbox_cli._human().</summary>
    private static string Human(long bytes)
    {
        string[] units = { "B", "KiB", "MiB", "GiB", "TiB" };
        double n = bytes;
        foreach (var unit in units)
        {
            if (n < 1024 || unit == "TiB")
                return unit == "B" ? $"{bytes} B" : $"{n:F1} {unit}";
            n /= 1024.0;
        }
        return bytes.ToString(CultureInfo.InvariantCulture);
    }

    /// <summary>Port of astbox_cli._fmt_time(): local "%Y-%m-%d %H:%M:%S";
    /// fall back to the raw number on overflow/invalid values.</summary>
    private static string FmtTime(ulong t)
    {
        try
        {
            return DateTimeOffset.FromUnixTimeSeconds((long)t)
                .ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
        }
        catch (Exception)
        {
            return t.ToString(CultureInfo.InvariantCulture);
        }
    }

    /// <summary>Port of astbox_cli._slot_desc().</summary>
    private static string SlotDesc(KeySlot slot) =>
        $"slot[{slot.Index}] TOTP-{slot.TotpDigits} {slot.KdfLabel} " +
        $"(m={slot.Argon2MemoryKiB} KiB, t={slot.Argon2Time}, p={slot.Argon2Parallelism})";

    private sealed class Args
    {
        public string Cmd = "";
        public string File = "";
        public string? Totp;
        public bool List;
        public bool Verify;
        public string Out = "";
        public string Path = "";
        public string? TotpCode;
        public string? TotpSecret;
        public string? Qr;
        public int? TotpDigits;
        public string? SeedDir;
        public bool Demo;
        public string Profile = "high";
        public string FromDir = "";
    }

    // ------------------------------------------------------- usage / help
    //
    // Mirrors the argparse output of the python reference (prog=astbox-cli).

    private const string Prog = "astbox-cli";
    private const string Choices =
        "'selftest', 'info', 'unlock', 'extract', 'create', 'add'";

    private const string MainUsage =
        "usage: astbox-cli [-h] {selftest,info,unlock,extract,create,add} ...\n" +
        "\n" +
        "ASTBOX v1.0 container decoder (CLI)\n" +
        "\n" +
        "positional arguments:\n" +
        "  {selftest,info,unlock,extract,create,add}\n" +
        "    selftest            run cryptographic self-tests\n" +
        "    info                show structural info\n" +
        "    unlock              unlock and verify a container\n" +
        "    extract             extract files to a directory\n" +
        "    create              create a test container\n" +
        "    add                 add files from a directory to a container (generation\n" +
        "                        transaction)\n" +
        "\n" +
        "options:\n" +
        "  -h, --help            show this help message and exit\n";

    private const string SelftestHelp =
        "usage: astbox-cli selftest [-h]\n" +
        "\n" +
        "options:\n" +
        "  -h, --help  show this help message and exit\n";

    private const string InfoHelp =
        "usage: astbox-cli info [-h] file\n" +
        "\n" +
        "positional arguments:\n" +
        "  file\n" +
        "\n" +
        "options:\n" +
        "  -h, --help  show this help message and exit\n";

    private const string UnlockHelp =
        "usage: astbox-cli unlock [-h] [--totp TOTP] [--list] [--verify] file\n" +
        "\n" +
        "positional arguments:\n" +
        "  file\n" +
        "\n" +
        "options:\n" +
        "  -h, --help   show this help message and exit\n" +
        "  --totp TOTP  TOTP code (sole credential type)\n" +
        "  --list       list contents\n" +
        "  --verify     authenticate all Data Records\n";

    private const string ExtractHelp =
        "usage: astbox-cli extract [-h] --out OUT [--totp TOTP] [--path PATH]\n" +
        "                          [--verify]\n" +
        "                          file\n" +
        "\n" +
        "positional arguments:\n" +
        "  file\n" +
        "\n" +
        "options:\n" +
        "  -h, --help   show this help message and exit\n" +
        "  --out OUT\n" +
        "  --totp TOTP  TOTP code (sole credential type)\n" +
        "  --path PATH  extract only this logical path ('' = all)\n" +
        "  --verify\n";

    private const string CreateHelp =
        "usage: astbox-cli create [-h] [--totp-code TOTP_CODE]\n" +
        "                         [--totp-secret TOTP_SECRET] [--qr PNG]\n" +
        "                         [--totp-digits {6,8}] [--seed-dir SEED_DIR] [--demo]\n" +
        "                         [--profile {high,constrained}]\n" +
        "                         file\n" +
        "\n" +
        "positional arguments:\n" +
        "  file\n" +
        "\n" +
        "options:\n" +
        "  -h, --help            show this help message and exit\n" +
        "  --totp-code TOTP_CODE\n" +
        "  --totp-secret TOTP_SECRET\n" +
        "                        Base32 TOTP secret: compute the current code and print\n" +
        "                        provisioning info\n" +
        "  --qr PNG              save a scannable QR code PNG of the otpauth URI\n" +
        "                        (generates a TOTP secret if none is given)\n" +
        "  --totp-digits {6,8}\n" +
        "  --seed-dir SEED_DIR   import files from a directory\n" +
        "  --demo                embed a built-in demo file set\n" +
        "  --profile {high,constrained}\n";

    private const string AddHelp =
        "usage: astbox-cli add [-h] --from-dir FROM_DIR [--out OUT] [--totp TOTP] file\n" +
        "\n" +
        "positional arguments:\n" +
        "  file\n" +
        "\n" +
        "options:\n" +
        "  -h, --help           show this help message and exit\n" +
        "  --from-dir FROM_DIR  directory whose files are added\n" +
        "  --out OUT            output path (default: modify in place)\n" +
        "  --totp TOTP          TOTP code (sole credential type)\n";

    [System.Runtime.CompilerServices.ModuleInitializer]
    internal static void Init()
    {
        // Console robustness: never crash on characters the local codepage
        // cannot encode; prefer UTF-8 where the terminal supports it.
        try { Console.OutputEncoding = Encoding.UTF8; } catch { /* best effort */ }
        try
        {
            // python "%" formatting is locale-independent; keep numeric
            // formatting deterministic regardless of machine settings.
            CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;
            CultureInfo.DefaultThreadCurrentUICulture = CultureInfo.InvariantCulture;
        }
        catch { /* best effort */ }
        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            Console.Error.WriteLine("interrupted");
            Environment.Exit(130);
        };
    }

    [System.Diagnostics.CodeAnalysis.DoesNotReturn]
    private static void UsageError(string message)
    {
        Console.Error.Write(MainUsage);
        Console.Error.WriteLine($"{Prog}: error: {message}");
        Environment.Exit(2);
    }

    [System.Diagnostics.CodeAnalysis.DoesNotReturn]
    private static void SubUsageError(string cmd, string message)
    {
        Console.Error.Write(Specs[cmd].Usage);
        Console.Error.WriteLine($"{Prog} {cmd}: error: {message}");
        Environment.Exit(2);
    }

    // -------------------------------------------------------- arg parsing
    //
    // Small hand-rolled parser replicating argparse behavior for the fixed
    // grammar above: positional "file", value options (--opt V or --opt=V,
    // last occurrence wins), store_true flags, required options, choices,
    // -h/--help.

    private enum OptKind { Value, Choice6_8, ChoiceProfile }

    private sealed class Spec
    {
        public string Usage = "";
        public Dictionary<string, OptKind> ValueOpts = new();
        public HashSet<string> Flags = new();
        public string[] RequiredOpts = Array.Empty<string>();
        /// <summary>Whether the subcommand takes the FILE positional
        /// (all except selftest).</summary>
        public bool TakesFile = true;
    }

    private static readonly Dictionary<string, Spec> Specs = new()
    {
        ["selftest"] = new Spec { Usage = SelftestHelp, TakesFile = false },
        ["info"] = new Spec { Usage = InfoHelp },
        ["unlock"] = new Spec
        {
            Usage = UnlockHelp,
            ValueOpts = new() { ["--totp"] = OptKind.Value },
            Flags = new() { "--list", "--verify" },
        },
        ["extract"] = new Spec
        {
            Usage = ExtractHelp,
            ValueOpts = new()
            {
                ["--out"] = OptKind.Value,
                ["--totp"] = OptKind.Value,
                ["--path"] = OptKind.Value,
            },
            Flags = new() { "--verify" },
            RequiredOpts = new[] { "--out" },
        },
        ["create"] = new Spec
        {
            Usage = CreateHelp,
            ValueOpts = new()
            {
                ["--totp-code"] = OptKind.Value,
                ["--totp-secret"] = OptKind.Value,
                ["--qr"] = OptKind.Value,
                ["--totp-digits"] = OptKind.Choice6_8,
                ["--seed-dir"] = OptKind.Value,
                ["--profile"] = OptKind.ChoiceProfile,
            },
            Flags = new() { "--demo" },
        },
        ["add"] = new Spec
        {
            Usage = AddHelp,
            ValueOpts = new()
            {
                ["--from-dir"] = OptKind.Value,
                ["--out"] = OptKind.Value,
                ["--totp"] = OptKind.Value,
            },
            RequiredOpts = new[] { "--from-dir" },
        },
    };

    private static Args ParseArgs(string[] argv)
    {
        if (argv.Length == 0)
            UsageError("the following arguments are required: cmd");

        var args = new Args();

        if (argv[0] is "-h" or "--help")
        {
            Console.Out.Write(MainUsage);
            Environment.Exit(0);
        }
        args.Cmd = argv[0];
        if (!Specs.TryGetValue(args.Cmd, out var spec))
        {
            UsageError($"argument cmd: invalid choice: '{argv[0]}' (choose from {Choices})");
        }

        var values = new Dictionary<string, string>();
        var flags = new HashSet<string>();
        bool gotFile = false;

        for (int i = 1; i < argv.Length; i++)
        {
            string a = argv[i];
            if (a is "-h" or "--help")
            {
                Console.Out.Write(spec.Usage);
                Environment.Exit(0);
            }
            if (a.StartsWith('-') && a != "-")
            {
                string name = a, inlineValue = "";
                bool hasInline = false;
                int eq = a.IndexOf('=');
                if (eq >= 0 && a.StartsWith("--"))
                {
                    name = a[..eq];
                    inlineValue = a[(eq + 1)..];
                    hasInline = true;
                }
                if (spec.Flags.Contains(name))
                {
                    flags.Add(name);          // argparse store_true: idempotent
                    continue;
                }
                if (spec.ValueOpts.TryGetValue(name, out var kind))
                {
                    string val;
                    if (hasInline)
                    {
                        val = inlineValue!;
                    }
                    else
                    {
                        if (i + 1 >= argv.Length)
                            SubUsageError(args.Cmd, $"argument {name}: expected one argument");
                        val = argv[++i];
                    }
                    if (kind == OptKind.Choice6_8 && val is not ("6" or "8"))
                        SubUsageError(args.Cmd,
                            $"argument {name}: invalid choice: '{val}' (choose from '6', '8')");
                    if (kind == OptKind.ChoiceProfile &&
                        val is not ("high" or "constrained"))
                        SubUsageError(args.Cmd,
                            $"argument {name}: invalid choice: '{val}' " +
                            "(choose from 'high', 'constrained')");
                    values[name] = val;
                    continue;
                }
                SubUsageError(args.Cmd, $"unrecognized arguments: {a}");
            }
            if (gotFile)
            {
                // argparse reports surplus positionals as unrecognized args
                string rest = string.Join(" ", argv[i..]);
                SubUsageError(args.Cmd, $"unrecognized arguments: {rest}");
            }
            gotFile = true;
            args.File = a;
        }

        foreach (var req in spec.RequiredOpts)
        {
            if (!values.ContainsKey(req))
                SubUsageError(args.Cmd,
                    $"the following arguments are required: {req}");
        }
        if (!gotFile && spec.TakesFile)
            SubUsageError(args.Cmd, "the following arguments are required: file");

        if (values.TryGetValue("--totp", out var totp)) args.Totp = totp;
        if (values.TryGetValue("--out", out var outV)) args.Out = outV;
        if (values.TryGetValue("--path", out var pathV)) args.Path = pathV;
        if (values.TryGetValue("--totp-code", out var codeV)) args.TotpCode = codeV;
        if (values.TryGetValue("--totp-secret", out var secV)) args.TotpSecret = secV;
        if (values.TryGetValue("--qr", out var qrV)) args.Qr = qrV;
        if (values.TryGetValue("--totp-digits", out var digV))
            args.TotpDigits = int.Parse(digV, CultureInfo.InvariantCulture);
        if (values.TryGetValue("--seed-dir", out var seedV)) args.SeedDir = seedV;
        if (values.TryGetValue("--profile", out var profV)) args.Profile = profV;
        if (values.TryGetValue("--from-dir", out var fromV)) args.FromDir = fromV;
        args.List = flags.Contains("--list");
        args.Verify = flags.Contains("--verify");
        args.Demo = flags.Contains("--demo");
        return args;
    }

    // ------------------------------------------------------ shared pieces

    /// <summary>Port of astbox_cli._gather_totp(): prompt on stdout when
    /// --totp is absent; empty input is E_NO_VALID_CREDENTIAL.</summary>
    private static string GatherTotp(string? totp)
    {
        if (totp is null)
        {
            Console.Out.Write("TOTP code: ");
            try
            {
                string? line = Console.ReadLine();
                totp = line?.Trim();
            }
            catch (Exception exc) when (exc is IOException or ArgumentOutOfRangeException)
            {
                totp = null;
            }
        }
        if (string.IsNullOrWhiteSpace(totp))
            throw new AstboxError(E.NoValidCredential,
                "a TOTP code is required (use --totp or run interactively)");
        return totp;
    }

    // ---------------------------------------------------------- commands

    private static void CmdSelftest()
    {
        foreach (var line in Crypto.Selftest())
            Console.Out.WriteLine("  OK  " + line);
        Console.Out.WriteLine("cryptographic self-tests passed");
    }

    private static void CmdInfo(Args args)
    {
        var pc = Container.ParseContainer(args.File);
        var h = pc.Header;
        Console.Out.WriteLine("file        : " + Abspath(args.File));
        Console.Out.WriteLine($"size        : {Human(pc.Raw.Length)} ({pc.Raw.Length} bytes)");
        Console.Out.WriteLine("magic       : " + Encoding.ASCII.GetString(
            h.Magic.Select(b => b < 0x80 ? b : (byte)'?').ToArray()));
        Console.Out.WriteLine($"version     : {h.Version}");
        Console.Out.WriteLine("vault id    : " + Hex(h.VaultId));
        Console.Out.WriteLine($"generation  : {h.Generation}");
        Console.Out.WriteLine(
            $"key slots   : {h.KeySlotCount} (region {h.KeySlotOffset}.." +
            $"{h.KeySlotOffset + h.KeySlotLength})");
        foreach (var slot in pc.Slots)
        {
            Console.Out.WriteLine("    " + SlotDesc(slot));
            Console.Out.WriteLine("        slot id : " + Hex(slot.SlotId));
        }
        Console.Out.WriteLine(
            $"metadata    : offset {h.MetadataOffset} length {h.MetadataLength}");
        Console.Out.WriteLine($"data        : offset {h.DataOffset} length {h.DataLength}");
        Console.Out.WriteLine($"footer      : offset {h.FooterOffset} length {h.FooterLength}");
        Console.Out.WriteLine("footer mac  : " + Hex(pc.Footer.FooterMac));
        Console.Out.WriteLine("metadata dg : " + Hex(pc.Footer.MetadataDigest));
        Console.Out.WriteLine("data dg     : " + Hex(pc.Footer.DataDigest));
    }

    private static void CmdUnlock(Args args)
    {
        var pc = Container.ParseContainer(args.File);
        string totp = GatherTotp(args.Totp);
        var uc = Container.UnlockParsed(pc, totp: totp);
        Console.Out.WriteLine("unlocked OK");
        Console.Out.WriteLine("vault id   : " + Hex(uc.Parsed.Header.VaultId));
        Console.Out.WriteLine($"generation : {uc.Parsed.Header.Generation}");
        Console.Out.WriteLine("created    : " + FmtTime(uc.Created));
        Console.Out.WriteLine("modified   : " + FmtTime(uc.Modified));
        int nFiles = uc.Entries.Values.Count(e => e.IsFile);
        int nDirs = uc.Entries.Values.Count(e => e.IsDir);
        long total = uc.Entries.Values.Where(e => e.IsFile)
            .Aggregate(0L, (acc, e) => acc + (long)e.Size);
        Console.Out.WriteLine(
            $"entries    : {nFiles} files ({Human(total)}), {nDirs} directories");
        if (args.Verify)
        {
            Container.VerifyFull(uc);
            Console.Out.WriteLine("verify     : all Data Records authenticated OK");
        }
        if (args.List)
        {
            Console.Out.WriteLine("\ncontents:");
            foreach (var (path, entry) in Container.WalkEntries(uc)
                         .OrderBy(t => t.Path, StringComparer.Ordinal))
            {
                string shown = entry.IsDir ? path + "/" : path;
                string padded = shown.PadRight(40);
                Console.Out.WriteLine("    " + (entry.IsDir
                    ? $"{padded} <dir>"
                    : $"{padded} {Human((long)entry.Size)}"));
            }
        }
    }

    private static void CmdExtract(Args args)
    {
        var pc = Container.ParseContainer(args.File);
        string totp = GatherTotp(args.Totp);
        var uc = Container.UnlockParsed(pc, totp: totp);
        if (args.Verify)
        {
            Container.VerifyFull(uc);
            Console.Out.WriteLine("verify: all Data Records authenticated OK");
        }
        Directory.CreateDirectory(args.Out);
        // NOTE: the python reference builds a throttled progress callback in
        // cmd_extract but never passes it to extract.extract_path; parity
        // means we do not print per-file progress either.
        var results = Extractor.ExtractPath(uc, args.Path ?? "", args.Out);
        Console.Out.WriteLine(
            $"extracted {results.Count} file(s) to {Abspath(args.Out)}");
    }

    private static List<KeyValuePair<string, byte[]>> DemoFiles()
    {
        byte[] text = Encoding.UTF8.GetBytes(
            "ASTBOX v1.0 demo file.\n\n" +
            "This container was created by astbox-cli create --demo.\n");
        byte[] guide = Encoding.UTF8.GetBytes(
            "# ASTBOX decoder guide\n\nUnlock -> browse -> extract.\n");

        var big = new byte[2 * 1048576 + 12345];
        for (int i = 0; i < big.Length; i++)
            big[i] = (byte)((i * 131 + 7) % 256);

        return new List<KeyValuePair<string, byte[]>>
        {
            KeyValuePair.Create("readme.txt", Repeat(text, 20)),
            KeyValuePair.Create("docs/guide.md", Repeat(guide, 40)),
            KeyValuePair.Create("assets/random.bin", big),
            KeyValuePair.Create("empty.txt", Array.Empty<byte>()),
            KeyValuePair.Create("docs/notes/\u6d4b\u8bd5.txt",
                Encoding.UTF8.GetBytes("unicode file name test\n")),
        };
    }

    private static byte[] Repeat(byte[] pattern, int times)
    {
        var result = new byte[pattern.Length * times];
        for (int i = 0; i < times; i++)
            Buffer.BlockCopy(pattern, 0, result, i * pattern.Length, pattern.Length);
        return result;
    }

    private static void CmdCreate(Args args)
    {
        ushort profile = Constants.KdfProfileHigh;
        if (args.Profile == "constrained")
            profile = Constants.KdfProfileMemoryConstrained;
        List<KeyValuePair<string, byte[]>>? files = args.Demo ? DemoFiles() : null;
        string? totpCode = args.TotpCode;
        string? qrSecret = null;
        int digits = args.TotpDigits ?? 6;
        (string Secret, int Digits, string Dst)? provision = null;

        if (args.TotpSecret is not null)
        {
            // normalize exactly like the python reference: strip/upper/
            // remove spaces, Base32-decode case-insensitively, re-encode
            qrSecret = Crypto.Base32Encode(Crypto.Base32Decode(
                args.TotpSecret.Trim().ToUpperInvariant().Replace(" ", "")));
            totpCode = Crypto.TotpAt(qrSecret, digits);
            provision = (qrSecret, digits, args.File);
        }
        else if (args.Qr is not null || totpCode is null)
        {
            // TOTP 为唯一凭据：没有给密钥/验证码就自动生成一个
            qrSecret = QrUtil.GenerateSecret();
            totpCode = Crypto.TotpAt(qrSecret, digits);
            provision = (qrSecret, digits, args.File);
        }

        UnlockedContainer uc;
        if (qrSecret is not null)
        {
            uc = Creator.CreateContainer(args.File, totpDigits: digits,
                files: files, seedDir: args.SeedDir, kdfProfile: profile,
                totpSecret: qrSecret);
        }
        else
        {
            uc = Creator.CreateContainer(args.File,
                totpCode: totpCode!, totpDigits: digits, files: files,
                seedDir: args.SeedDir, kdfProfile: profile);
        }

        long size = new FileInfo(args.File).Length;
        Console.Out.WriteLine(
            $"created {Abspath(args.File)} ({Human(size)}), {uc.Entries.Count} entries, " +
            $"generation {uc.Parsed.Header.Generation}");

        if (provision is { } prov)
        {
            Console.Out.WriteLine("TOTP provisioning (add to your authenticator):");
            Console.Out.WriteLine("  Base32: " + prov.Secret);
            Console.Out.WriteLine(
                "  otpauth://totp/ASTBOX:" + Basename(prov.Dst) +
                $"?secret={prov.Secret}&issuer=ASTBOX&algorithm=SHA1&digits={prov.Digits}&period=30");
        }
        if (args.Qr is not null && qrSecret is not null)
        {
            string uri = QrUtil.BuildOtpauthUri(qrSecret, digits,
                "ASTBOX:" + Basename(args.File));
            QrUtil.SaveQrPng(uri, args.Qr);
            Console.Out.WriteLine("QR code saved to " + Abspath(args.Qr));
        }
        Console.Out.WriteLine("self-verification: OK");
    }

    private static void CmdAdd(Args args)
    {
        var pc = Container.ParseContainer(args.File);
        string totp = GatherTotp(args.Totp);
        var uc = Container.UnlockParsed(pc, totp: totp);
        var files = new List<KeyValuePair<string, byte[]>>();
        foreach (var full in Directory.EnumerateFiles(
                     args.FromDir, "*", SearchOption.AllDirectories))
        {
            string rel = Path.GetRelativePath(args.FromDir, full).Replace('\\', '/');
            files.Add(KeyValuePair.Create(rel, File.ReadAllBytes(full)));
        }
        if (files.Count == 0)
            throw new AstboxError(E.InvalidArgument,
                $"no files found in {args.FromDir}");
        string outPath = args.Out.Length > 0 ? args.Out : args.File;
        var uc2 = Modifier.AddFiles(uc, files, outPath, totp)!;
        Console.Out.WriteLine(
            $"added {files.Count} file(s); new generation " +
            $"{uc.Parsed.Header.Generation} -> {uc2.Parsed.Header.Generation}");
        Console.Out.WriteLine("written to " + Abspath(outPath));
    }

    // --------------------------------------------------------------- main

    internal static int Run(string[] argv)
    {
        Args args = ParseArgs(argv);
        try
        {
            switch (args.Cmd)
            {
                case "selftest": CmdSelftest(); break;
                case "info": CmdInfo(args); break;
                case "unlock": CmdUnlock(args); break;
                case "extract": CmdExtract(args); break;
                case "create": CmdCreate(args); break;
                case "add": CmdAdd(args); break;
            }
            return 0;
        }
        catch (AstboxError exc)
        {
            Console.Error.WriteLine($"error: {exc.CodeName}: {exc.Message}");
            return 1;
        }
        catch (Exception exc)
        {
            // Unexpected internal failure: report like an error instead of
            // crashing (application-control policies penalize crashes).
            Console.Error.WriteLine($"error: {exc.GetType().Name}: {exc.Message}");
            return 1;
        }
    }
}

internal static class EntryPoint
{
    // Build r2: fresh binary hash for application-control reputation.
    private static int Main(string[] args) => Program.Run(args);
}
