// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: Apache-2.0
//! ASTBOX v1.0 容器管理器 - Liquid Glass Web UI 本地服务。
//!
//! ASP.NET Core minimal API (NativeAOT) port of astbox_server.py:
//!   - ~20 个 /api/* JSON 端点, 路径/方法/字段/状态码语义与 python 版一致,
//!     契约裁判是 astbox-decoder/gui/app.js (零改动复用)。
//!   - DPAPI(CurrentUser) secrets.bin 密钥注册表, 文件格式照抄 python:
//!     magic "ASTBOX1\x00" + CryptProtectData blob + JSON(UTF-8)。
//!   - 便携 Chromium / Edge --app 启动器与 Windows 原生对话框
//!     (comdlg32/shell32/user32 经典 DllImport)。
//!   - 单用户内存 Session(ConcurrentDictionary 单例), 锁定容器句柄驻留内存。
//!   - MSI 分发通道: installer/wix + S2 无缝迁移(静默卸载旧 Inno 版)。

using System.Collections.Concurrent;
using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Astbox;
using Microsoft.AspNetCore.Server.Kestrel.Core;

// =========================================================== error surface

namespace Astbox.Server;

/// <summary>API 层面的用户可见错误: 符号码为字符串(区别于核心库整数码),
/// 应答为 {"ok":false,"error":"CODE: message"} HTTP 400。</summary>
public sealed class ApiError : Exception
{
    public string Code { get; }
    public ApiError(string code, string message)
        : base($"{code}: {message}")
    {
        Code = code;
        Message = message;
    }
    public new string Message { get; }
}

/// <summary>无符号码前缀的服务器级错误(对应 python 直接 _fail(str) 的分支,
/// 或 ValueError 分支), 应答 {"ok":false,"error":"message"}。</summary>
public sealed class PlainError : Exception
{
    public PlainError(string message) : base(message) { }
}

// ================================================================ secrets

/// <summary>已知密钥条目: VaultID(hex) -> {b32,digits,created}。</summary>
public sealed record SecretEntry(string B32, int Digits, long? Created);

/// <summary>DPAPI(CurrentUser) 加密的 TOTP 密钥注册表。
/// 文件格式照抄 astbox_server.py: "ASTBOX1\x00" + CryptProtectData(JSON UTF-8)。
/// 位于 %LOCALAPPDATA%\ASTBOX\secrets.bin; ASTBOX_SECRETS_PATH 可重定向。
/// 与 python 版双向兼容(CryptProtectData 的 szDataDescr 不参与解密)。</summary>
public static class SecretsStore
{
    private static readonly byte[] Magic = Encoding.ASCII.GetBytes("ASTBOX1\x00");

    private static string DefaultPath()
    {
        var local = Environment.GetFolderPath(
            Environment.SpecialFolder.LocalApplicationData);
        var dir = Path.Combine(string.IsNullOrEmpty(local)
            ? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
            : local, "ASTBOX");
        return Path.Combine(dir, "secrets.bin");
    }

    public static string StorePath =>
        Environment.GetEnvironmentVariable("ASTBOX_SECRETS_PATH")
            is { Length: > 0 } p ? p : DefaultPath();

    /// <summary>损坏/换机: 静默降级为空注册表(python load_secrets 语义)。</summary>
    public static Dictionary<string, SecretEntry> Load()
    {
        try
        {
            var blob = File.ReadAllBytes(StorePath);
            if (blob.Length < Magic.Length ||
                !blob.AsSpan(0, Magic.Length).SequenceEqual(Magic))
                return new Dictionary<string, SecretEntry>();
            var raw = ProtectedData.Unprotect(blob[Magic.Length..], null,
                DataProtectionScope.CurrentUser);
            var store = new Dictionary<string, SecretEntry>();
            using var doc = JsonDocument.Parse(raw);
            if (doc.RootElement.ValueKind != JsonValueKind.Object)
                return new Dictionary<string, SecretEntry>();
            foreach (var prop in doc.RootElement.EnumerateObject())
            {
                if (prop.Value.ValueKind != JsonValueKind.Object ||
                    !prop.Value.TryGetProperty("b32", out var b32El) ||
                    b32El.ValueKind != JsonValueKind.String)
                    continue;
                int digits = 6;
                if (prop.Value.TryGetProperty("digits", out var dgEl) &&
                    dgEl.ValueKind == JsonValueKind.Number &&
                    dgEl.TryGetInt32(out var d))
                    digits = d;
                long? created = null;
                if (prop.Value.TryGetProperty("created", out var crEl))
                {
                    if (crEl.ValueKind == JsonValueKind.Number &&
                        crEl.TryGetInt64(out var c))
                        created = c;
                    else if (crEl.ValueKind == JsonValueKind.Number)
                        created = 0;
                }
                store[prop.Name] = new SecretEntry(b32El.GetString() ?? "",
                    digits, created);
            }
            return store;
        }
        catch
        {
            return new Dictionary<string, SecretEntry>();
        }
    }

    public static void Save(IReadOnlyDictionary<string, SecretEntry> store)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(StorePath)!);
            using var ms = new MemoryStream();
            using (var w = new Utf8JsonWriter(ms))
            {
                w.WriteStartObject();
                foreach (var (key, entry) in store)
                {
                    w.WriteStartObject(key);
                    w.WriteString("b32", entry.B32);
                    w.WriteNumber("digits", entry.Digits);
                    if (entry.Created is { } cr)
                        w.WriteNumber("created", cr);
                    else
                        w.WriteNull("created");
                    w.WriteEndObject();
                }
                w.WriteEndObject();
            }
            // json.dumps(..., ensure_ascii=False).encode("utf-8") 等价: writer 原样输出 UTF-8 文本
            var raw = ms.ToArray();
            var blob = Magic.Concat(
                ProtectedData.Protect(raw, null,
                    DataProtectionScope.CurrentUser)).ToArray();
            var tmp = StorePath + ".tmp";
            File.WriteAllBytes(tmp, blob);
            File.Move(tmp, StorePath, overwrite: true);
        }
        catch (Exception exc)
        {
            Console.WriteLine($"  [warn] 密钥注册表落盘失败: {exc.GetType().Name}: {exc.Message}");
        }
    }
}

// ================================================================ session

/// <summary>单用户本地会话: 镜像原 tkinter 版 AstboxGui 的状态字段
/// (python astbox_server.Session 的逐行移植)。锁定容器的解析句柄同样驻留内存。</summary>
public sealed class Session
{
    private ParsedContainer? _pc;          // ParsedContainer(可处于锁定态)
    private UnlockedContainer? _uc;        // UnlockedContainer(解锁后)
    private string? _filePath;
    private string? _cred;                 // 最近一次成功解锁的 TOTP 验证码(展示/日志语义)
    private string? _credSecret;           // 解锁实际使用的 Base32 secret(自验通道)
    private byte[] _currentDir = Constants.RootDirectoryId;
    private readonly List<byte[]> _history = new();
    private readonly List<byte[]> _forward = new();
    private string _outDir = "";
    private Dictionary<string, SecretEntry> _secrets;

    public Session() => _secrets = SecretsStore.Load();

    /// <summary>已知密钥注册表只读视图(export_passbox 查询用)。</summary>
    public IReadOnlyDictionary<string, SecretEntry> Secrets => _secrets;

    /// <summary>/api/outdir。</summary>
    public void SetOutDir(string value) => _outDir = value;

    /// <summary>当前输出目录(python SESSION.out_dir)。</summary>
    public string OutDir => _outDir ?? "";

    // ------------------------------------------------------------ helpers

    private static string VidKey(byte[] vaultId)
        => Convert.ToHexString(vaultId).ToLowerInvariant();

    /// <summary>记录当前打开容器的已知密钥(合并保留已有 created 时间戳)。</summary>
    public void RememberSecret(string b32, int digits, long? created = null)
    {
        if (string.IsNullOrEmpty(b32) || _pc is null)
            return;
        RememberSecretFor(VidKey(_pc.Header.VaultId), b32, digits, created);
    }

    /// <summary>直接以 VaultID 注册密钥(封装完成后调用)。</summary>
    public void RegisterSecret(byte[] vaultId, string b32, int digits,
        long? created = null)
    {
        if (!string.IsNullOrEmpty(b32))
            RememberSecretFor(VidKey(vaultId), b32, digits, created);
    }

    private void RememberSecretFor(string key, string b32, int digits,
        long? created)
    {
        _secrets.TryGetValue(key, out var old);
        _secrets[key] = new SecretEntry(b32, digits,
            created ?? old?.Created);
        SecretsStore.Save(_secrets);
    }

    /// <summary>规范 §10/§67: 允许相邻时间步补偿时钟偏移。已知密钥且位数
    /// 匹配时, 生成"当前时刻"与"容器创建时刻"各 ±5 个时间步的候选码。</summary>
    private List<string> WindowCandidates(byte[] vaultId, int? digitsHint)
    {
        if (!_secrets.TryGetValue(VidKey(vaultId), out var entry))
            return new List<string>();
        if (digitsHint is { } hint && entry.Digits != hint)
            return new List<string>();
        long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var bases = new List<long> { now };
        if (entry.Created is { } cr)
            bases.Add(cr);
        var seen = new HashSet<string>();
        var codes = new List<string>();
        foreach (var b in bases)
        {
            for (int step = -5; step <= 5; step++)
            {
                long t = b + step * Constants.TotpPeriod;
                string code;
                try { code = Crypto.TotpAt(entry.B32, entry.Digits, t); }
                catch (AstboxError) { continue; }
                if (seen.Add(code))
                    codes.Add(code);
            }
        }
        return codes;
    }

    public string Phase()
    {
        if (_uc is not null) return "unlocked";
        if (_pc is not null) return "locked";
        return "empty";
    }

    public UnlockedContainer? Uc => _uc;

    public string CurrentPath()
    {
        if (_uc is null)
            return "/";
        if (_currentDir.AsSpan().SequenceEqual(Constants.RootDirectoryId))
            return "/";
        var parts = new List<string>();
        var cur = _uc.Entries[_currentDir];
        while (!cur.ParentId.AsSpan().SequenceEqual(Constants.RootDirectoryId))
        {
            parts.Add(cur.Name);
            cur = _uc.Entries[cur.ParentId];
        }
        parts.Add(cur.Name);
        parts.Reverse();
        return "/" + string.Join("/", parts);
    }

    private List<Entry> Listing()
    {
        var items = new List<Entry>();
        if (_uc is null)
            return items;
        if (_uc.Children.TryGetValue(_currentDir, out var kids))
            items = new List<Entry>(kids);
        // python: sort by (is_file, name.lower())
        items.Sort((a, b) =>
        {
            int c = a.IsFile.CompareTo(b.IsFile);
            if (c != 0) return c;
            return string.Compare(a.Name.ToLowerInvariant(),
                b.Name.ToLowerInvariant(), StringComparison.Ordinal);
        });
        return items;
    }

    private static string Human(double n)
    {
        foreach (var unit in new[] { "B", "KiB", "MiB", "GiB", "TiB" })
        {
            if (n < 1024 || unit == "TiB")
                return unit == "B"
                    ? ((long)n).ToString(CultureInfo.InvariantCulture) + " B"
                    : string.Format(CultureInfo.InvariantCulture,
                        "{0:F1} {1}", n, unit);
            n /= 1024.0;
        }
        return n.ToString(CultureInfo.InvariantCulture); // unreachable
    }

