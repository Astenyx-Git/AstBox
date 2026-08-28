// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
//! ASTBOX v1.0 error codes and error type
//! (port of Astbox.Core/Errors.cs; ASTBOX-v1.0-04-Lifecycle-Security §40-50).

/// Canonical UINT16 error codes (E_*).
pub struct E;

#[allow(non_upper_case_globals)]
impl E {
    // General (0x0000-0x00FF)
    pub const Ok: u16 = 0x0000;
    pub const InvalidArgument: u16 = 0x0001;
    pub const InvalidState: u16 = 0x0002;
    pub const NotInitialized: u16 = 0x0003;
    pub const AlreadyExists: u16 = 0x0004;
    pub const NotFound: u16 = 0x0005;
    pub const OperationCancelled: u16 = 0x0006;

    // Format and parsing (0x0100-0x01FF)
    pub const InvalidMagic: u16 = 0x0100;
    pub const UnsupportedVersion: u16 = 0x0101;
    pub const InvalidHeader: u16 = 0x0102;
    pub const InvalidFooter: u16 = 0x0103;
    pub const InvalidLength: u16 = 0x0104;
    pub const InvalidOffset: u16 = 0x0105;
    pub const IntegerOverflow: u16 = 0x0106;
    pub const InvalidCbor: u16 = 0x0107;
    pub const NonCanonicalCbor: u16 = 0x0108;
    pub const DuplicateCborKey: u16 = 0x0109;
    pub const UnknownField: u16 = 0x010A;
    pub const ReservedField: u16 = 0x010B;
    pub const InvalidEntry: u16 = 0x010C;
    pub const InvalidDirectoryTree: u16 = 0x010D;
    pub const InvalidFileName: u16 = 0x010E;
    pub const InvalidDataRecord: u16 = 0x010F;

    // Cryptographic (0x0200-0x02FF)
    pub const CryptoFailure: u16 = 0x0200;
    pub const AeadFailure: u16 = 0x0201;
    pub const MacFailure: u16 = 0x0202;
    pub const KdfFailure: u16 = 0x0203;
    pub const KeyDerivationFailure: u16 = 0x0204;
    pub const KeyWrapFailure: u16 = 0x0205;
    pub const NonceFailure: u16 = 0x0206;

    // Authentication and credentials (0x0300-0x03FF)
    pub const AuthenticationFailed: u16 = 0x0300;
    pub const InvalidTotp: u16 = 0x0301;
    pub const NoValidCredential: u16 = 0x0302;
    pub const CredentialNotFound: u16 = 0x0303;
    pub const LastCredential: u16 = 0x0304;
    pub const UnsupportedCredential: u16 = 0x0305;
    pub const InvalidTotpDigits: u16 = 0x0306;
    pub const InvalidTotpPeriod: u16 = 0x0307;

    // Integrity (0x0400-0x04FF)
    pub const IntegrityFailure: u16 = 0x0400;
    pub const HeaderMacFailure: u16 = 0x0401;
    pub const FooterMacFailure: u16 = 0x0402;
    pub const MetadataDigestFailure: u16 = 0x0403;
    pub const DataDigestFailure: u16 = 0x0404;
    pub const MetadataAeadFailure: u16 = 0x0405;
    pub const DataAeadFailure: u16 = 0x0406;
    pub const GenerationMismatch: u16 = 0x0407;
    pub const ContainerLengthMismatch: u16 = 0x0408;

    // Storage and I/O (0x0500-0x05FF)
    pub const Io: u16 = 0x0500;
    pub const Read: u16 = 0x0501;
    pub const Write: u16 = 0x0502;
    pub const Flush: u16 = 0x0503;
    pub const Sync: u16 = 0x0504;
    pub const AtomicReplace: u16 = 0x0505;
    pub const TempFile: u16 = 0x0506;
    pub const StorageFull: u16 = 0x0507;

