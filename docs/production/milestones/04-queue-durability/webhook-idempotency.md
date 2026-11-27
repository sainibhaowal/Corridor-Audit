# 2026-11-27 Atomic Local Webhook Receipt Idempotency

## Summary

Webhook receipt lookup runs under `BEGIN IMMEDIATE` in same SQLite transaction as raw-payload storage.

## Changes

- Webhook receipt lookup now runs under `BEGIN IMMEDIATE` in the same SQLite transaction as raw-payload storage and receipt creation. Concurrent deliveries with the same workspace, provider, and event ID cannot both pass the initial lookup and create separate raw records. Matching repeats return the existing receipt; a reused event ID with different payload bytes is returned as a conflict.
- Webhook handlers persist the normalized case rows through the local durable case queue before marking a receipt queued and returning HTTP 202. This remains two SQLite transactions, not a transactional outbox. Recovery from a crash between receipt persistence and queue insertion depends on provider redelivery; a durable outbox dispatcher and production queue remain open.
- Signed webhook and email payloads that produce no supported settlement cases are retained as failed raw evidence and return HTTP 422 instead of being labeled queued. Signed malformed email JSON is retained before parsing and marked failed.

## Verification

- `npm run typecheck`: passed.
- `npm test`: 49 passed, 0 failed.
- `npm run build`: passed.
- `git diff --check`: passed.
- Verification ran locally on Windows.