    private static string FmtTime(ulong t)
    {
        try
        {
            return DateTimeOffset.FromUnixTimeSeconds((long)t)
                .ToLocalTime()
                .ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);
        }
        catch
        {
            return t.ToString(CultureInfo.InvariantCulture);
        }
    }

    public void WriteInfo(Utf8JsonWriter w)
    {
        bool unlocked = _uc is not null;
        var parsed = unlocked ? _uc!.Parsed : _pc!;
        if (parsed is null)
        {
            w.WriteNullValue();
            return;
        }
        var h = parsed.Header;
        w.WriteStartObject();
        w.WriteString("name", Path.GetFileName(parsed.Path));
        w.WriteString("path", parsed.Path);
        w.WriteString("vault_id", Convert.ToHexString(h.VaultId).ToLowerInvariant());
        w.WriteNumber("generation", h.Generation);
        if (unlocked)
        {
            int files = 0;
            foreach (var e in _uc!.Entries.Values)
                if (e.IsFile) files++;
            w.WriteNumber("files", files);
        }
        else
        {
            w.WriteNull("files");
        }
        w.WritePropertyName("slots_digits");
        w.WriteStartArray();
        foreach (var s in parsed.Slots)
            if (s.IsTotp)
                w.WriteNumberValue(s.TotpDigits ?? 6);
        w.WriteEndArray();
        w.WriteString("status", unlocked ? "已解锁" : "未解锁");
        w.WriteEndObject();
    }

    public void WriteItem(Utf8JsonWriter w, Entry e)
    {
        w.WriteStartObject();
        w.WriteString("id", Convert.ToHexString(e.FileId).ToLowerInvariant());
        w.WriteString("name", e.Name);
        w.WriteBoolean("is_dir", e.IsDir);
        w.WriteNumber("size", e.IsDir ? 0UL : e.Size);
        w.WriteString("size_h", e.IsDir ? "" : Human(e.Size));
        w.WriteNumber("modified", e.Modified);
        w.WriteString("modified_h", FmtTime(e.Modified));
        w.WriteEndObject();
    }

    public void WriteSnapshot(Utf8JsonWriter w)
    {
        w.WriteStartObject();
        w.WriteString("phase", Phase());
        w.WritePropertyName("info");
        if (_pc is null && _uc is null)
            w.WriteNullValue();
        else
            WriteInfo(w);
        w.WriteString("path", _uc is not null ? CurrentPath() : "/");
        w.WriteBoolean("can_back", _history.Count > 0);
        w.WriteBoolean("can_forward", _forward.Count > 0);
        w.WriteBoolean("can_up",
            _uc is not null &&
            !_currentDir.AsSpan().SequenceEqual(Constants.RootDirectoryId));
        w.WritePropertyName("items");
        w.WriteStartArray();
        foreach (var e in Listing())
            WriteItem(w, e);
        w.WriteEndArray();
        w.WriteString("out_dir", _outDir ?? "");
        w.WriteString("home",
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile));
        w.WriteBoolean("qr_ok", QrUtil.Available());
        w.WriteEndObject();
    }

    // ------------------------------------------------------------ actions

    public void OpenPath(string path)
    {
        _pc = Container.ParseContainer(path);
        _uc = null;
        _cred = null;
        _credSecret = null;
        _filePath = path;
        _currentDir = Constants.RootDirectoryId;
        _history.Clear();
        _forward.Clear();
    }

    private static byte[] AsciiIgnoreBytes(string s)
    {
        var bytes = new List<byte>(s.Length);
        foreach (var ch in s)
            if (ch < 128)
                bytes.Add((byte)ch);
        return bytes.ToArray();
    }

    /// <summary>解锁当前容器(仅验证码路径)。验证码先在 now±5 / created±5 窗口内
    /// 常量时间校验, 通过后用注册表中的 Base32 密钥解码字节完成 KDF 解锁。</summary>
    public void Unlock(string totp)
    {
        if (_pc is null)
            throw new ApiError(EApi.NoContainer, "尚未打开容器");
        var parsed = _pc!;
        var vid = parsed.Header.VaultId;

        if (!_secrets.TryGetValue(VidKey(vid), out var entry) ||
            string.IsNullOrWhiteSpace(totp))
        {
            throw new ApiError(EApi.AuthCode,
                "本机没有该容器的密钥记录，无法校验验证码。" +
                "请在封装该容器的设备上解锁，或重新封装。");
        }

        int? digitsHint = null;
        foreach (var s in parsed.Slots)
            if (s.IsTotp) { digitsHint = s.TotpDigits ?? 6; break; }
        var expected = WindowCandidates(vid, digitsHint);
        var typed = AsciiIgnoreBytes(totp.Trim());
        bool verified = false;
        foreach (var code in expected)
            if (Crypto.ConstantTimeEquals(typed, Encoding.ASCII.GetBytes(code)))
            {
                verified = true;
                break;
            }
        if (!verified)
        {
            string hint = digitsHint is { } dh
                ? $"容器为 {dh} 位验证码"
                : "位数未知";
            throw new ApiError(EApi.AuthCode,
                $"验证码不匹配（{hint}）。请核对：① 验证器时间已与本机同步" +
                "(±150 秒内可自动补偿) ② 使用的是该容器对应的密钥");
        }
        UnlockedContainer uc;
        try
        {
            uc = Container.UnlockParsed(parsed, secretB32: entry.B32);
        }
        catch (AstboxError exc)
        {
            throw new ApiError(EApi.AuthCode,
                "验证码正确但容器解锁失败: " +
                $"ASTBOX_E_{exc.Code:X4}: {exc.Message}");
        }
        FinishUnlock(uc, totp, entry.B32);
    }

    private void FinishUnlock(UnlockedContainer uc, string cred,
        string credSecret)
    {
        _uc = uc;
        _cred = cred;
        _credSecret = credSecret;
        _pc = uc.Parsed;
        _filePath = uc.Parsed.Path;
        _currentDir = Constants.RootDirectoryId;
        _history.Clear();
        _forward.Clear();
    }

    public void Lock()
    {
        _uc = null;
        _cred = null;
        _credSecret = null;
        _currentDir = Constants.RootDirectoryId;
        _history.Clear();
        _forward.Clear();
    }

    /// <summary>target: {"dir": hex-or-'root'} 或 {"path": "/a/b"};
    /// target 为 null 时按空对象处理(python args={} 语义, 落到 path 分支)。</summary>
    public void NavTo(JsonElement? targetOpt)
    {
        if (_uc is null)
            return;
        var target = targetOpt ?? default;
        bool isObj = target.ValueKind == JsonValueKind.Object;
        byte[] newDir;
        JsonElement dirEl = default;
        bool hasDir = isObj &&
                      target.TryGetProperty("dir", out dirEl) &&
                      dirEl.ValueKind != JsonValueKind.Null &&
                      dirEl.ValueKind != JsonValueKind.Undefined;
        if (hasDir)
        {
            string raw = dirEl.ToString() ?? "";
            if (raw is "root" or "/" or "")
            {
                newDir = Constants.RootDirectoryId;
            }
            else
            {
                byte[] id;
                try { id = Convert.FromHexString(raw); }
                catch
                {
                    throw new PlainError(
                        "non-hexadecimal number found in fromhex() argument");
                }
                if (!_uc.Entries.TryGetValue(id, out var ent) || !ent.IsDir)
                    throw new ApiError(EApi.BadDir, "目录不存在");
                newDir = id;
            }
        }
        else
        {
            string path = "/";
            if (target.TryGetProperty("path", out var pathEl) &&
                pathEl.ValueKind == JsonValueKind.String)
                path = pathEl.GetString() ?? "/";
            path = path.Trim();
            if (path.Length == 0 || path is "/" or "\\")
            {
                newDir = Constants.RootDirectoryId;
            }
            else
            {
                var parts = path.Trim('/', '\\').Split('/',
                    StringSplitOptions.RemoveEmptyEntries);
                byte[] cur = Constants.RootDirectoryId;
                foreach (var p in parts)
                {
                    Entry? found = null;
                    if (_uc.Children.TryGetValue(cur, out var siblings))
                        foreach (var e in siblings)
                            if (e.IsDir && e.Name == p)
                            {
                                found = e;
                                break;
                            }
                    if (found is null)
                        throw new ApiError(EApi.BadDir, $"未找到目录: {path}");
                    cur = found.FileId;
                }
                newDir = cur;
            }
        }
        if (!newDir.AsSpan().SequenceEqual(_currentDir))
        {
            _history.Add(_currentDir);
            _forward.Clear();
        }
        _currentDir = newDir;
    }

    public void NavBack()
    {
        if (_history.Count > 0 && _uc is not null)
        {
            _forward.Add(_currentDir);
            _currentDir = _history[^1];
            _history.RemoveAt(_history.Count - 1);
        }
    }

    public void NavForward()
    {
        if (_forward.Count > 0 && _uc is not null)
        {
            _history.Add(_currentDir);
            _currentDir = _forward[^1];
            _forward.RemoveAt(_forward.Count - 1);
        }
    }

    public void NavUp()
    {
        if (_uc is not null &&
            !_currentDir.AsSpan().SequenceEqual(Constants.RootDirectoryId))
        {
            // python: self.nav_to({"dir": parent.hex()})
            var parent = _uc.Entries[_currentDir].ParentId;
            NavToRawDir(Convert.ToHexString(parent).ToLowerInvariant());
        }
    }

    /// <summary>nav_to({"dir": hex}) 的内部直连路径(与 NavTo 同一状态迁移)。</summary>
    private void NavToRawDir(string raw)
    {
        if (_uc is null)
            return;
        byte[] newDir;
        if (raw is "root" or "/" or "")
        {
            newDir = Constants.RootDirectoryId;
        }
        else
        {
            byte[] id;
            try { id = Convert.FromHexString(raw); }
            catch
            {
                throw new PlainError(
                    "non-hexadecimal number found in fromhex() argument");
            }
            if (!_uc.Entries.TryGetValue(id, out var ent) || !ent.IsDir)
                throw new ApiError(EApi.BadDir, "目录不存在");
            newDir = id;
        }
        if (!newDir.AsSpan().SequenceEqual(_currentDir))
        {
            _history.Add(_currentDir);
            _forward.Clear();
        }
        _currentDir = newDir;
    }

    public int Extract(List<string>? ids, string outDir)
    {
        if (_uc is null)
            throw new ApiError(EApi.NotUnlocked, "请先解锁容器");
        if (string.IsNullOrEmpty(outDir))
            throw new ApiError(EApi.BadOut, "请指定输出目录");
        Directory.CreateDirectory(outDir);
        var uc = _uc;
        if (ids is null)
        {
            var results = Extractor.ExtractAll(uc, outDir);
            return results.Count;
        }
        var targets = new List<Entry>();
        foreach (var hx in ids)
        {
            byte[] id;
            try { id = Convert.FromHexString(hx); }
            catch
            {
                throw new PlainError(
                    "non-hexadecimal number found in fromhex() argument");
            }
            if (uc.Entries.TryGetValue(id, out var ent) && ent.IsFile)
                targets.Add(ent);
        }
        if (targets.Count == 0)
            throw new ApiError(EApi.NoFiles, "所选项目中没有文件");
        foreach (var ent in targets)
            Extractor.ExtractEntry(uc, ent, outDir);
        return targets.Count;
    }

    public int AddPaths(IEnumerable<string> paths)
    {
        if (_uc is null)
            throw new ApiError(EApi.NotUnlocked, "请先解锁容器");
        string prefix = _currentDir.AsSpan()
                .SequenceEqual(Constants.RootDirectoryId)
            ? ""
            : CurrentPath().TrimStart('/');
        // python dict 语义: 插入序保留, 同名覆盖
        var files = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        foreach (var rawP in paths)
        {
            string p = rawP.Trim().Trim('"');
            if (p.Length == 0)
                continue;
            if (Directory.Exists(p))
            {
                string basePath = p;
                foreach (var full in Directory.EnumerateFiles(
                             basePath, "*", SearchOption.AllDirectories))
                {
                    string rel = Path.GetRelativePath(basePath, full)
                        .Replace('\\', '/');
                    string logical = prefix.Length == 0
                        ? rel
                        : prefix + "/" + rel;
                    files[logical] = File.ReadAllBytes(full);
                }
            }
            else if (File.Exists(p))
            {
                string logical = prefix.Length == 0
                    ? Path.GetFileName(p)
                    : prefix + "/" + Path.GetFileName(p);
                files[logical] = File.ReadAllBytes(p);
            }
        }
        if (files.Count == 0)
            throw new ApiError(EApi.NoFiles, "没有可添加的文件");
        var fileList = new List<KeyValuePair<string, byte[]>>(files);
        // 自验走 secret 通道(验证码 ASCII 不是 KDF 凭据, 无法通过新代际自验)。
        // 解锁必经 UnlockParsed(secretB32: entry.B32), _credSecret 恒非空。
        var uc2 = Modifier.AddFiles(_uc!, fileList, _filePath!,
            secretB32: _credSecret);
        if (uc2 is not null)
        {
            _uc = uc2;
            _pc = uc2.Parsed;
        }
        else
        {
            // secretB32 为 null 时核心库只提交不回读(防御分支, 现实不可达)
            _uc = null;
        }
        // 新一代容器中条目 ID 可能变化: 若当前目录失效则回到根目录
        if (!_currentDir.AsSpan().SequenceEqual(Constants.RootDirectoryId) &&
            !_uc!.Entries.ContainsKey(_currentDir))
        {
            _currentDir = Constants.RootDirectoryId;
            _history.Clear();
            _forward.Clear();
        }
        return fileList.Count;
    }
}

