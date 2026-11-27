# 2026-11-27 Normalized Financial Record Encryption

## Summary

Case payloads, audit verdicts, and pending approval JSON now use AES-256-GCM vault before SQLite writes.

## Changes

- Case payloads, audit verdicts, and pending approval JSON now use the local AES-256-GCM vault before SQLite writes. Read paths decrypt the payloads for existing runtime, case, and review behavior. New encrypted-state columns allow additive migration of existing databases.
- On open, legacy plaintext case, verdict, and pending approval payloads are encrypted in place. Tests inspect raw SQLite values to confirm the vendor and settlement details are not visible, then verify decrypted readback and migration from plaintext fixtures.
- This does not encrypt every SQLite column. Case IDs, titles, sync errors, selected ingestion metadata, event identifiers, and operational fields remain plaintext. The local vault key is not managed key custody and this does not replace database-level encryption, access control, or backup protection.

## Verification

- `npm run typecheck`: passed.
- `npm test`: passed, 41 tests, 0 failures.
- `npm run build`: passed.
- `git diff --check`: passed.
- Verification is local on Windows.