// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
//! ASTBOX v1.0 error codes and exception type
//! (port of astbox/errors.py; ASTBOX-v1.0-04-Lifecycle-Security.txt §40-50)

namespace Astbox;

/// <summary>Canonical UINT16 error codes (E_*).</summary>
public static class E
{
    // General (0x0000-0x00FF)
    public const ushort Ok = 0x0000;
    public const ushort InvalidArgument = 0x0001;
    public const ushort InvalidState = 0x0002;
    public const ushort NotInitialized = 0x0003;
    public const ushort AlreadyExists = 0x0004;
    public const ushort NotFound = 0x0005;
    public const ushort OperationCancelled = 0x0006;

    // Format and parsing (0x0100-0x01FF)
    public const ushort InvalidMagic = 0x0100;
    public const ushort UnsupportedVersion = 0x0101;
    public const ushort InvalidHeader = 0x0102;
    public const ushort InvalidFooter = 0x0103;
    public const ushort InvalidLength = 0x0104;
    public const ushort InvalidOffset = 0x0105;
    public const ushort IntegerOverflow = 0x0106;
    public const ushort InvalidCbor = 0x0107;
    public const ushort NonCanonicalCbor = 0x0108;
    public const ushort DuplicateCborKey = 0x0109;
    public const ushort UnknownField = 0x010A;
    public const ushort ReservedField = 0x010B;
    public const ushort InvalidEntry = 0x010C;
    public const ushort InvalidDirectoryTree = 0x010D;
    public const ushort InvalidFileName = 0x010E;
    public const ushort InvalidDataRecord = 0x010F;

    // Cryptographic (0x0200-0x02FF)
    public const ushort CryptoFailure = 0x0200;
    public const ushort AeadFailure = 0x0201;
    public const ushort MacFailure = 0x0202;
    public const ushort KdfFailure = 0x0203;
    public const ushort KeyDerivationFailure = 0x0204;
    public const ushort KeyWrapFailure = 0x0205;
    public const ushort NonceFailure = 0x0206;

    // Authentication and credentials (0x0300-0x03FF)
    public const ushort AuthenticationFailed = 0x0300;
    public const ushort InvalidTotp = 0x0301;
    public const ushort NoValidCredential = 0x0302;
    public const ushort CredentialNotFound = 0x0303;
    public const ushort LastCredential = 0x0304;
    public const ushort UnsupportedCredential = 0x0305;
    public const ushort InvalidTotpDigits = 0x0306;
    public const ushort InvalidTotpPeriod = 0x0307;

    // Integrity (0x0400-0x04FF)
    public const ushort IntegrityFailure = 0x0400;
    public const ushort HeaderMacFailure = 0x0401;
    public const ushort FooterMacFailure = 0x0402;
    public const ushort MetadataDigestFailure = 0x0403;
    public const ushort DataDigestFailure = 0x0404;
    public const ushort MetadataAeadFailure = 0x0405;
    public const ushort DataAeadFailure = 0x0406;
    public const ushort GenerationMismatch = 0x0407;
    public const ushort ContainerLengthMismatch = 0x0408;

    // Storage and I/O (0x0500-0x05FF)
    public const ushort Io = 0x0500;
    public const ushort Read = 0x0501;
    public const ushort Write = 0x0502;
    public const ushort Flush = 0x0503;
    public const ushort Sync = 0x0504;
    public const ushort AtomicReplace = 0x0505;
    public const ushort TempFile = 0x0506;
    public const ushort StorageFull = 0x0507;

    // Resource (0x0600-0x06FF)
    public const ushort ResourceLimit = 0x0600;
    public const ushort MetadataTooLarge = 0x0601;
    public const ushort FileTooLarge = 0x0602;
    public const ushort TooManyEntries = 0x0603;
    public const ushort DirectoryDepth = 0x0604;
    public const ushort MemoryLimit = 0x0605;
    public const ushort KdfResourceLimit = 0x0606;

    // State and transaction (0x0700-0x07FF)
    public const ushort TransactionFailed = 0x0700;
    public const ushort TransactionAborted = 0x0701;
    public const ushort CommitFailed = 0x0702;
    public const ushort RollbackFailed = 0x0703;
    public const ushort StaleGeneration = 0x0704;
    public const ushort ConcurrentModification = 0x0705;

    /// <summary>"ASTBOX_E_XXXX" canonical name for a numeric code.</summary>
    public static string Name(ushort code)
    {
        return Names.TryGetValue(code, out var n)
            ? "ASTBOX_" + n
            : string.Create(null, $"ASTBOX_E_{code:X4}");
    }