/// <summary>API 层符号码(python E_* 字符串常量)。</summary>
public static class EApi
{
    public const string NoContainer = "E_NO_CONTAINER";
    public const string NotUnlocked = "E_NOT_UNLOCKED";
    public const string BadDir = "E_BAD_DIR";
    public const string BadOut = "E_BAD_OUT";
    public const string NoFiles = "E_NO_FILES";
    public const string Browse = "E_BROWSE";
    public const string AuthCode = "E_AUTH_CODE";
}

/// <summary>单例会话注册表(ConcurrentDictionary 承载, 等价 python 全局 SESSION)。</summary>
public static class Sessions
{
    public static ConcurrentDictionary<string, Session> All { get; } = new();
    static Sessions() => All["default"] = new Session();
    public static Session Default => All["default"];
}

// ============================================================ demo / pack

public static partial class Handlers
{
    internal static byte[] DemoReadmeText =
        "ASTBOX v1.0 demo file.\n\nThis container was created by the demo button.\n"u8.ToArray();

    internal static byte[] DemoGuideLine =
        "# ASTBOX decoder guide\n\nUnlock -> browse -> extract.\n"u8.ToArray();

    internal static byte[] DemoUnicodeText =
        "unicode file name test\n"u8.ToArray();

    internal static List<KeyValuePair<string, byte[]>> DemoFiles()
    {
        var big = new byte[2 * 1048576 + 12345];
        for (int i = 0; i < big.Length; i++)
            big[i] = (byte)((uint)(i * 131 + 7) % 256);
        var readme = new byte[DemoReadmeText.Length * 20];
        for (int i = 0; i < 20; i++)
            DemoReadmeText.CopyTo(readme, i * DemoReadmeText.Length);
        var guide = new byte[DemoGuideLine.Length * 40];
        for (int i = 0; i < 40; i++)
            DemoGuideLine.CopyTo(guide, i * DemoGuideLine.Length);
        return new List<KeyValuePair<string, byte[]>>
        {
            KeyValuePair.Create("readme.txt", readme),
            KeyValuePair.Create("docs/guide.md", guide),
            KeyValuePair.Create("assets/random.bin", big),
            KeyValuePair.Create("empty.txt", Array.Empty<byte>()),
            KeyValuePair.Create("docs/notes/测试.txt",
                DemoUnicodeText.ToArray()),
        };
    }

    /// <summary>_qr_payload: otpauth URI + 二维码矩阵(不可用时为 null)。</summary>
    internal static void WriteQrPayload(Utf8JsonWriter w, string secret,
        int digits, string label)
    {
        string uri = QrUtil.BuildOtpauthUri(secret, digits, label);
        w.WriteString("b32", secret);
        w.WriteNumber("digits", digits);
        w.WriteString("uri", uri);
        w.WritePropertyName("matrix");
        if (QrUtil.Available())
        {
            w.WriteStartArray();
            foreach (var row in QrUtil.QrMatrix(uri))
            {
                w.WriteStartArray();
                foreach (var cell in row)
                    w.WriteNumberValue(cell ? 1 : 0);
                w.WriteEndArray();
            }
            w.WriteEndArray();
        }
        else
        {
            w.WriteNullValue();
        }
    }

    /// <summary>在用户指定位置生成内置示例内容的 .astbox 容器并打开(锁定态)。
    /// 返回 payload 写入器回调(demo 对象内容, 不含外层键名)。</summary>
    internal static void MakeDemo(Session session, Utf8JsonWriter w,
        string dstRaw, int digitsRaw, string profileStr)
    {
        string dst = (dstRaw ?? "").Trim().Trim('"');
        if (dst.Length == 0)
            throw new ApiError(EApi.BadOut, "请指定保存位置");
        string? parent = Path.GetDirectoryName(Path.GetFullPath(dst));
        if (!string.IsNullOrEmpty(parent))
            Directory.CreateDirectory(parent);
        int digits = digitsRaw == 6 ? 6 : 8;
        ushort profile = profileStr == "constrained"
            ? Constants.KdfProfileMemoryConstrained
            : Constants.KdfProfileHigh;
        string secret = QrUtil.GenerateSecret();
        var uc = Creator.CreateContainer(dst, totpSecret: secret,
            totpDigits: digits, files: DemoFiles(), kdfProfile: profile);
        session.RegisterSecret(uc.Parsed.Header.VaultId, secret, digits,
            (long)uc.Created);
        session.OpenPath(dst);
        session.RememberSecret(secret, digits, (long)uc.Created);
        WriteQrPayload(w, secret, digits,
            "ASTBOX:" + Path.GetFileName(dst));
        w.WriteString("dst", dst);
    }

    /// <summary>do_pack: 封装文件夹(或当前已解锁容器全部内容)为新容器。</summary>
    internal static void DoPack(Session session, Utf8JsonWriter packW,
        JsonElement args)
    {
        string src = (ArgStr(args, "src") ?? "").Trim().Trim('"');
        string dst = (ArgStr(args, "dst") ?? "").Trim().Trim('"');
        int digits = ArgInt(args, "digits", 6);
        string? b32 = ArgStr(args, "b32");
        b32 = string.IsNullOrWhiteSpace(b32) ? null : b32.Trim();
        string profileStr = ArgStr(args, "profile") ?? "high";
        ushort profile = profileStr == "high"
            ? Constants.KdfProfileHigh
            : Constants.KdfProfileMemoryConstrained;
        if (dst.Length == 0)
            throw new ApiError(EApi.BadOut, "请指定目标文件");
        if (src.Length > 0 && !Directory.Exists(src))
            throw new ApiError(EApi.BadDir, $"源文件夹不存在: {src}");
        string? parent = Path.GetDirectoryName(Path.GetFullPath(dst));
        if (!string.IsNullOrEmpty(parent))
            Directory.CreateDirectory(parent);

        var files = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        if (src.Length > 0)
        {
            foreach (var full in Directory.EnumerateFiles(
                         src, "*", SearchOption.AllDirectories))
            {
                string rel = Path.GetRelativePath(src, full)
                    .Replace('\\', '/');
                files[rel] = File.ReadAllBytes(full);
            }
        }
        else if (session.Uc is not null)
        {
            // 留空且当前已解锁容器: 封装容器内全部内容
            foreach (var (path, ent) in Container.WalkEntries(session.Uc))
                if (ent.IsFile)
                    files[path] = Container.ReadFile(session.Uc, ent);
        }
        else
        {
            throw new ApiError(EApi.BadDir,
                "请先打开并解锁要封装的容器，或指定源文件夹");
        }

        string b32Used = b32 ?? QrUtil.GenerateSecret();
        var fileList = new List<KeyValuePair<string, byte[]>>(files);
        var uc = Creator.CreateContainer(dst, totpSecret: b32Used,
            totpDigits: digits, files: fileList, kdfProfile: profile);
        // 注册密钥(含创建时刻), 使本会话内的"打开->解锁"可靠可用
        session.RegisterSecret(uc.Parsed.Header.VaultId, b32Used, digits,
            (long)uc.Created);
        WriteQrPayload(packW, b32Used, digits,
            "ASTBOX:" + Path.GetFileName(dst));
        packW.WriteString("dst", dst);
        packW.WriteString("vault_id",
            Convert.ToHexString(uc.Parsed.Header.VaultId).ToLowerInvariant());
        packW.WriteNumber("generation", uc.Parsed.Header.Generation);
        packW.WriteNumber("entries", uc.Entries.Count);
    }
}

// ========================================================= native dialogs

/// <summary>Windows 原生文件/文件夹对话框(Win32 comdlg32/shell32)、
/// 错误弹窗(user32 MessageBoxW)与口令输入对话框 —— 以 python _win_dialog /
/// _tk_error 为准的等价实现(NativeAOT 下使用经典 [DllImport])。</summary>
public static class NativeDialogs
{
    private const int BufChars = 65536;

    private const uint OfnReadOnly = 0x1;
    private const uint OfnOverwritePrompt = 0x2;
    private const uint OfnHideReadOnly = 0x4;
    private const uint OfnNoChangeDir = 0x8;
    private const uint OfnAllowMultiSelect = 0x200;
    private const uint OfnPathMustExist = 0x800;
    private const uint OfnFileMustExist = 0x1000;
    private const uint OfnExplorer = 0x80000;

    private const uint BifReturnOnlyFsDirs = 0x1;
    private const uint BifNewDialogStyle = 0x40;

