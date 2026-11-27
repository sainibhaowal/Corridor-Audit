# 2026-11-27 Webhook In-Progress Duplicate Retry

## Summary

Signed JSON and email webhook routes return HTTP 503 with `Retry-After` when identical receipt is still owned by active processor.

## Changes

- Signed JSON and email webhook routes now return HTTP 503 with `Retry-After` when an identical receipt is still owned by an active processor. They no longer acknowledge an event as accepted while the first delivery may still be parsing or before its case acceptance transaction commits. A provider retry can reclaim the event after a failed attempt or expired processing lease.
- Route-level tests hold each receipt under an active lease and verify the response is retryable, while existing tests continue to verify that completed queued duplicates return HTTP 200 and first accepted deliveries return HTTP 202.

## Verification

- Focused integration suite passed (42 tests). These checks exercise the local SQLite receipt behavior; provider retry policy, external delivery behavior, and cloud queue processing remain unverified.