    // Resource (0x0600-0x06FF)
    pub const ResourceLimit: u16 = 0x0600;
    pub const MetadataTooLarge: u16 = 0x0601;
    pub const FileTooLarge: u16 = 0x0602;
    pub const TooManyEntries: u16 = 0x0603;
    pub const DirectoryDepth: u16 = 0x0604;
    pub const MemoryLimit: u16 = 0x0605;
    pub const KdfResourceLimit: u16 = 0x0606;

    // State and transaction (0x0700-0x07FF)
    pub const TransactionFailed: u16 = 0x0700;
    pub const TransactionAborted: u16 = 0x0701;
    pub const CommitFailed: u16 = 0x0702;
    pub const RollbackFailed: u16 = 0x0703;
    pub const StaleGeneration: u16 = 0x0704;
    pub const ConcurrentModification: u16 = 0x0705;
}

/// Canonical name map (port of E.Names): returns "ASTBOX_E_XXXX".
pub fn code_name(code: u16) -> String {
    let name: Option<&str> = match code {
        E::InvalidArgument => Some("E_INVALID_ARGUMENT"),
        E::InvalidState => Some("E_INVALID_STATE"),
        E::NotInitialized => Some("E_NOT_INITIALIZED"),
        E::AlreadyExists => Some("E_ALREADY_EXISTS"),
        E::NotFound => Some("E_NOT_FOUND"),
        E::OperationCancelled => Some("E_OPERATION_CANCELLED"),
        E::InvalidMagic => Some("E_INVALID_MAGIC"),
        E::UnsupportedVersion => Some("E_UNSUPPORTED_VERSION"),
        E::InvalidHeader => Some("E_INVALID_HEADER"),
        E::InvalidFooter => Some("E_INVALID_FOOTER"),
        E::InvalidLength => Some("E_INVALID_LENGTH"),
        E::InvalidOffset => Some("E_INVALID_OFFSET"),
        E::IntegerOverflow => Some("E_INTEGER_OVERFLOW"),
        E::InvalidCbor => Some("E_INVALID_CBOR"),
        E::NonCanonicalCbor => Some("E_NON_CANONICAL_CBOR"),
        E::DuplicateCborKey => Some("E_DUPLICATE_CBOR_KEY"),
        E::UnknownField => Some("E_UNKNOWN_FIELD"),
        E::ReservedField => Some("E_RESERVED_FIELD"),
        E::InvalidEntry => Some("E_INVALID_ENTRY"),
        E::InvalidDirectoryTree => Some("E_INVALID_DIRECTORY_TREE"),
        E::InvalidFileName => Some("E_INVALID_FILE_NAME"),
        E::InvalidDataRecord => Some("E_INVALID_DATA_RECORD"),
        E::CryptoFailure => Some("E_CRYPTO_FAILURE"),
        E::AeadFailure => Some("E_AEAD_FAILURE"),
        E::MacFailure => Some("E_MAC_FAILURE"),
        E::KdfFailure => Some("E_KDF_FAILURE"),
        E::KeyDerivationFailure => Some("E_KEY_DERIVATION_FAILURE"),
        E::KeyWrapFailure => Some("E_KEY_WRAP_FAILURE"),
        E::NonceFailure => Some("E_NONCE_FAILURE"),
        E::AuthenticationFailed => Some("E_AUTHENTICATION_FAILED"),
        E::InvalidTotp => Some("E_INVALID_TOTP"),
        E::NoValidCredential => Some("E_NO_VALID_CREDENTIAL"),
        E::CredentialNotFound => Some("E_CREDENTIAL_NOT_FOUND"),
        E::LastCredential => Some("E_LAST_CREDENTIAL"),
        E::UnsupportedCredential => Some("E_UNSUPPORTED_CREDENTIAL"),
        E::InvalidTotpDigits => Some("E_INVALID_TOTP_DIGITS"),
        E::InvalidTotpPeriod => Some("E_INVALID_TOTP_PERIOD"),
        E::IntegrityFailure => Some("E_INTEGRITY_FAILURE"),
        E::HeaderMacFailure => Some("E_HEADER_MAC_FAILURE"),
        E::FooterMacFailure => Some("E_FOOTER_MAC_FAILURE"),
        E::MetadataDigestFailure => Some("E_METADATA_DIGEST_FAILURE"),
        E::DataDigestFailure => Some("E_DATA_DIGEST_FAILURE"),
        E::MetadataAeadFailure => Some("E_METADATA_AEAD_FAILURE"),
        E::DataAeadFailure => Some("E_DATA_AEAD_FAILURE"),
        E::GenerationMismatch => Some("E_GENERATION_MISMATCH"),
        E::ContainerLengthMismatch => Some("E_CONTAINER_LENGTH_MISMATCH"),
        E::Io => Some("E_IO"),
        E::Read => Some("E_READ"),
        E::Write => Some("E_WRITE"),
        E::Flush => Some("E_FLUSH"),
        E::Sync => Some("E_SYNC"),
        E::AtomicReplace => Some("E_ATOMIC_REPLACE"),
        E::TempFile => Some("E_TEMP_FILE"),
        E::StorageFull => Some("E_STORAGE_FULL"),
        E::ResourceLimit => Some("E_RESOURCE_LIMIT"),
        E::MetadataTooLarge => Some("E_METADATA_TOO_LARGE"),
        E::FileTooLarge => Some("E_FILE_TOO_LARGE"),
        E::TooManyEntries => Some("E_TOO_MANY_ENTRIES"),
        E::DirectoryDepth => Some("E_DIRECTORY_DEPTH"),
        E::MemoryLimit => Some("E_MEMORY_LIMIT"),
        E::KdfResourceLimit => Some("E_KDF_RESOURCE_LIMIT"),
        E::TransactionFailed => Some("E_TRANSACTION_FAILED"),
        E::TransactionAborted => Some("E_TRANSACTION_ABORTED"),
        E::CommitFailed => Some("E_COMMIT_FAILED"),
        E::RollbackFailed => Some("E_ROLLBACK_FAILED"),
        E::StaleGeneration => Some("E_STALE_GENERATION"),
        E::ConcurrentModification => Some("E_CONCURRENT_MODIFICATION"),
        _ => None,
    };
    match name {
        Some(n) => format!("ASTBOX_{}", n),
        None => format!("ASTBOX_E_{:04X}", code),
    }
}

