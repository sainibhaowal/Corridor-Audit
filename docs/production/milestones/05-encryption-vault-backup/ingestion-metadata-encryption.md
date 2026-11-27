# 2026-11-27 Local Raw Ingestion Metadata Encryption

## Summary

Raw ingestion filenames, metadata JSON, and parser error messages encrypted through AES-256-GCM vault.

## Changes

- New raw ingestion filenames, metadata JSON, and parser error messages are encrypted through the existing AES-256-GCM vault. Reads for listing, inspect, download, and reprocessing decrypt them through the existing database mapper, so the UI data shape is unchanged. Database-open migrations encrypt legacy plaintext values, including existing filenames and error details.
- Case identifiers, provider and channel labels, status fields, event IDs, and several operational columns remain visible in SQLite. This is local field encryption, not managed KMS, key rotation, immutable evidence, or a substitute for file-system access control.

## Verification

- Migration test checks ciphertext at rest, round-trip reads, and conversion of legacy plaintext fields.
- `npm run typecheck`: passed.
- `npm test`: passed, 51 tests, 0 failures.
- `npm run build`: passed.
- `git diff --check`: passed.
- Verification ran locally on Windows.