    public static readonly IReadOnlyDictionary<ushort, string> Names =
        new Dictionary<ushort, string>
        {
            [InvalidArgument] = "E_INVALID_ARGUMENT",
            [InvalidState] = "E_INVALID_STATE",
            [NotInitialized] = "E_NOT_INITIALIZED",
            [AlreadyExists] = "E_ALREADY_EXISTS",
            [NotFound] = "E_NOT_FOUND",
            [OperationCancelled] = "E_OPERATION_CANCELLED",
            [InvalidMagic] = "E_INVALID_MAGIC",
            [UnsupportedVersion] = "E_UNSUPPORTED_VERSION",
            [InvalidHeader] = "E_INVALID_HEADER",
            [InvalidFooter] = "E_INVALID_FOOTER",
            [InvalidLength] = "E_INVALID_LENGTH",
            [InvalidOffset] = "E_INVALID_OFFSET",
            [IntegerOverflow] = "E_INTEGER_OVERFLOW",
            [InvalidCbor] = "E_INVALID_CBOR",
            [NonCanonicalCbor] = "E_NON_CANONICAL_CBOR",
            [DuplicateCborKey] = "E_DUPLICATE_CBOR_KEY",
            [UnknownField] = "E_UNKNOWN_FIELD",
            [ReservedField] = "E_RESERVED_FIELD",
            [InvalidEntry] = "E_INVALID_ENTRY",
            [InvalidDirectoryTree] = "E_INVALID_DIRECTORY_TREE",
            [InvalidFileName] = "E_INVALID_FILE_NAME",
            [InvalidDataRecord] = "E_INVALID_DATA_RECORD",
            [CryptoFailure] = "E_CRYPTO_FAILURE",
            [AeadFailure] = "E_AEAD_FAILURE",
            [MacFailure] = "E_MAC_FAILURE",
            [KdfFailure] = "E_KDF_FAILURE",
            [KeyDerivationFailure] = "E_KEY_DERIVATION_FAILURE",
            [KeyWrapFailure] = "E_KEY_WRAP_FAILURE",
            [NonceFailure] = "E_NONCE_FAILURE",
            [AuthenticationFailed] = "E_AUTHENTICATION_FAILED",
            [InvalidTotp] = "E_INVALID_TOTP",
            [NoValidCredential] = "E_NO_VALID_CREDENTIAL",
            [CredentialNotFound] = "E_CREDENTIAL_NOT_FOUND",
            [LastCredential] = "E_LAST_CREDENTIAL",
            [UnsupportedCredential] = "E_UNSUPPORTED_CREDENTIAL",
            [InvalidTotpDigits] = "E_INVALID_TOTP_DIGITS",
            [InvalidTotpPeriod] = "E_INVALID_TOTP_PERIOD",
            [IntegrityFailure] = "E_INTEGRITY_FAILURE",
            [HeaderMacFailure] = "E_HEADER_MAC_FAILURE",
            [FooterMacFailure] = "E_FOOTER_MAC_FAILURE",
            [MetadataDigestFailure] = "E_METADATA_DIGEST_FAILURE",
            [DataDigestFailure] = "E_DATA_DIGEST_FAILURE",
            [MetadataAeadFailure] = "E_METADATA_AEAD_FAILURE",
            [DataAeadFailure] = "E_DATA_AEAD_FAILURE",
            [GenerationMismatch] = "E_GENERATION_MISMATCH",
            [ContainerLengthMismatch] = "E_CONTAINER_LENGTH_MISMATCH",
            [Io] = "E_IO",
            [Read] = "E_READ",
            [Write] = "E_WRITE",
            [Flush] = "E_FLUSH",
            [Sync] = "E_SYNC",
            [AtomicReplace] = "E_ATOMIC_REPLACE",
            [TempFile] = "E_TEMP_FILE",
            [StorageFull] = "E_STORAGE_FULL",
            [ResourceLimit] = "E_RESOURCE_LIMIT",
            [MetadataTooLarge] = "E_METADATA_TOO_LARGE",
            [FileTooLarge] = "E_FILE_TOO_LARGE",
            [TooManyEntries] = "E_TOO_MANY_ENTRIES",
            [DirectoryDepth] = "E_DIRECTORY_DEPTH",
            [MemoryLimit] = "E_MEMORY_LIMIT",
            [KdfResourceLimit] = "E_KDF_RESOURCE_LIMIT",
            [TransactionFailed] = "E_TRANSACTION_FAILED",
            [TransactionAborted] = "E_TRANSACTION_ABORTED",
            [CommitFailed] = "E_COMMIT_FAILED",
            [RollbackFailed] = "E_ROLLBACK_FAILED",
            [StaleGeneration] = "E_STALE_GENERATION",
            [ConcurrentModification] = "E_CONCURRENT_MODIFICATION",
        };
}

/// <summary>ASTBOX error carrying the canonical UINT16 code and a message.</summary>
public sealed class AstboxError : Exception
{
    public ushort Code { get; }
    public new string Message { get; }
    /// <summary>Original per-attempt code when an unlock attempt is wrapped
    /// into E_AUTHENTICATION_FAILED (mirrors python reference semantics
    /// while preserving diagnosability).</summary>
    public ushort? OriginalCode { get; }

    public AstboxError(ushort code, string message,
        ushort? originalCode = null)
        : base($"ASTBOX_E_{code:X04}: {message}")
    {
        Code = code;
        Message = message;
        OriginalCode = originalCode;
    }

    public string CodeName => E.Name(Code);
}
