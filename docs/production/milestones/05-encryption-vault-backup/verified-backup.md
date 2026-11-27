# 2026-11-27 Verified Local SQLite Backup

## Summary

Added `npm run db:backup` using SQLite `VACUUM INTO` with integrity check and automated restore test.

## Changes

- Added `npm run db:backup`, which uses SQLite `VACUUM INTO` to create a consistent local copy, runs `PRAGMA integrity_check`, applies restrictive file permissions where supported, and refuses to overwrite an existing backup path. Failed or unverified partial copies are removed.
- Added an automated restore test that backs up committed WAL data, opens the copy with the app database layer, and reads encrypted case and raw-ingestion content. Added [local backup and restore operations](../04-local-operations.md) with key-handling and manual restore instructions.
- This is an operator-run, single-host process. There is no backup schedule, retention cleanup, off-site copy, alerting, or production recovery exercise. A restored database also requires the matching vault key.

## Verification

- `npm run typecheck`: passed.
- `npm test`: passed, 47 tests, 0 failures.
- `npm run build`: passed.
- `git diff --check`: passed.
- Verification ran locally on Windows.