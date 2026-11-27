# 2026-11-27 Atomic Workspace & Integration Audit Writes

## Summary

Workspace setting updates, team member add/remove, webhook secret rotation, integration connect/disconnect wrap mutation and audit append in one SQLite transaction.

## Changes

- Workspace setting updates, team member add/remove, webhook signing secret rotation, and integration connect/disconnect now wrap their mutation and audit append in one SQLite transaction. Removal events are emitted only when a row was actually removed. Disconnect events are emitted only when an integration row changed.
- Added a rollback test that forces audit validation to fail after a workspace update and confirms neither the setting nor a partial audit event remains. Existing API response shapes and UI are unchanged.
- The fixed `ws-default` route selection remains a separate multi-workspace isolation gap. Invalid webhook signature events remain outside persistent logs. Local hash-chain storage is not immutable or externally anchored.

## Verification

- Typecheck: passed.
- Full suite: 64 passed, 0 failed.
- Production build: passed.
- `git diff --check`: passed.
- Verification ran locally on Windows.