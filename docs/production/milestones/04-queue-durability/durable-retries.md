# 2026-11-27 Local Durable Case Retries & Dead Letters

## Summary

SQLite case rows now persist attempt count, next retry time, and bounded error detail with dead-letter handling.

## Changes

- SQLite case rows now persist attempt count, next retry time, and the latest bounded error detail. Existing databases receive these columns through an additive migration; existing terminal `failed` rows move to the dead-letter state for operator review.
- Eligible agent execution failures retry up to three attempts, with one second and five second backoff intervals. Verdict timeouts go directly to dead letter so a late agent run cannot overlap a retry. The app poller resumes delayed retries after restarts. Exhausted or repeatedly interrupted cases enter dead letter handling instead of being lost. A controller-only API lists dead letters and requeues one case with its attempt counter reset.
- The retry path remains local and single-process. There is no cross-process job claim/lease, independent worker executable, transactional outbox, or provider-sync retry queue. The current SQLite worker cannot be treated as a distributed production queue.
- Tests cover successful recovery after two transient failures, max-attempt dead letter creation, saved error context, replay, interrupted-running recovery, and delayed queue eligibility.

## Verification

- `npm run typecheck`: passed.
- `npm test`: passed, 40 tests, 0 failures.
- `npm run build`: passed.
- `git diff --check`: passed.
- Verification is local on Windows.