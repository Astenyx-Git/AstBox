// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
// SAC hash-retry: touch comment
//! ASTBOX v1.0 core — Rust port of the C# Astbox.Core library.
//!
//! Translation-fidelity port of `Astbox.Core` (which itself ports the Python
//! reference `astbox/`): byte-compatible containers, deterministic CBOR,
//! Argon2id + XChaCha20-Poly1305, propagation packages, QR helpers.

pub mod bin;
pub mod cbor_det;
pub mod constants;
pub mod container;
pub mod creator;
pub mod crypto;
pub mod errors;
pub mod extractor;
pub mod modifier;
pub mod passbox_file;
pub mod qr_util;
pub mod rng;

pub use bin::{put, u16_be_write, u32_be_write, u64_be_write};
pub use cbor_det::{CborDet, CborValue};
pub use constants::Constants;
pub use container::{
    Container, DataChunk, Entry, Footer, Header, KeySlot, ParsedContainer, UnlockedContainer,
};
pub use errors::{AstboxError, E};
pub use crypto::{Crypto, Subkeys};

/// Convenient result alias used across the crate.
pub type Result<T> = std::result::Result<T, AstboxError>;
