# 2026-11-27 Leased Webhook Receipt Processing

## Summary

Signed JSON and email webhook receipts use durable SQLite processing claims with 60-second lease.

## Changes

- Signed JSON and email webhook receipts now use durable SQLite processing claims with a 60-second lease, renewed every 15 seconds while parsing and queueing. Concurrent duplicate deliveries return accepted without processing the payload a second time. A later delivery can reclaim a receipt after a worker crash and lease expiry; a stale owner cannot finalize work after another request takes ownership.
- Failed receipts remain retryable, queued receipts remain idempotent, and existing SQLite databases receive the lease columns additively. The queue remains local SQLite and the claim lease is not a distributed cloud queue or a replacement for an outbox.

## Verification

- Integration suite passed 40 tests, including migration, claim contention, stale-owner fencing, failed retry, receipt atomicity, both webhook API flows, and email parsing.
- Full `npm test` passed (83 tests).
- `npm run typecheck` passed.
- `npm run build` passed.
- `git diff --check` passed.
- No external provider was contacted.