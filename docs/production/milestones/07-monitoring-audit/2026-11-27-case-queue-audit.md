# 2026-11-27 Case Queue Audit Coverage

## Summary

Hash-linked events for queue claim, retry scheduling, dead-letter transition, startup recovery, and operator replay.

## Changes

- Added hash-linked events for queue claim, retry scheduling, dead-letter transition, startup recovery, and operator replay. Each event is written in the same SQLite transaction as the queue status change. Metadata includes case ID, attempt number, retry time, and a fixed reason code. It excludes raw error text and case financial content.
- A queue integration test confirms that three attempts produce claim and retry history, final verdict is recorded, dead-letter replay is auditable, and the resulting chain verifies.
- Approval request creation, rejected or failed intake, and sync start are still not logged. Existing workspace and integration setting records remain separate from the setting mutation transaction. Local SQLite integrity limitations remain unchanged.

## Verification

- `npm run typecheck`: passed.
- Integration test file: 25 passed, 0 failed.
- Full suite: 63 passed, 0 failed.
- Production build: passed.
- `git diff --check`: passed.
- Verification ran locally on Windows.