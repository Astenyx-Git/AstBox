// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
//! QR code helpers for TOTP provisioning (port of astbox/qrutil.py).
//! Uses QRCoder (pure C#, AOT-safe): matrix for the web UI, PNG for the CLI.

namespace Astbox;

public static class QrUtil
{
    public static bool Available() => true;

    /// <summary>Random Base32 TOTP secret (RFC 4648, unpadded).</summary>
    public static string GenerateSecret(int byteLen = 20)
        => Crypto.Base32Encode(Crypto.RandomBytes(byteLen));

    /// <summary>Standard otpauth:// URI (SHA1 / 30 s / T0=0).</summary>
    public static string BuildOtpauthUri(string secret, int digits, string label)
        => $"otpauth://totp/{label}?secret={secret}&issuer=ASTBOX" +
           $"&algorithm=SHA1&digits={digits}&period=30";

    /// <summary>QR boolean matrix including a quiet zone of `border` modules.</summary>
    public static IReadOnlyList<bool[]> QrMatrix(string uri, int border = 2)
    {
        using var generator = new QRCoder.QRCodeGenerator();
        using var data = generator.CreateQrCode(uri,
            QRCoder.QRCodeGenerator.ECCLevel.M);
        var core = data.ModuleMatrix;          // rows of bool[]
        int h = core.Count;
        int w = h > 0 ? core[0].Length : 0;
        var matrix = new bool[h + border * 2][];
        for (int y = 0; y < matrix.Length; y++)
        {
            matrix[y] = new bool[w + border * 2];
            int cy = y - border;
            if (cy < 0 || cy >= h) continue;   // quiet-zone row stays false
            var row = core[cy];
            for (int x = 0; x < w; x++)
                matrix[y][border + x] = row[x];
        }
        return matrix;
    }

    /// <summary>Write the QR code of uri as PNG bytes.</summary>
    public static byte[] QrPngBytes(string uri, int pixelsPerModule = 6)
    {
        using var generator = new QRCoder.QRCodeGenerator();
        using var data = generator.CreateQrCode(uri,
            QRCoder.QRCodeGenerator.ECCLevel.M);
        using var png = new QRCoder.PngByteQRCode(data);
        return png.GetGraphic(pixelsPerModule);
    }

    /// <summary>Write the QR code of uri to a PNG file.</summary>
    public static string SaveQrPng(string uri, string path)
    {
        File.WriteAllBytes(path, QrPngBytes(uri));
        return path;
    }
}
