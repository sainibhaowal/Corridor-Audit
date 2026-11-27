# 2026-11-27 Local Queue Recovery Slice

## Summary

New cases written to SQLite before scheduling; startup reloads queued/running cases with running reset to queued.

## Changes

- New cases are written to SQLite before the in-process scheduler starts them. Queue state is recorded as queued, running, completed, or failed.
- On local process startup, cases left queued or running are loaded again. Running cases are reset to queued because their in-memory agent execution was interrupted. This gives the current single-process local app restart recovery.
- Failed cases remain failed and are not retried automatically. There is no attempt counter, backoff, operator replay, dead-letter review, transactional webhook inbox/outbox, or multi-worker claim/lease. This is not a production distributed queue.
- Upload, webhook, email, hot-folder, and reprocess background failures are now caught and logged rather than becoming unhandled promise rejections. The initial acceptance response follows the local SQLite write and scheduling call.
- Added a database test for queued work and interrupted running work recovery.

## Verification

- `npm run typecheck`: passed.
- `npm test`: passed, 29 tests, 0 failures.
- `npm run build`: passed.
- `git diff --check`: passed.
- Cloud queue, independent workers, retry policy, idempotent webhook receipts, and durable approvals remain release blockers.