/// ASTBOX error carrying the canonical UINT16 code and a message
/// (port of AstboxError, including OriginalCode for unlock wrapping).
#[derive(Debug, Clone)]
pub struct AstboxError {
    pub code: u16,
    pub message: String,
    /// Original per-attempt code when an unlock attempt is wrapped into
    /// E_AUTHENTICATION_FAILED (mirrors python reference semantics while
    /// preserving diagnosability).
    pub original_code: Option<u16>,
}

impl AstboxError {
    pub fn new(code: u16, message: impl Into<String>) -> Self {
        AstboxError { code, message: message.into(), original_code: None }
    }

    pub fn with_original(code: u16, message: impl Into<String>, original_code: u16) -> Self {
        AstboxError {
            code,
            message: message.into(),
            original_code: Some(original_code),
        }
    }

    pub fn code_name(&self) -> String {
        code_name(self.code)
    }
}

impl std::fmt::Display for AstboxError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Mirrors the C# Exception message: "ASTBOX_E_XXXX: message"
        write!(f, "ASTBOX_E_{:04X}: {}", self.code, self.message)
    }
}

impl std::error::Error for AstboxError {}

/// Shorthand constructor used throughout the port.
#[macro_export]
macro_rules! err {
    ($code:expr, $($arg:tt)*) => {
        $crate::errors::AstboxError::new($code, format!($($arg)*))
    };
}
