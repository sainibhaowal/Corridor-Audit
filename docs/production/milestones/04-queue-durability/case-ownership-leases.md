# 2026-11-27 Local SQLite Case Ownership Leases

## Summary

Case acquisition uses conditional SQLite update with 60-second lease and 20-second renewal.

## Changes

- Case acquisition is a single conditional SQLite update. Two local processes sharing the same database cannot both claim a case while its lease is live. Lease renewals are conditional on the current worker ID, and a stale worker cannot complete the case after another worker has reclaimed it.
- The local poller offers queued work and expired running leases. A claim expires after 60 seconds unless renewed every 20 seconds. Cases at the attempt limit are moved to dead letter after their lease expires. Startup no longer resets every running row, which could have stolen work from another live process.
- This is a local single-host coordination improvement, not a distributed production queue. It depends on processes sharing one SQLite file and does not provide multi-host semantics, an independent worker deployment, an outbox, or durable agent execution state.

## Verification

- `npm run typecheck`: passed.
- `npm test`: passed, 41 tests, 0 failures, including exclusive claims, lease expiry recovery, retry and dead-letter behavior.
- `npm run build`: passed.
- `git diff --check`: passed.
- Verification ran locally on Windows; provider accounts were not contacted.