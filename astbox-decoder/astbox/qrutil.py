# -*- coding: utf-8 -*-
# Copyright 2026 Astenyx-Git
# SPDX-License-Identifier: Apache-2.0
"""QR code helpers for TOTP provisioning (otpauth URI).

Uses the pure-Python ``qrcode`` package (no Pillow required):
  - GUI: render the QR matrix on a tkinter Canvas
  - CLI: save a PNG via qrcode.image.pure.PyPNGImage
"""
import base64
import os

try:
    import qrcode
    _QR_OK = True
except Exception:  # pragma: no cover
    qrcode = None
    _QR_OK = False


def available():
    return _QR_OK


def generate_secret(byte_len=20):
    """Random Base32 TOTP secret (RFC 4648, unpadded)."""
    return base64.b32encode(os.urandom(byte_len)).decode("ascii").rstrip("=")


def build_otpauth_uri(secret, digits, label):
    """Standard otpauth:// URI for TOTP provisioning (SHA1 / 30 s / T0=0)."""
    return ("otpauth://totp/%s?secret=%s&issuer=ASTBOX"
            "&algorithm=SHA1&digits=%d&period=30" % (label, secret, digits))


def qr_matrix(uri, border=2):
    """Return the QR boolean matrix (list of rows, includes quiet zone)."""
    if not _QR_OK:
        raise RuntimeError("qrcode package not installed "
                           "(run bootstrap_deps.py)")
    qr = qrcode.QRCode(border=border, box_size=1,
                       error_correction=qrcode.constants.ERROR_CORRECT_M)
    qr.add_data(uri)
    qr.make(fit=True)
    return qr.get_matrix()


def render_qr_canvas(parent, uri, scale=6, border=2):
    """Draw a QR code on a tkinter Canvas and return it."""
    import tkinter as tk
    matrix = qr_matrix(uri, border=border)
    n = len(matrix)
    size = n * scale
    cv = tk.Canvas(parent, width=size, height=size, bg="white",
                   highlightthickness=0)
    for y, row in enumerate(matrix):
        for x, cell in enumerate(row):
            if cell:
                cv.create_rectangle(x * scale, y * scale,
                                    (x + 1) * scale, (y + 1) * scale,
                                    fill="#000000", outline="")
    return cv


def save_qr_png(uri, path):
    """Write the QR code of ``uri`` to a PNG file (pure-Python PNG)."""
    if not _QR_OK:
        raise RuntimeError("qrcode package not installed "
                           "(run bootstrap_deps.py)")
    from qrcode.image.pure import PyPNGImage
    img = qrcode.make(uri, image_factory=PyPNGImage)
    with open(path, "wb") as f:
        img.save(f)
    return path
