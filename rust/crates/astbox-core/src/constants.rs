// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
//! ASTBOX v1.0 protocol constants
//! (port of Astbox.Core/Constants.cs; sources: ASTBOX-v1.0-01-Core-Format.txt et al.)

use crate::errors::E;

pub struct Constants;

impl Constants {
    pub const HEADER_MAGIC: &'static [u8; 6] = b"ASTBOX";
    pub const FOOTER_MAGIC: &'static [u8; 8] = b"ASTBOXF1";
    pub const VERSION: u16 = 1;

    pub const HEADER_SIZE: u64 = 128;
    pub const KEY_SLOT_SIZE: u64 = 192;
    pub const FOOTER_SIZE: u64 = 112;
    pub const MIN_KEY_SLOT_COUNT: u32 = 1;
    pub const MAX_KEY_SLOT_COUNT: u32 = 16;

    pub const VAULT_ID_SIZE: usize = 16;
    pub const SLOT_ID_SIZE: usize = 16;
    pub const VAULT_KEY_SIZE: usize = 32;
    pub const SALT_SIZE: usize = 32;
    pub const WRAP_NONCE_SIZE: usize = 24;
    pub const WRAPPED_VAULT_KEY_SIZE: usize = 48;
    pub const MAC_SIZE: usize = 16;

    pub const METADATA_NONCE_SIZE: usize = 24;
    pub const METADATA_TAG_SIZE: usize = 16;
    pub const DATA_NONCE_SIZE: usize = 24;
    pub const DATA_TAG_SIZE: usize = 16;
    /// Fixed per-record overhead: FileID(16)+ChunkIndex(8)+PlaintextLength(4)
    /// +DataNonce(24)+Tag(16) == 68
    pub const DATA_RECORD_OVERHEAD: u64 = 68;

    pub const MAX_CHUNK_PLAINTEXT: usize = 1048576; // 1 MiB

    // Credential types
    pub const CRED_TYPE_PASSWORD: u16 = 0x0001;
    pub const CRED_TYPE_TOTP: u16 = 0x0002;

    // KDF profiles
    pub const KDF_PROFILE_HIGH: u16 = 0x0001;
    pub const KDF_PROFILE_MEMORY_CONSTRAINED: u16 = 0x0002;

    /// KDF profile -> (memory KiB, time cost, parallelism).
    /// Port of Constants.Argon2Profile; throws InvalidArgument on unknown.
    pub fn argon2_profile(profile: u16) -> crate::Result<(u32, u32, u32)> {
        match profile {
            Self::KDF_PROFILE_HIGH => Ok((262144, 3, 1)),
            Self::KDF_PROFILE_MEMORY_CONSTRAINED => Ok((65536, 3, 1)),
            _ => Err(crate::err!(
                E::InvalidArgument,
                "unknown KDF profile 0x{:04X}",
                profile
            )),
        }
    }

    // Fixed ASCII domain-separation labels
    pub const LABEL_KDF: &'static [u8] = b"ASTBOX-KDF-v1";
    pub const LABEL_WRAP: &'static [u8] = b"ASTBOX-WRAP-v1";
    pub const LABEL_HKDF_SALT: &'static [u8] = b"ASTBOX-HKDF-SALT-v1";
    pub const LABEL_HDRM: &'static [u8] = b"ASTBOX-HDRM-v1";
    pub const LABEL_META: &'static [u8] = b"ASTBOX-META-v1";
    pub const LABEL_DATA: &'static [u8] = b"ASTBOX-DATA-v1";
    pub const LABEL_SLOTM: &'static [u8] = b"ASTBOX-SLOTM-v1";
    pub const LABEL_FOOT: &'static [u8] = b"ASTBOX-FOOT-v1";
    pub const LABEL_HEADER_MAC: &'static [u8] = b"ASTBOX-HEADER-MAC-v1";
    pub const LABEL_SLOT_MAC: &'static [u8] = b"ASTBOX-SLOT-MAC-v1";
    pub const LABEL_METADATA: &'static [u8] = b"ASTBOX-METADATA-v1";
    pub const LABEL_FOOTER_MAC: &'static [u8] = b"ASTBOX-FOOTER-MAC-v1";

    // Metadata CBOR top-level keys
    pub const META_KEY_VERSION: u64 = 1;
    pub const META_KEY_ROOT: u64 = 2;
    pub const META_KEY_ENTRIES: u64 = 3;
    pub const META_KEY_CREATED: u64 = 4;
    pub const META_KEY_MODIFIED: u64 = 5;

    // Entry CBOR keys
    pub const ENTRY_KEY_FILE_ID: u64 = 1;
    pub const ENTRY_KEY_PARENT: u64 = 2;
    pub const ENTRY_KEY_TYPE: u64 = 3;
    pub const ENTRY_KEY_NAME: u64 = 4;
    pub const ENTRY_KEY_SIZE: u64 = 5;
    pub const ENTRY_KEY_DATA_START: u64 = 6;
    pub const ENTRY_KEY_DATA_LENGTH: u64 = 7;
    pub const ENTRY_KEY_MODIFIED: u64 = 8;
    pub const ENTRY_KEY_MODE: u64 = 9;

    pub const TYPE_DIRECTORY: u8 = 0;
    pub const TYPE_FILE: u8 = 1;

    pub const ROOT_DIRECTORY_ID: [u8; 16] = [0u8; 16];

    // TOTP
    pub const TOTP_PERIOD: i64 = 30;
    pub const TOTP_T0: i64 = 0;

    pub const MAX_DIRECTORY_DEPTH: usize = 4096;
}
