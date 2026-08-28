// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
//! QR code helpers for TOTP provisioning (port of Astbox.Core/QrUtil.cs).
//! Matrix for the web UI, PNG for the CLI. The `qrcode` crate replaces
//! QRCoder; module semantics (ECC level M) match, PNG encoding is byte-level
//! independent of QRCoder (a rendering artifact, not part of the format).

use crate::constants::Constants;
use crate::crypto::Crypto;
use crate::Result;

pub struct QrUtil;

impl QrUtil {
    pub fn available() -> bool {
        true
    }

    /// Random Base32 TOTP secret (RFC 4648, unpadded).
    pub fn generate_secret(byte_len: usize) -> Result<String> {
        Ok(Crypto::base32_encode(&Crypto::random_bytes(byte_len)?))
    }

    /// Standard otpauth:// URI (SHA1 / 30 s / T0=0).
    pub fn build_otpauth_uri(secret: &str, digits: u8, label: &str) -> String {
        format!(
            "otpauth://totp/{}?secret={}&issuer=ASTBOX&algorithm=SHA1&digits={}&period=30",
            label, secret, digits
        )
    }

    fn raw_matrix(uri: &str) -> Result<(Vec<bool>, usize)> {
        let code = qrcode::QrCode::with_error_correction_level(uri.as_bytes(), qrcode::EcLevel::M)
            .map_err(|e| crate::err!(crate::errors::E::CryptoFailure, "QR encode failed: {:?}", e))?;
        let width = code.width();
        let colors = code.to_colors();
        let matrix = colors.iter().map(|c| *c == qrcode::Color::Dark).collect();
        Ok((matrix, width))
    }

    /// QR boolean matrix including a quiet zone of `border` modules.
    pub fn qr_matrix(uri: &str, border: usize) -> Result<Vec<Vec<bool>>> {
        let (core, w) = Self::raw_matrix(uri)?;
        let h = if w > 0 { core.len() / w } else { 0 };
        let dim = w + border * 2;
        let mut matrix = vec![vec![false; dim]; h + border * 2];
        for y in 0..h {
            for x in 0..w {
                matrix[y + border][x + border] = core[y * w + x];
            }
        }
        Ok(matrix)
    }

    /// QR code of uri as PNG bytes (black on white, quiet zone 4, matching
    /// QRCoder PngByteQRCode.GetGraphic defaults).
    pub fn qr_png_bytes(uri: &str, pixels_per_module: usize) -> Result<Vec<u8>> {
        let (core, w) = Self::raw_matrix(uri)?;
        let h = if w > 0 { core.len() / w } else { 0 };
        let border = 4;
        let dim_w = w + border * 2;
        let dim_h = h + border * 2;
        let img_w = dim_w * pixels_per_module;
        let img_h = dim_h * pixels_per_module;

        // raw RGBA rows (matches QRCoder default: opaque black/white)
        let mut raw = Vec::with_capacity(img_w * img_h * 4);
        for py in 0..img_h {
            let my = py / pixels_per_module;
            for px in 0..img_w {
                let mx = px / pixels_per_module;
                let dark = mx >= border
                    && my >= border
                    && mx < border + w
                    && my < border + h
                    && core[(my - border) * w + (mx - border)];
                if dark {
                    raw.extend_from_slice(&[0x00, 0x00, 0x00, 0xFF]);
                } else {
                    raw.extend_from_slice(&[0xFF, 0xFF, 0xFF, 0xFF]);
                }
            }
        }

        let mut out = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut out, img_w as u32, img_h as u32);
            enc.set_color(png::ColorType::Rgba);
            enc.set_depth(png::BitDepth::Eight);
            let mut writer = enc
                .write_header()
                .map_err(|e| crate::err!(crate::errors::E::CryptoFailure, "png: {}", e))?;
            writer
                .write_image_data(&raw)
                .map_err(|e| crate::err!(crate::errors::E::CryptoFailure, "png: {}", e))?;
        }
        Ok(out)
    }

    /// Write the QR code of uri to a PNG file.
    pub fn save_qr_png(uri: &str, path: &str) -> Result<String> {
        std::fs::write(path, Self::qr_png_bytes(uri, 6)?)
            .map_err(|e| crate::err!(crate::errors::E::Io, "cannot write {}: {}", path, e))?;
        Ok(path.to_string())
    }

    /// Kept for API parity with Constants consumers that reference the label.
    pub fn kdf_label_note() -> &'static str {
        "ARGON2ID_HIGH"
    }
}

// Silence unused-import warning for Constants (kept for parity edits).
const _: u16 = Constants::CRED_TYPE_TOTP;
