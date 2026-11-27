# 2026-11-27 Local Raw-Payload Encryption Slice

## Summary

Newly ingested raw content encrypted with AES-256-GCM before SQLite write; legacy rows encrypted on database open.

## Changes

- Newly ingested raw content is encrypted with AES-256-GCM before it is written to SQLite. Reads decrypt through the existing raw-vault API, so inspect, download, and reprocess retain their current behavior. SHA-256 continues to be computed over the original payload bytes.
- On database open, legacy raw rows are encrypted in place and marked. The migration leaves payload content and digest unchanged. A test covers encryption at rest, readback, and legacy-row migration.
- This protects only raw-ingestion payloads. Case JSON, metadata, and other database fields remain plaintext. The local vault key is not a managed key service; loss of the key makes encrypted payloads unreadable. Production key custody, rotation, backup, retention, deletion, object storage, and immutable evidence remain open.

## Verification

- `npm run typecheck`: passed.
- `npm test`: passed, 30 tests, 0 failures.
- `npm run build`: passed.
- `git diff --check`: passed.
- Verification ran locally on Windows.