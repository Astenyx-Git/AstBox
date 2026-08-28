// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
//! IPC error envelope. Mirrors the python/C# server error contract:
//! `{"ok":false,"error":"CODE: message"}` where CODE is either a server-level
//! plain string ("E_NOT_UNLOCKED", "E_BAD_DIR", …), a core-library code name
//! ("ASTBOX_E_XXXX"), or absent (plain failures → empty code).

use astbox_core::AstboxError;

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct ApiError {
    /// Server-level code string; empty for plain failures.
    pub code: String,
    pub message: String,
}

impl ApiError {
    pub fn plain(message: impl Into<String>) -> Self {
        Self { code: String::new(), message: message.into() }
    }

    pub fn api(code: &str, message: impl Into<String>) -> Self {
        Self { code: code.to_string(), message: message.into() }
    }
}

impl From<AstboxError> for ApiError {
    fn from(e: AstboxError) -> Self {
        Self { code: e.code_name(), message: e.message }
    }
}