    private const uint CoinitApartmentThreaded = 0x2;
    private const int RpcEChangedMode = unchecked((int)0x80010106);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct OPENFILENAMEW
    {
        public uint lStructSize;
        public IntPtr hwndOwner;
        public IntPtr hInstance;
        public IntPtr lpstrFilter;
        public IntPtr lpstrCustomFilter;
        public uint nMaxCustFilter;
        public uint nFilterIndex;
        public IntPtr lpstrFile;
        public uint nMaxFile;
        public IntPtr lpstrFileTitle;
        public uint nMaxFileTitle;
        public IntPtr lpstrInitialDir;
        public IntPtr lpstrTitle;
        public uint Flags;
        public ushort nFileOffset;
        public ushort nFileExtension;
        public IntPtr lpstrDefExt;
        public IntPtr lCustData;
        public IntPtr lpfnHook;
        public IntPtr lpTemplateName;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BROWSEINFOW
    {
        public IntPtr hwndOwner;
        public IntPtr pidlRoot;
        public IntPtr pszDisplayName;
        public IntPtr lpszTitle;
        public uint ulFlags;
        public IntPtr lpfn;
        public IntPtr lParam;
        public int iImage;
    }

    [DllImport("comdlg32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetOpenFileNameW(ref OPENFILENAMEW ofn);

    [DllImport("comdlg32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetSaveFileNameW(ref OPENFILENAMEW ofn);

    [DllImport("shell32.dll")]
    private static extern IntPtr SHBrowseForFolderW(ref BROWSEINFOW bi);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SHGetPathFromIDListW(IntPtr pidl,
        [Out] StringBuilder pszPath);

    [DllImport("ole32.dll")]
    private static extern int CoInitializeEx(IntPtr pvReserved, uint dwCoInit);

    [DllImport("ole32.dll")]
    private static extern void CoUninitialize();

    [DllImport("ole32.dll")]
    private static extern void CoTaskMemFree(IntPtr pv);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBoxW(IntPtr hWnd, string text,
        string caption, uint type);

    /// <summary>python _tk_error 的原生等价: 无头环境错误弹窗。</summary>
    public static void ShowError(string text)
        => MessageBoxW(IntPtr.Zero, text, "ASTBOX 传播包", 0x10 /*MB_ICONERROR*/);

    /// <summary>是/否询问框(MB_YESNO|MB_ICONQUESTION)。返回 true=用户选择"是"。</summary>
    public static bool AskYesNo(string title, string text)
        => MessageBoxW(IntPtr.Zero, text, title, 0x24) == 6 /*IDYES*/;

    private static IntPtr AllocUni(string s)
    {
        var bytes = new byte[(s.Length + 1) * 2];
        Encoding.Unicode.GetBytes(s, 0, s.Length, bytes, 0);
        var ptr = Marshal.AllocHGlobal(bytes.Length);
        Marshal.Copy(bytes, 0, ptr, bytes.Length);
        return ptr;
    }

    private static IntPtr AllocZero(int cb)
    {
        var ptr = Marshal.AllocHGlobal(cb);
        for (int off = 0; off < cb; off += sizeof(long))
            Marshal.WriteInt64(ptr, off, 0);
        for (int off = cb - cb % sizeof(long); off < cb; off++)
            Marshal.WriteByte(ptr, off, 0);
        return ptr;
    }

    /// <summary>弹出 Windows 原生文件/文件夹对话框。args.mode:
    /// 'file' | 'files' | 'dir' | 'save'。返回选中路径列表(可能为空)。
    /// 对话框失败时抛出 E_BROWSE(python _native_browse 语义)。</summary>
    public static List<string> WinDialog(string mode, string title,
        string? initialDir, List<(string Name, string Pattern)> filetypes,
        string defaultext, string initial)
    {
        IntPtr owner = GetForegroundWindow();   // 挂到应用窗口名下, 始终置顶
        IntPtr filterPtr = IntPtr.Zero, initPtr = IntPtr.Zero,
               titlePtr = IntPtr.Zero, defExtPtr = IntPtr.Zero,
               fileBuf = IntPtr.Zero, dispBuf = IntPtr.Zero;
        bool comInited = false;
        try
        {
            int hr = CoInitializeEx(IntPtr.Zero, CoinitApartmentThreaded);
            comInited = hr == 0 || hr == RpcEChangedMode;

            if (filetypes.Count > 0)
            {
                var ft = new StringBuilder();
                foreach (var (name, pattern) in filetypes)
                    ft.Append(name).Append('\0').Append(pattern).Append('\0');
                ft.Append('\0');
                filterPtr = AllocUni(ft.ToString());
            }
            if (!string.IsNullOrEmpty(initialDir))
                initPtr = AllocUni(initialDir);
            if (!string.IsNullOrEmpty(title))
                titlePtr = AllocUni(title);
            fileBuf = AllocZero(BufChars * 2);
            dispBuf = AllocZero(260 * 2);

            if (mode == "dir")
            {
                var bi = new BROWSEINFOW
                {
                    hwndOwner = owner,
                    lpszTitle = titlePtr,
                    pszDisplayName = dispBuf,
                    ulFlags = BifReturnOnlyFsDirs | BifNewDialogStyle,
                };
                IntPtr pidl = SHBrowseForFolderW(ref bi);
                if (pidl == IntPtr.Zero)
                    return new List<string>();
                var sb = new StringBuilder(260);
                bool ok = SHGetPathFromIDListW(pidl, sb);
                CoTaskMemFree(pidl);
                return ok && sb.Length > 0
                    ? new List<string> { sb.ToString() }
                    : new List<string>();
            }

            var ofn = new OPENFILENAMEW
            {
                hwndOwner = owner,
                lStructSize = (uint)Marshal.SizeOf<OPENFILENAMEW>(),
                lpstrFilter = filterPtr,
                lpstrInitialDir = initPtr,
                lpstrTitle = titlePtr,
                lpstrFile = fileBuf,
                nMaxFile = BufChars,
            };
            uint baseFlags = OfnHideReadOnly | OfnNoChangeDir;
            bool okDlg;
            if (mode == "save")
            {
                string de = (defaultext ?? "").TrimStart('.');
                if (de.Length > 0)
                    defExtPtr = AllocUni(de);
                string baseName = Path.GetFileName(initial);
                if (!string.IsNullOrEmpty(baseName))
                {
                    // 预填文件名
                    var nameBytes =
                        new byte[(baseName.Length + 1) * 2];
                    Encoding.Unicode.GetBytes(baseName, 0, baseName.Length,
                        nameBytes, 0);
                    Marshal.Copy(nameBytes, 0, fileBuf, nameBytes.Length);
                }
                ofn.lpstrDefExt = defExtPtr;
                ofn.Flags = baseFlags | OfnOverwritePrompt | OfnPathMustExist;
                okDlg = GetSaveFileNameW(ref ofn);
            }
            else if (mode == "files")
            {
                ofn.Flags = baseFlags | OfnAllowMultiSelect | OfnExplorer
                            | OfnFileMustExist | OfnPathMustExist;
                okDlg = GetOpenFileNameW(ref ofn);
            }
            else
            {
                ofn.Flags = baseFlags | OfnFileMustExist | OfnPathMustExist;
                okDlg = GetOpenFileNameW(ref ofn);
            }
            if (!okDlg)
                return new List<string>();
            string raw = Marshal.PtrToStringUni(fileBuf, BufChars);
            var parts = raw.Split('\0', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length > 1)
            {
                // 多选: 首项为目录前缀
                string folder = parts[0].TrimEnd('\\');
                return parts.Skip(1)
                    .Select(p => folder + "\\" + p).ToList();
            }
            return parts.ToList();
        }
        finally
        {
            if (filterPtr != IntPtr.Zero) Marshal.FreeHGlobal(filterPtr);
            if (initPtr != IntPtr.Zero) Marshal.FreeHGlobal(initPtr);
            if (titlePtr != IntPtr.Zero) Marshal.FreeHGlobal(titlePtr);
            if (defExtPtr != IntPtr.Zero) Marshal.FreeHGlobal(defExtPtr);
            if (fileBuf != IntPtr.Zero) Marshal.FreeHGlobal(fileBuf);
            if (dispBuf != IntPtr.Zero) Marshal.FreeHGlobal(dispBuf);
            if (comInited)
            {
                try { CoUninitialize(); } catch { /* best effort */ }
            }
        }
    }

    // ---------------- 口令输入对话框(内存 DLGTEMPLATE, 替代 tkinter simpledialog)

    private delegate IntPtr DialogProcDelegate(IntPtr hWnd, uint msg,
        IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern IntPtr GetModuleHandleW(string? lpModuleName);

    [DllImport("user32.dll")]
    private static extern IntPtr DialogBoxIndirectParamW(
        IntPtr hInstance, IntPtr lpTemplate, IntPtr hWndParent,
        DialogProcDelegate proc, IntPtr lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EndDialog(IntPtr hDlg, IntPtr result);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetDlgItemTextW(IntPtr hDlg, int id,
        [Out] StringBuilder text, int maxCount);

    private const uint WmClose = 0x0010;
    private const uint WmCommand = 0x0111;

    private sealed class PasswordBoxState
    {
        public readonly StringBuilder Text = new(512);
    }

    private static IntPtr PasswordProc(IntPtr hDlg, uint msg,
        IntPtr wParam, IntPtr lParam)
    {
        var state = GCHandle.FromIntPtr(lParam).Target as PasswordBoxState;
        if (msg == WmCommand)
        {
            int id = (int)(short)((long)wParam & 0xFFFF);
            if (id == 1)                       // IDOK: 先取文本再关闭
            {
                state?.Text.Clear();
                _ = GetDlgItemTextW(hDlg, 1001, state?.Text!,
                    state?.Text.Capacity ?? 512);
                EndDialog(hDlg, (IntPtr)1);
                return (IntPtr)1;
            }
            if (id == 2)                       // IDCANCEL
            {
                EndDialog(hDlg, IntPtr.Zero);
                return (IntPtr)1;
            }
        }
        else if (msg == WmClose)
        {
            EndDialog(hDlg, IntPtr.Zero);
            return (IntPtr)1;
        }
        return IntPtr.Zero;
    }

    private static void Put16(List<byte> b, ushort v)
    {
        b.Add((byte)v); b.Add((byte)(v >> 8));
    }

    private static void Put32(List<byte> b, uint v)
    {
        b.Add((byte)v); b.Add((byte)(v >> 8));
        b.Add((byte)(v >> 16)); b.Add((byte)(v >> 24));
    }

    private static void PutI16(List<byte> b, short v) => Put16(b, (ushort)v);

    private static void Align4(List<byte> b)
    {
        while (b.Count % 4 != 0)
            b.Add(0);
    }

    private static void PutUnicode(List<byte> b, string s)
    {
        b.AddRange(Encoding.Unicode.GetBytes(s));
        b.AddRange(new byte[2]);             // 终结 NUL
    }

    private static void PutItemHeader(List<byte> b, uint style,
        short x, short y, short cx, short cy, ushort id)
    {
        Put32(b, 0);                          // helpId
        Put32(b, style);
        Put32(b, 0);                          // exStyle
        PutI16(b, x); PutI16(b, y); PutI16(b, cx); PutI16(b, cy);
        Put16(b, id);
    }

    private static void PutAtomClass(List<byte> b, ushort atom)
    {
        Put16(b, 0xFFFF);
        Put16(b, atom);
    }

    /// <summary>模态口令输入框(ES_PASSWORD 编辑框 + 确定/取消)。
    /// 返回输入文本; 取消返回 null。替代 tkinter simpledialog.askstring。</summary>
    public static string? PromptPassword(string title, string label)
    {
        const uint WSChild = 0x40000000, WSVisible = 0x10000000,
                   WSTabStop = 0x00010000, WSGroup = 0x00020000,
                   WSBorder = 0x00800000;
        const uint EsPassword = 0x0020, EsAutoHScroll = 0x0080;
        const uint BsDefPushButton = 0x0001;
        const ushort AtomButton = 0x0080, AtomEdit = 0x0081,
            AtomStatic = 0x0082;

        var tpl = new List<byte>();
        Put32(tpl, 0x80C80880);               // POPUP|CAPTION|SYSMENU|MODALFRAME|CENTER
        Put32(tpl, 0);                        // exStyle
        Put16(tpl, 4);                        // cdit
        PutI16(tpl, 0); PutI16(tpl, 0);
        PutI16(tpl, 230); PutI16(tpl, 84);
        Put16(tpl, 0);                        // no menu
        Put16(tpl, 0);                        // default class
        PutUnicode(tpl, title);               // caption

        Align4(tpl);
        // 静态说明文字
        PutItemHeader(tpl, WSChild | WSVisible | WSGroup, 10, 8, 210, 10, 1000);
        PutAtomClass(tpl, AtomStatic);
        PutUnicode(tpl, label);
        Put16(tpl, 0);                        // 无 creation data

        Align4(tpl);
        // 口令编辑框
        PutItemHeader(tpl,
            WSChild | WSVisible | WSBorder | WSTabStop | EsAutoHScroll | EsPassword,
            10, 24, 210, 14, 1001);
        PutAtomClass(tpl, AtomEdit);
        Put16(tpl, 0xFFFF); Put16(tpl, 0xFFFF);   // 无标题
        Put16(tpl, 0);

        Align4(tpl);
        // 确定(IDOK=1)
        PutItemHeader(tpl,
            BsDefPushButton | WSChild | WSVisible | WSTabStop | WSGroup,
            115, 48, 50, 14, 1);
        PutAtomClass(tpl, AtomButton);
        PutUnicode(tpl, "确定");
        Put16(tpl, 0);

        Align4(tpl);
        // 取消(IDCANCEL=2)
        PutItemHeader(tpl, WSChild | WSVisible | WSTabStop, 172, 48, 50, 14, 2);
        PutAtomClass(tpl, AtomButton);
        PutUnicode(tpl, "取消");
        Put16(tpl, 0);

        var buf = tpl.ToArray();
        IntPtr mem = Marshal.AllocHGlobal(buf.Length);
        try
        {
            Marshal.Copy(buf, 0, mem, buf.Length);
            var state = new PasswordBoxState();
            var handle = GCHandle.Alloc(state, GCHandleType.Normal);
            try
            {
                DialogProcDelegate proc = PasswordProc;
                IntPtr rc = DialogBoxIndirectParamW(
                    GetModuleHandleW(null), mem, GetForegroundWindow(),
                    proc, GCHandle.ToIntPtr(handle));
                return rc == (IntPtr)1 ? state.Text.ToString() : null;
            }
            finally
            {
                handle.Free();
            }
        }
        finally
        {
            Marshal.FreeHGlobal(mem);
        }
    }
}

// ======================================================== chromium launcher

/// <summary>便携 Chromium / Edge --app 窗口启动器(python _find_app_host /
/// _find_portable_chromium / _open_ui 的等价移植)。</summary>
public static class UiLauncher
{
    public const string AppTitle = "ASTBOX";

    public static string ExeDir => AppContext.BaseDirectory;

    internal static string LogPath => Path.Combine(ExeDir, "server_error.log");

    /// <summary>寻找支持 --app 独立窗口模式的浏览器(优先 Edge, 其次 Chrome)。</summary>
    public static string? FindAppHost()
    {
        string localAppData = Environment.GetFolderPath(
            Environment.SpecialFolder.LocalApplicationData);
        var candidates = new[]
        {
            @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            @"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            Path.Combine(localAppData,
                @"Google\Chrome\Application\chrome.exe"),
            @"C:\Program Files\Google\Chrome\Application\chrome.exe",
            @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        };
        foreach (var p in candidates)
            if (!string.IsNullOrEmpty(p) && File.Exists(p))
                return p;
        return null;
    }

    /// <summary>应用窗口通道 URL: 携带 ui=app, 前端据此禁用 F12/右键。</summary>
    public static string KioskUrl(string url)
        => url + (url.Contains('?') ? "&" : "?") + "ui=app";

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern int GetWindowTextLengthW(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text,
        int maxCount);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    /// <summary>枚举顶层可见窗口, 判断应用窗口是否已经出现(健康检查用)。</summary>
    public static bool AppWindowVisible(string titleSubstr)
    {
        try
        {
            bool hit = false;
            EnumWindows((hWnd, lp) =>
            {
                int n = GetWindowTextLengthW(hWnd);
                if (n > 0)
                {
                    var sb = new StringBuilder(n + 1);
                    _ = GetWindowTextW(hWnd, sb, n + 1);
                    if (sb.ToString().Contains(titleSubstr) &&
                        IsWindowVisible(hWnd))
                        hit = true;
                }
                return !hit;
            }, IntPtr.Zero);
            return hit;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>等待应用窗口出现; 内核立即崩溃且再无窗口视为故障。</summary>
    public static bool WaitAppWindow(System.Diagnostics.Process proc,
        double timeoutSec = 8.0)
    {
        var end = DateTime.UtcNow.AddSeconds(timeoutSec);
        DateTime? exitAt = null;
        while (DateTime.UtcNow < end)
        {
            if (AppWindowVisible(AppTitle))
                return true;
            if (proc.HasExited)
            {
                exitAt ??= DateTime.UtcNow;
                if ((DateTime.UtcNow - exitAt.Value).TotalMilliseconds > 1500)
                    return false;          // 进程已退出且再无窗口出现
            }
            Thread.Sleep(250);
        }
        return false;
    }

    /// <summary>定位便携 Chromium: &lt;exe&gt;/chromium/ 下常见布局的有界搜索。</summary>
    public static string? FindPortableChromium()
    {
        string root = Path.Combine(ExeDir, "chromium");
        if (!Directory.Exists(root))
            return null;
        var relCandidates = new[]
        {
            "chrome.exe", @"Chrome-bin\chrome.exe", @"App\chrome.exe",
            @"App\Chrome-bin\chrome.exe", @"bin\chrome.exe",
        };
        foreach (var rel in relCandidates)
        {
            string p = Path.Combine(root, rel);
            if (File.Exists(p))
                return p;
        }
        int count = 0;
        foreach (var dir in SafeWalk(root))
        {
            string candidate = Path.Combine(dir, "chrome.exe");
            if (File.Exists(candidate))
                return candidate;
            count++;
            if (count > 2000)
                break;
        }
        return null;
    }

    /// <summary>有界下钻(os.walk 等价): 根相对路径达 3 个分隔符的目录整枝跳过。</summary>
    private static IEnumerable<string> SafeWalk(string root)
    {
        var stack = new Stack<string>();
        stack.Push(root);
        while (stack.Count > 0)
        {
            var dir = stack.Pop();
            string rel = Path.GetRelativePath(root, dir);
            int seps = 0;
            foreach (var ch in rel)
                if (ch == Path.DirectorySeparatorChar)
                    seps++;
            if (seps >= 3)
                continue;                  // python: relpath.count(sep)>=3 -> 剪枝
            yield return dir;
            IEnumerable<string>? sub = null;
            try { sub = Directory.EnumerateDirectories(dir); }
            catch { /* access denied etc. */ }
            if (sub is null) continue;
            foreach (var d in sub.Reverse())
                stack.Push(d);
        }
    }

    /// <summary>最高优先级通道: 便携 Chromium --app 窗口 + 健康检查。</summary>
    public static bool OpenPortableWindow(string url)
    {
        string? exe = FindPortableChromium();
        if (exe is null)
            return false;
        string profile = Path.Combine(ExeDir, "chromium-profile");
        System.Diagnostics.Process proc;
        try
        {
            var psi = new System.Diagnostics.ProcessStartInfo
            {
                FileName = exe,
                UseShellExecute = false,
                WorkingDirectory = Path.GetDirectoryName(exe) ?? ".",
            };
            psi.ArgumentList.Add("--app=" + KioskUrl(url));
            psi.ArgumentList.Add("--user-data-dir=" + profile);
            psi.ArgumentList.Add("--no-first-run");
            psi.ArgumentList.Add("--no-default-browser-check");
            psi.ArgumentList.Add("--window-size=1280,880");
            proc = System.Diagnostics.Process.Start(psi)!;
        }
        catch
        {
            Console.WriteLine("  便携 Chromium 启动失败，回退系统浏览器窗口");
            return false;
        }
        if (WaitAppWindow(proc))
        {
            Console.WriteLine("  UI: 便携 Chromium 应用窗口（已启用应用锁定）");
            return true;
        }
        Console.WriteLine("  便携 Chromium 内核故障（无窗口），回退 Edge/系统浏览器");
        return false;
    }

    /// <summary>以独立应用窗口(--app 模式)打开界面; 无标签页/地址栏。</summary>
    public static bool OpenAppWindow(string url)
    {
        string? exe = FindAppHost();
        if (exe is null)
            return false;
        try
        {
            var psi = new System.Diagnostics.ProcessStartInfo
            {
                FileName = exe,
                UseShellExecute = false,
            };
            psi.ArgumentList.Add("--app=" + KioskUrl(url));
            psi.ArgumentList.Add("--window-size=1280,880");
            _ = System.Diagnostics.Process.Start(psi);
            Console.WriteLine($"  UI: 应用窗口 ({Path.GetFileName(exe)})");
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>降级阶梯: 便携Chromium -> Edge/Chrome 应用窗口。</summary>
    public static void OpenUi(string url, string mode)
    {
        bool opened = false;
        if (mode is "auto" or "window")
            opened = OpenPortableWindow(url);
        if (!opened && mode is "auto" or "window")
            opened = OpenAppWindow(url);
        if (!opened)
        {
            string msg = "未找到可用界面通道：请将便携 Chromium 放入 chromium\\ 目录，" +
                         "或安装 Microsoft Edge / Google Chrome。";
            Console.WriteLine("  " + msg);
            try
            {
                File.AppendAllText(LogPath,
                    $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {msg}\n");
            }
            catch { /* best effort */ }
        }
    }
}

// ============================================================= HTTP layer

public static partial class Handlers
{
    public const long MaxUpload = 4L * 1024 * 1024 * 1024;      // 4 GiB
    public const int MaxJsonBody = 4 * 1048576;
    public static readonly string GuiDir =
        Path.Combine(AppContext.BaseDirectory, "gui");
    public static readonly string UploadDir =
        Path.Combine(AppContext.BaseDirectory,
            Path.Combine("tmp", "uploads"));

    /// <summary>同一时刻只弹一个系统文件对话框(python _browse_lock)。</summary>
    public static readonly SemaphoreSlim BrowseLock = new(1, 1);

    private const string JsonType = "application/json; charset=utf-8";

    // ------------------------------------------------------------ output

    public static async Task SendJson(HttpContext ctx, byte[] body,
        int status = 200)
    {
        if (ctx.Response.HasStarted)
            return;                        // 中途断开: 无法再写应答
        ctx.Response.StatusCode = status;
        ctx.Response.ContentType = JsonType;
        ctx.Response.Headers.CacheControl = "no-store";
        await ctx.Response.Body.WriteAsync(body);
    }

    public static byte[] ErrorJson(string msg)
    {
        using var ms = new MemoryStream();
        using (var w = new Utf8JsonWriter(ms))
        {
            w.WriteStartObject();
            w.WriteBoolean("ok", false);
            w.WriteString("error", msg);
            w.WriteEndObject();
        }
        return ms.ToArray();
    }

    /// <summary>_fail 等价: {"ok":false,"error":msg}</summary>
    public static Task Fail(HttpContext ctx, string msg, int status = 400)
        => SendJson(ctx, ErrorJson(msg), status);

    /// <summary>_ok 等价: {"ok":true, ...extra, "state":snapshot}</summary>
    public static async Task Ok(HttpContext ctx, Action<Utf8JsonWriter>? extra = null)
    {
        byte[] body;
        lock (SessionGate)
        {
            using var ms = new MemoryStream();
            using (var w = new Utf8JsonWriter(ms))
            {
                w.WriteStartObject();
                w.WriteBoolean("ok", true);
                extra?.Invoke(w);
                w.WritePropertyName("state");
                DefaultSession.WriteSnapshot(w);
                w.WriteEndObject();
            }
            body = ms.ToArray();
        }
        await SendJson(ctx, body);
    }

    public static readonly object SessionGate = new();
    public static Session DefaultSession => Sessions.Default;

    // -------------------------------------------------------------- input

    /// <summary>_read_json 等价: 空/缺失 -> null(args 视为 {}); >4MiB 拒绝。</summary>
    public static async Task<JsonDocument?> ReadArgs(HttpContext ctx)
    {
        long len = ctx.Request.ContentLength ?? 0;
        if (len <= 0)
            return null;
        if (len > MaxJsonBody)
            throw new PlainError("请求体过大");
        var buf = new byte[len];
        int read = 0;
        while (read < len)
        {
            int got = await ctx.Request.Body.ReadAsync(buf, read,
                (int)len - read);
            if (got <= 0)
                break;
            read += got;
        }
        if (read == 0)
            return null;
        try
        {
            return JsonDocument.Parse(buf.AsMemory(0, read));
        }
        catch (JsonException exc)
        {
            throw new PlainError(exc.Message);
        }
    }

    public static string? ArgStr(JsonDocument? doc, string key)
    {
        if (doc is null)
            return null;
        var root = doc.RootElement;
        return root.ValueKind == JsonValueKind.Object
            ? ArgStr(root, key)
            : null;
    }

    /// <summary>args.get(key) 等价(元素版本)。</summary>
    public static string? ArgStr(JsonElement root, string key)
    {
        if (root.ValueKind != JsonValueKind.Object ||
            !root.TryGetProperty(key, out var el))
            return null;
        return el.ValueKind switch
        {
            JsonValueKind.String => el.GetString(),
            JsonValueKind.Null or JsonValueKind.Undefined => null,
            JsonValueKind.Number => el.GetDouble().ToString(
                CultureInfo.InvariantCulture),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            _ => null,
        };
    }

    /// <summary>int(args.get(key) or default) 等价(数字/数字字符串)。</summary>
    public static int ArgInt(JsonDocument? doc, string key, int fallback)
    {
        if (doc is null)
            return fallback;
        var root = doc.RootElement;
        return root.ValueKind == JsonValueKind.Object
            ? ArgInt(root, key, fallback)
            : fallback;
    }

    /// <summary>int(args.get(key) or default) 等价(元素版本)。</summary>
    public static int ArgInt(JsonElement root, string key, int fallback)
    {
        if (root.ValueKind != JsonValueKind.Object ||
            !root.TryGetProperty(key, out var el) ||
            el.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            return fallback;
        if (el.ValueKind == JsonValueKind.Number)
        {
            double d = el.GetDouble();
            return (int)d;
        }
        if (el.ValueKind == JsonValueKind.String)
        {
            string s = (el.GetString() ?? "").Trim();
            if (s.Length == 0)
                return fallback;
            if (int.TryParse(s, NumberStyles.Integer,
                    CultureInfo.InvariantCulture, out var v))
                return v;
            throw new PlainError(
                $"invalid literal for int() with base 10: '{s}'");
        }
        return fallback;
    }

    // ------------------------------------------------------------- static

    private static readonly Dictionary<string, string> Mime =
        new(StringComparer.OrdinalIgnoreCase)
        {
            [".html"] = "text/html; charset=utf-8",
            [".css"] = "text/css; charset=utf-8",
            [".js"] = "text/javascript; charset=utf-8",
            [".svg"] = "image/svg+xml",
            [".png"] = "image/png",
            [".ico"] = "image/x-icon",
        };

    /// <summary>_serve_static 等价: 固定白名单, 未命中 404 JSON。</summary>
    public static async Task ServeStatic(HttpContext ctx, string rel)
    {
        string path = Path.GetFullPath(Path.Combine(GuiDir, rel));
        if (!path.StartsWith(Path.GetFullPath(GuiDir) +
                Path.DirectorySeparatorChar,
                StringComparison.OrdinalIgnoreCase) || !File.Exists(path))
        {
            await Fail(ctx, "not found", 404);
            return;
        }
        var ext = Path.GetExtension(path).ToLowerInvariant();
        ctx.Response.StatusCode = 200;
        ctx.Response.ContentType = Mime.GetValueOrDefault(ext,
            "application/octet-stream");
        ctx.Response.Headers.CacheControl = "no-cache";
        await ctx.Response.SendFileAsync(path);
    }

    // ------------------------------------------------------------- upload

    /// <summary>接收浏览器上传的 .astbox 字节流并存为服务器本地副本后解析。
    /// Kestrel 自身保证未读请求体不破坏连接(python 手工 drain 的目的在此达成)。</summary>
    public static async Task HandleUpload(HttpContext ctx)
    {
        long length = ctx.Request.ContentLength ?? 0;
        if (length <= 0 || length > MaxUpload)
        {
            await Fail(ctx, "文件为空或过大(上限 4 GiB)");
            return;
        }
        try
        {
            var driveRoot = Path.GetPathRoot(Path.GetFullPath(UploadDir)) ?? @"\";
            var drive = new DriveInfo(driveRoot);
            long free = drive.AvailableFreeSpace;
            if (free < length + 256 * 1048576)
            {
                await Fail(ctx, string.Format(CultureInfo.InvariantCulture,
                    "磁盘空间不足：需要约 {0:F1} GiB，剩余 {1:F1} GiB",
                    (length + 268435456) / 1073741824.0,
                    free / 1073741824.0));
                return;
            }
        }
        catch
        {
            // 空间探测失败不阻塞上传
        }

        string name = ctx.Request.Headers.TryGetValue("X-Filename",
            out var fnValues)
            ? fnValues.ToString()
            : "";
        name = Uri.UnescapeDataString(name ?? "");
        try
        {
            name = Path.GetFileName(name);
            name = name.Replace('\\', '_').Replace('/', '_');
            if (name.Length == 0)
                name = "upload.astbox";
            if (!name.EndsWith(".astbox", StringComparison.OrdinalIgnoreCase))
                name += ".astbox";
        }
        catch
        {
            name = "upload.astbox";
        }
        string stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss",
            CultureInfo.InvariantCulture);
        string dest = Path.Combine(UploadDir, $"{stamp}_{name}");
        string tmpf = dest + ".part";
        // ---- 阶段一: 不持锁接收字节流(临时名), 失败则报错
        try
        {
            Directory.CreateDirectory(UploadDir);
            await using (var f = File.Create(tmpf))
            {
                var buffer = new byte[1024 * 1024];
                long remain = length;
                while (remain > 0)
                {
                    int want = (int)Math.Min(buffer.Length, remain);
                    int got = await ctx.Request.Body.ReadAsync(buffer, 0, want);
                    if (got <= 0)
                        throw new IOException(
                            $"客户端提前断开(缺 {remain} 字节)");
                    await f.WriteAsync(buffer, 0, got);
                    remain -= got;
                }
                await f.FlushAsync();
            }
            File.Move(tmpf, dest, overwrite: true);   // 原子落位
        }
        catch (Exception exc)
        {
            try { if (File.Exists(tmpf)) File.Delete(tmpf); }
            catch { /* best effort */ }
            await Fail(ctx, $"保存上传副本失败: {exc.Message}");
            return;
        }
        // ---- 阶段二: 持会话锁解析
        try
        {
            lock (SessionGate)
            {
                DefaultSession.OpenPath(dest);
            }
        }
        catch (ApiError exc)
        {
            await Fail(ctx, $"{exc.Code}: {exc.Message}");
            return;
        }
        catch (AstboxError exc)
        {
            await Fail(ctx, $"ASTBOX_E_{exc.Code:X4}: {exc.Message}");
            return;
        }
        await Ok(ctx, w => w.WriteString("saved_to", dest));
    }

    /// <summary>双击 .passbox 的导入流程(C# 特性,有意偏离 python 参考):
    /// 校验→试锁→注册→【硬删除传播包】;成败语义见下。
    /// 传播包内嵌完整容器字节,UnwrapSecret 已将其落盘到包同目录
    /// 的 <名称>.astbox;全部成功后才删除 .passbox(直接删除,
    /// 不进回收站)。删除失败不影响导入成功,仅记录警告。</summary>
    public static (string? ContainerPath, string? Err) ImportPassboxBoot(
        string pbPath)
    {
        try
        {
            var info = PassboxFile.ReadInfo(pbPath);
            string? passphrase = null;
            string b32 = "";
            string cpath = "";
            if (info.NeedsPassphrase)
            {
                bool ok = false;
                for (int attempt = 0; attempt < 3; attempt++)
                {
                    passphrase = NativeDialogs.PromptPassword("ASTBOX 传播包",
                        "该传播包受口令保护，请输入口令：");
                    if (passphrase is null)
                        return (null, "已取消导入");
                    try
                    {
                        var unwrapped =
                            PassboxFile.UnwrapSecret(pbPath, passphrase);
                        b32 = unwrapped.SecretBase32;
                        cpath = unwrapped.ContainerPath;
                        ok = true;
                        break;
                    }
                    catch (AstboxError)
                    {
                        continue;
                    }
                }
                if (!ok)
                    return (null, "口令连续错误，已放弃导入");
            }
            else
            {
                var unwrapped = PassboxFile.UnwrapSecret(pbPath, null);
                b32 = unwrapped.SecretBase32;
                cpath = unwrapped.ContainerPath;
            }
            // 试锁判定: 密钥必须能解开内嵌容器才允许入库
            var uc = Container.UnlockContainer(cpath, secretB32: b32);
            var vid = uc.Parsed.Header.VaultId;
            int digits = 6;
            if (info.Header.TryGetProperty("digits", out var dgEl) &&
                dgEl.ValueKind == JsonValueKind.Number &&
                dgEl.TryGetInt32(out var d) && d != 0)
                digits = d;                // python: header.get("digits") or 6
            lock (SessionGate)
            {
                DefaultSession.RegisterSecret(vid, b32, digits,
                    (long)uc.Created);
            }
            Console.WriteLine($"  [passbox] 已导入并注册: {cpath}");

            // 全链成功后硬删除传播包(不进回收站);失败仅告警
            try
            {
                File.Delete(pbPath);
                Console.WriteLine("  [passbox] 传播包已删除");
            }
            catch (Exception del)
            {
                Console.WriteLine($"  [passbox] 警告: 传播包删除失败: {del.Message}");
            }
            return (cpath, null);
        }
        catch (AstboxError exc)
        {
            return (null, $"ASTBOX_E_{exc.Code:X4}: {exc.Message}");
        }
        catch (Exception exc)
        {
            return (null, $"{exc.GetType().FullName}: {exc.Message}");
        }
    }

    // ------------------------------------------------ 关联错配检测与引导

    /// <summary>关联确权引导的 epoch 标记。规范 §5.3: epoch 于版本升级时重置。
    /// 此值须与 installer/VERSION 同步递增(版本升级或引导逻辑调整时)。</summary>
    private const string AssocNudgeEpoch = "v3.0.0";

    private static readonly (string Ext, string ProgId)[] AssocPairs =
        { (".astbox", "Astbox.Container"), (".passbox", "Astbox.Passbox") };

    /// <summary>设置页深链: 直达 ASTBOX 应用条目(Win10/11 对参数支持略有差异,
    /// 参数被忽略时退化为普通默认应用页, 无副作用)。</summary>
    public static string AssocDeepLink
        => "ms-settings:defaultapps?registeredAppUser=" + Uri.EscapeDataString("ASTBOX");

    /// <summary>启动时双向(.astbox/.passbox)错配检测。
    /// 干净机/回退生效机: 静默通过。悬空 UserChoice(指向已不存在的 ProgId)
    /// 直接自愈删除。被接管且交互模式: 每 Epoch 至多一次弹窗引导手动确权;
    /// 非交互(--no-browser)只记日志, 不弹窗不写标记。</summary>
    public static void CheckAssociationNudge(bool interactive)
    {
        // 轻量遥测: 最近一次检测时间(运维排障用; 同时作为执行链存活性证据)
        try
        {
            using var hb = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(@"Software\Astbox");
            hb?.SetValue("AssocNudgeLastRun", DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") +
                $" interactive={interactive}");
        }
        catch { }

        var foreign = new List<string>();
        foreach (var (ext, progid) in AssocPairs)
        {
            try
            {
                using var uc = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(
                    @"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\" +
                    ext + @"\UserChoice");
                if (uc is null) continue;                       // 回退生效, 无需干预
                var pid = uc.GetValue("ProgId") as string;
                if (pid is null || pid == progid) continue;     // 已是我们
                using var cls = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(
                    @"Software\Classes\" + pid);
                if (cls is null)
                {
                    // 悬空指针自愈: 指向的 ProgId 已不存在, 删除残留键恢复回退
                    Microsoft.Win32.Registry.CurrentUser.DeleteSubKeyTree(
                        @"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\" +
                        ext + @"\UserChoice", throwOnMissingSubKey: false);
                    Console.WriteLine($"  [assoc] {ext} 悬空 UserChoice({pid}) 已清除");
                    continue;
                }
                foreign.Add($"{ext} ← {pid}");
            }
            catch (Exception assocEx)
            {
                // 诊断: 检测失败必须可观测(WinExe 控制台不可见)
                try
                {
                    File.AppendAllText(UiLauncher.LogPath,
                        $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] [assoc] {ext} 检测异常: {assocEx.Message}\n");
                }
                catch { }
            }
        }
        if (foreign.Count == 0) return;

        string detail = string.Join("; ", foreign);
        Console.WriteLine("  [assoc] 默认打开方式被接管: " + detail);
        if (!interactive) return;

        try
        {
            using var mk = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(
                @"Software\Astbox");
            var prev = mk?.GetValue("AssocNudgeVersion") as string;
            if (prev == AssocNudgeEpoch) return;                // 本版本内不再打扰
            bool yes = NativeDialogs.AskYesNo("ASTBOX 关联确认",
                "检测到以下文件类型的默认打开方式由其他程序接管:\n\n  " + detail +
                "\n\n是否前往系统设置改为 ASTBOX?\n" +
                "(稍后可在 设置 > 应用 > 默认应用 > ASTBOX 中修改)");
            mk?.SetValue("AssocNudgeVersion", AssocNudgeEpoch);
            if (yes)
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName = AssocDeepLink,
                    UseShellExecute = true,
                });
                Console.WriteLine("  [assoc] 已打开设置页: " + AssocDeepLink);
            }
        }
        catch { /* 尽力而为 */ }
    }
}

// =================================================================== main

/// <summary>端点注册与启动序列(python _run_server / do_GET / do_POST 的移植)。</summary>
public static class Program
{
    private const string JsonType = "application/json; charset=utf-8";

    /// <summary>python "%r" % exc 的近似等价(仅用于 500 兜底文案)。</summary>
    private static string Repr(Exception ex)
        => $"{ex.GetType().FullName}: {ex.Message}";

    private static byte[] BuildJson(Action<Utf8JsonWriter> build)
    {
        using var ms = new MemoryStream();
        using (var w = new Utf8JsonWriter(ms))
        {
            build(w);
        }
        return ms.ToArray();
    }

    private static async Task WriteStringArray(HttpContext ctx,
        IReadOnlyList<string> values)
    {
        ctx.Response.StatusCode = 200;
        ctx.Response.ContentType = JsonType;
        ctx.Response.Headers.CacheControl = "no-store";
        await using var writer = new Utf8JsonWriter(ctx.Response.Body);
        writer.WriteStartObject();
        writer.WriteBoolean("ok", true);
        writer.WritePropertyName("lines");
        writer.WriteStartArray();
        foreach (var line in values)
            writer.WriteStringValue(line);
        writer.WriteEndArray();
        writer.WritePropertyName("state");
        lock (Handlers.SessionGate)
            Handlers.DefaultSession.WriteSnapshot(writer);
        writer.WriteEndObject();
        await writer.FlushAsync();
    }

    public static void Main(string[] args)
    {
        try
        {
            try { Console.OutputEncoding = Encoding.UTF8; }
            catch { /* 无控制台(pythonw 等价场景)时静默 */ }
            RunServer(args);
        }
        catch (Exception ex)
        {
            CrashLog($"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] ASTBOX server crash:\n{ex}");
            throw;
        }
    }

    private static void CrashLog(string text)
    {
        try
        {
            File.AppendAllText(
                Path.Combine(AppContext.BaseDirectory, "server_error.log"),
                text + "\n\n");
        }
        catch { /* best effort */ }
    }

    // ------------------------------------------------------------ arg parse

    private sealed class Options
    {
        public string? Container;
        public int Port;                 // 0 = 首选序列
        public bool NoBrowser;
        public string Ui = "auto";
        public string? ImportPassbox;
    }

    private static Options ParseOptions(string[] args)
    {
        var o = new Options();
        for (int i = 0; i < args.Length; i++)
        {
            string a = args[i];
            string? Value()
            {
                if (i + 1 < args.Length) return args[++i];
                return null;
            }
            if (a == "--port")
                _ = int.TryParse(Value(), out o.Port);
            else if (a.StartsWith("--port="))
                _ = int.TryParse(a["--port=".Length..], out o.Port);
            else if (a == "--no-browser")
                o.NoBrowser = true;
            else if (a == "--ui")
                o.Ui = Value() ?? "auto";
            else if (a.StartsWith("--ui="))
                o.Ui = a["--ui=".Length..];
            else if (a == "--import-passbox")
                o.ImportPassbox = Value();
            else if (a.StartsWith("--import-passbox="))
                o.ImportPassbox = a["--import-passbox=".Length..];
            else if (!a.StartsWith('-') && o.Container is null)
                o.Container = a;          // 文件关联: 启动后立即打开的 .astbox
        }
        return o;
    }

    // ---------------------------------------------------------- port choice

    /// <summary>显式 --port 单点绑定; 否则按首选序列降序尝试, 全忙随机。</summary>
    private static int PickPort(int explicitPort)
    {
        var candidates = explicitPort != 0
            ? new[] { explicitPort }
            : new[] { 11920, 21524, 6583, 8466, 7988, 0 };
        foreach (var cand in candidates)
        {
            TcpListener? probe = null;
            try
            {
                probe = new TcpListener(IPAddress.Loopback, cand);
                probe.Start();
                return cand;
            }
            catch
            {
                continue;                  // 全忙则尝试下一候选
            }
            finally
            {
                try { probe?.Stop(); } catch { /* best effort */ }
            }
        }
        throw new RuntimeException("无可用端口");   // 与 python raise last_bind_err 对齐
    }

    private sealed class RuntimeException : Exception
    {
        public RuntimeException(string message) : base(message) { }
    }

    // -------------------------------------------------------- upload hygiene

    /// <summary>上传副本卫生: 清理 7 天前的历史上传, 防止 tmp/uploads 无限增长。</summary>
    private static void CleanupUploads()
    {
        try
        {
            if (!Directory.Exists(Handlers.UploadDir))
                return;
            var cutoff = DateTime.Now.AddDays(-7);
            foreach (var file in Directory.EnumerateFiles(Handlers.UploadDir))
            {
                try
                {
                    if (File.GetLastWriteTime(file) < cutoff)
                        File.Delete(file);
                }
                catch { /* best effort */ }
            }
        }
        catch { /* best effort */ }
    }

    // -------------------------------------------------------------- run

    private static void RunServer(string[] args)
    {
        var opts = ParseOptions(args);

        if (opts.ImportPassbox is { } pbRaw)
        {
            string pb = Path.GetFullPath(pbRaw.Trim().Trim('"'));
            if (!File.Exists(pb))
            {
                NativeDialogs.ShowError($"文件不存在: {pb}");
            }
            else
            {
                var (cpath, err) = Handlers.ImportPassboxBoot(pb);
                if (err is not null)
                    NativeDialogs.ShowError(err);
                else if (cpath is not null)
                    opts.Container = cpath;
            }
        }

        CleanupUploads();

        int port = PickPort(opts.Port);

        var builder = WebApplication.CreateBuilder(
            new WebApplicationOptions { Args = Array.Empty<string>() });
        builder.WebHost.UseUrls($"http://127.0.0.1:{port}");
        builder.WebHost.ConfigureKestrel(k =>
        {
            // 上传上限(MAX_UPLOAD=4GiB)由处理器按 Content-Length 校验
            k.Limits.MaxRequestBodySize = null;
            k.AddServerHeader = false;
        });
        builder.Logging.ClearProviders();      // python 安静模式 log_message=no-op

        var app = builder.Build();

        // ---- 统一错误映射(python do_GET/do_POST 的 except 阶梯) ----
        app.Use(async (ctx, next) =>
        {
            try
            {
                await next(ctx);
            }
            catch (ApiError ex)
            {
                await Handlers.Fail(ctx, $"{ex.Code}: {ex.Message}", 400);
            }
            catch (AstboxError ex)
            {
                await Handlers.Fail(ctx, $"{ex.CodeName}: {ex.Message}", 400);
            }
            catch (PlainError ex)
            {
                await Handlers.Fail(ctx, ex.Message, 400);
            }
            catch (Exception ex)
            {
                await Handlers.Fail(ctx, $"服务器内部错误: {Repr(ex)}", 500);
            }
        });

        MapApi(app);
        MapStatic(app);

        // 启动容器(文件关联), 打开失败不退出 —— 与 python 一致
        if (opts.Container is { } containerRaw)
        {
            try
            {
                string cpath = Path.GetFullPath(containerRaw.Trim().Trim('"'));
                if (!File.Exists(cpath))
                    throw new ApiError(EApi.NoContainer, $"文件不存在: {cpath}");
                lock (Handlers.SessionGate)
                    Handlers.DefaultSession.OpenPath(cpath);
                Console.WriteLine($"  已打开: {cpath}");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"  打开容器失败: {Repr(ex)}");
            }
        }

        app.Lifetime.ApplicationStarted.Register(() =>
        {
            // 端口 0(临时端口)时以 Kestrel 实际绑定端口为准
            int bannerPort = port;
            try
            {
                var addr = app.Urls.FirstOrDefault();
                if (addr is not null &&
                    Uri.TryCreate(addr, UriKind.Absolute, out var uri))
                    bannerPort = uri.Port;
            }
            catch { /* 保持探测到的端口 */ }
            string url = $"http://127.0.0.1:{bannerPort}/";
            Console.WriteLine(new string('=', 56));
            Console.WriteLine("  ASTBOX 容器管理器 · V3.0.1 · Liquid Glass Web UI");
    // fresh hash: V3.0.1 version bump rebuild
            Console.WriteLine($"  {url}");
            Console.WriteLine("  仅监听 127.0.0.1，关闭此进程即退出。Ctrl+C 退出。");
            Console.WriteLine(new string('=', 56));
            if (!opts.NoBrowser)
            {
                string uiMode = opts.Ui;
                _ = Task.Run(async () =>
                {
                    await Task.Delay(400);     // threading.Timer(0.4, ...) 对齐
                    UiLauncher.OpenUi(url, uiMode);
                    try { Handlers.CheckAssociationNudge(interactive: true); }
                    catch { /* 引导为尽力而为 */ }
                });
            }
            else
            {
                // 无头模式只记日志, 不弹窗不写标记
                try { Handlers.CheckAssociationNudge(interactive: false); }
                catch { }
            }
        });

        app.Run();
    }

    // ------------------------------------------------------------- routing

    private static void MapApi(WebApplication app)
    {
        // ---------------- GET ----------------
        app.MapGet("/api/state", async (HttpContext ctx) =>
        {
            await Handlers.Ok(ctx);
        });

        app.MapGet("/api/selftest", async (HttpContext ctx) =>
        {
            var lines = Crypto.Selftest();     // 失败抛 AstboxError -> 400
            await WriteStringArray(ctx, lines);
        });

        // ---------------- POST ---------------
        // 模式: await 仅在锁外; 锁内同步完成状态迁移并构造应答 Task。
        app.MapPost("/api/open", async (HttpContext ctx) =>
        {
            using var doc = await Handlers.ReadArgs(ctx);
            string path = (Handlers.ArgStr(doc, "path") ?? "").Trim().Trim('"');
            Task respond;
            lock (Handlers.SessionGate)
            {
                if (path.Length == 0 || !File.Exists(path))
                    respond = Handlers.Fail(ctx, $"文件不存在: {path}");
                else
                {
                    Handlers.DefaultSession.OpenPath(path);
                    respond = Handlers.Ok(ctx);
                }
            }
            await respond;
        });

        app.MapPost("/api/unlock", async (HttpContext ctx) =>
        {
            using var doc = await Handlers.ReadArgs(ctx);
            string totp = (Handlers.ArgStr(doc, "totp") ?? "").Trim();
            Task respond;
            lock (Handlers.SessionGate)
            {
                Handlers.DefaultSession.Unlock(totp);
                respond = Handlers.Ok(ctx);
            }
            await respond;
        });

        app.MapPost("/api/export_passbox", async (HttpContext ctx) =>
        {
            using var doc = await Handlers.ReadArgs(ctx);
            Task respond;
            lock (Handlers.SessionGate)
            {
                string outPath = (Handlers.ArgStr(doc, "out") ?? "").Trim().Trim('"');
                ExportPassboxLocked(doc, outPath);
                respond = Handlers.Ok(ctx, w => w.WriteString("out", outPath));
            }
            await respond;
        });

        app.MapPost("/api/lock", async (HttpContext ctx) =>
        {
            using var _doc = await Handlers.ReadArgs(ctx);
            Task respond;
            lock (Handlers.SessionGate)
            {
                Handlers.DefaultSession.Lock();
                respond = Handlers.Ok(ctx);
            }
            await respond;
        });

        app.MapPost("/api/nav", async (HttpContext ctx) =>
        {
            using var doc = await Handlers.ReadArgs(ctx);
            JsonElement? target =
                doc is null ? null : doc.RootElement.Clone();
            Task respond;
            lock (Handlers.SessionGate)
            {
                Handlers.DefaultSession.NavTo(target);
                respond = Handlers.Ok(ctx);
            }
            await respond;
        });

        app.MapPost("/api/back", async (HttpContext ctx) =>
        {
            using var _doc = await Handlers.ReadArgs(ctx);
            Task respond;
            lock (Handlers.SessionGate)
            {
                Handlers.DefaultSession.NavBack();
                respond = Handlers.Ok(ctx);
            }
            await respond;
        });

        app.MapPost("/api/forward", async (HttpContext ctx) =>
        {
            using var _doc = await Handlers.ReadArgs(ctx);
            Task respond;
            lock (Handlers.SessionGate)
            {
                Handlers.DefaultSession.NavForward();
                respond = Handlers.Ok(ctx);
            }
            await respond;
        });

        app.MapPost("/api/up", async (HttpContext ctx) =>
        {
            using var _doc = await Handlers.ReadArgs(ctx);
            Task respond;
            lock (Handlers.SessionGate)
            {
                Handlers.DefaultSession.NavUp();
                respond = Handlers.Ok(ctx);
            }
            await respond;
        });

        app.MapPost("/api/outdir", async (HttpContext ctx) =>
        {
            using var doc = await Handlers.ReadArgs(ctx);
            Task respond;
            lock (Handlers.SessionGate)
            {
                Handlers.DefaultSession.SetOutDir(
                    (Handlers.ArgStr(doc, "path") ?? "").Trim());
                respond = Handlers.Ok(ctx);
            }
            await respond;
        });

        app.MapPost("/api/extract", async (HttpContext ctx) =>
        {
            using var doc = await Handlers.ReadArgs(ctx);
            List<string>? ids = ParseIds(doc);
            Task respond;
            lock (Handlers.SessionGate)
            {
                // python: (args.get("out") or SESSION.out_dir or "").strip()
                string outRaw = Handlers.ArgStr(doc, "out") ?? "";
                if (outRaw.Length == 0)
                    outRaw = Handlers.DefaultSession.OutDir;
                string outDir = outRaw.Trim();
                int n = Handlers.DefaultSession.Extract(ids, outDir);
                Handlers.DefaultSession.SetOutDir(outDir);
                respond = Handlers.Ok(ctx, w =>
                {
                    w.WriteNumber("count", n);
                    w.WriteString("out", outDir);
                });
            }
            await respond;
        });

        app.MapPost("/api/verify", async (HttpContext ctx) =>
        {
            using var _doc = await Handlers.ReadArgs(ctx);
            Task respond;
            lock (Handlers.SessionGate)
            {
                var session = Handlers.DefaultSession;
                if (session.Uc is null)
                    throw new ApiError(EApi.NotUnlocked, "请先解锁容器");
                Container.VerifyFull(session.Uc);
                respond = Handlers.Ok(ctx, w =>
                    w.WriteString("message",
                        "完整性验证通过：全部数据记录认证成功"));
            }
            await respond;
        });

        app.MapPost("/api/totp", async (HttpContext ctx) =>
        {
            using var doc = await Handlers.ReadArgs(ctx);
            string b32 = (Handlers.ArgStr(doc, "b32") ?? "").Trim();
            int digits = Handlers.ArgInt(doc, "digits", 6);
            string code = Crypto.TotpAt(b32, digits);
            Task respond;
            lock (Handlers.SessionGate)
            {
                Handlers.DefaultSession.RememberSecret(b32, digits);
                respond = Handlers.Ok(ctx, w => w.WriteString("code", code));
            }
            await respond;
        });

        app.MapPost("/api/pack", async (HttpContext ctx) =>
        {
            using var doc = await Handlers.ReadArgs(ctx);
            Task respond;
            lock (Handlers.SessionGate)
            {
                respond = Handlers.Ok(ctx, w =>
                {
                    w.WritePropertyName("pack");
                    w.WriteStartObject();
                    Handlers.DoPack(Handlers.DefaultSession, w,
                        doc?.RootElement ?? default);
                    w.WriteEndObject();
                });
            }
            await respond;
        });

        app.MapPost("/api/demo", async (HttpContext ctx) =>
        {
            using var doc = await Handlers.ReadArgs(ctx);
            string dst = Handlers.ArgStr(doc, "dst") ?? "";
            int digits = Handlers.ArgInt(doc, "digits", 6);
            string profile = Handlers.ArgStr(doc, "profile")
                             ?? "";
            Task respond;
            lock (Handlers.SessionGate)
            {
                respond = Handlers.Ok(ctx, w =>
                {
                    w.WritePropertyName("demo");
                    w.WriteStartObject();
                    Handlers.MakeDemo(Handlers.DefaultSession, w, dst,
                        digits, profile);
                    w.WriteEndObject();
                });
            }
            await respond;
        });

        app.MapPost("/api/add", async (HttpContext ctx) =>
        {
            using var doc = await Handlers.ReadArgs(ctx);
            var paths = ParsePaths(doc);
            Task respond;
            lock (Handlers.SessionGate)
            {
                int n = Handlers.DefaultSession.AddPaths(paths);
                respond = Handlers.Ok(ctx, w => w.WriteNumber("count", n));
            }
            await respond;
        });

        // 原生对话框期间不持有会话锁，避免阻塞其他请求
        app.MapPost("/api/browse", async (HttpContext ctx) =>
        {
            using var doc = await Handlers.ReadArgs(ctx);
            var paths = BrowseCore(doc);
            await Handlers.Ok(ctx, w =>
            {
                w.WritePropertyName("paths");
                w.WriteStartArray();
                foreach (var p in paths)
                    w.WriteStringValue(p);
                w.WriteEndArray();
            });
        });

        // 红点退出: 先应答前端, 再优雅关闭服务进程
        app.MapPost("/api/shutdown", async (HttpContext ctx) =>
        {
            await Handlers.Ok(ctx, w =>
                w.WriteString("message", "ASTBOX 服务即将退出"));
            _ = Task.Run(async () =>
            {
                await Task.Delay(300);         // threading.Timer(0.3, ...) 对齐
                Environment.Exit(0);           // 兜底: 不被对话框线程阻塞
            });
        });

        app.MapPost("/api/open_upload",
            async (HttpContext ctx) => await Handlers.HandleUpload(ctx));

        // 未匹配的 POST 路径 -> 404 JSON(python else 分支)
        app.MapPost("/{**path}", async (HttpContext ctx) =>
        {
            await Handlers.Fail(ctx, "not found", 404);
        });
    }

    private static void ExportPassboxLocked(JsonDocument? doc, string outPath)
    {
        // out/passphrase 解析已在调用方完成, 此处持锁执行核心校验+写盘
        var session = Handlers.DefaultSession;
        if (session.Uc is null)
            throw new PlainError("请先解锁容器");
        if (string.IsNullOrEmpty(outPath))
            throw new PlainError("请指定输出路径");
        string passphrase = Handlers.ArgStr(doc, "passphrase") ?? "";
        passphrase = passphrase.Length == 0 ? null : passphrase;
        var uc = session.Uc!;
        var key = Convert.ToHexString(uc.Parsed.Header.VaultId)
            .ToLowerInvariant();
        if (!session.Secrets.TryGetValue(key, out var entry) ||
            entry is null)
            throw new PlainError("本机没有该容器的密钥记录，无法生成传播包");
        try
        {
            PassboxFile.PackPassbox(uc.Parsed.Path, entry.B32,
                entry.Digits != 0 ? entry.Digits : 6, (long)uc.Created,
                outPath, passphrase: passphrase);
        }
        catch (AstboxError exc)
        {
            throw new PlainError(
                $"生成失败: ASTBOX_E_{exc.Code:X4}: {exc.Message}");
        }
        catch (Exception exc)
        {
            throw new PlainError(
                $"写入失败: {exc.GetType().Name}: {exc.Message}");
        }
    }

    private static List<string>? ParseIds(JsonDocument? doc)
    {
        if (doc is null ||
            doc.RootElement.ValueKind != JsonValueKind.Object ||
            !doc.RootElement.TryGetProperty("ids", out var idsEl) ||
            idsEl.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            return null;
        var ids = new List<string>();
        if (idsEl.ValueKind == JsonValueKind.Array)
            foreach (var el in idsEl.EnumerateArray())
                ids.Add(el.ToString() ?? "");
        else
            ids.Add(idsEl.ToString() ?? "");
        return ids;
    }

    private static List<string> ParsePaths(JsonDocument? doc)
    {
        var paths = new List<string>();
        if (doc is not null &&
            doc.RootElement.ValueKind == JsonValueKind.Object &&
            doc.RootElement.TryGetProperty("paths", out var arr) &&
            arr.ValueKind == JsonValueKind.Array)
            foreach (var el in arr.EnumerateArray())
                paths.Add(el.ToString() ?? "");
        return paths;
    }

    /// <summary>_native_browse: 参数解析 + 有界互斥 + 原生对话框。
    /// 对话框失败时抛 E_BROWSE。</summary>
    private static List<string> BrowseCore(JsonDocument? doc)
    {
        string mode = Handlers.ArgStr(doc, "mode") ?? "file";
        string title = Handlers.ArgStr(doc, "title") ?? "";
        string initial = (Handlers.ArgStr(doc, "initial") ?? "")
            .Trim().Trim('"');
        string defaultext = Handlers.ArgStr(doc, "defaultext") ?? "";

        string? initialDir = null;
        string candidateDir = Path.GetDirectoryName(initial) ?? "";
        if (!string.IsNullOrEmpty(candidateDir) &&
            Directory.Exists(candidateDir))
            initialDir = candidateDir;

        var fts = new List<(string, string)>();
        if (doc is not null &&
            doc.RootElement.ValueKind == JsonValueKind.Object &&
            doc.RootElement.TryGetProperty("filetypes", out var ftArr) &&
            ftArr.ValueKind == JsonValueKind.Array)
            foreach (var pair in ftArr.EnumerateArray())
                if (pair.ValueKind == JsonValueKind.Array &&
                    pair.GetArrayLength() >= 2)
                    fts.Add((pair[0].ToString() ?? "",
                        pair[1].ToString() ?? ""));

        Handlers.BrowseLock.Wait();
        try
        {
            try
            {
                return NativeDialogs.WinDialog(mode, title, initialDir, fts,
                    defaultext, initial);
            }
            catch (Exception exc) when (exc is not ApiError)
            {
                throw new ApiError(EApi.Browse,
                    $"无法打开系统对话框({exc.GetType().Name}: {exc.Message})，" +
                    "请手动输入路径");
            }
        }
        finally
        {
            Handlers.BrowseLock.Release();
        }
    }

    private static void MapStatic(WebApplication app)
    {
        // 固定白名单: "/", "/index.html", "/app.css", "/app.js", "/icon.png"
        // 注意: 无参 MapFallback 编译为 {*path:nonfile}, 带扩展名的路径
        // (app.js/icon.png 等)不会命中 —— 必须显式 catch-all。
        app.MapFallback("/{**path}", async (HttpContext ctx) =>
        {
            string route = (ctx.Request.Path.Value ?? "/").Split('?')[0];
            if (ctx.Request.Method == HttpMethods.Get &&
                (route == "/" || route == "/index.html"))
                await Handlers.ServeStatic(ctx, "index.html");
            else if (ctx.Request.Method == HttpMethods.Get &&
                     route is "/app.css" or "/app.js" or "/icon.png")
                await Handlers.ServeStatic(ctx, route.TrimStart('/'));
            else
                await Handlers.Fail(ctx, "not found", 404);
        });
    }
}
// fresh hash: app body icon rebuild 223739
