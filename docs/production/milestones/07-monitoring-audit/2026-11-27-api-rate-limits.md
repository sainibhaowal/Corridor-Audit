# 2026-11-27 Local Authenticated API Rate Limits

## Summary

Protected API requests use SQLite-backed fixed-window counters keyed by workspace, identity subject, and request class.

## Changes

- Protected API requests now use SQLite-backed fixed-window counters keyed by a SHA-256 digest of the current workspace, authenticated identity subject, and request class. Limits are 120 reads, 30 mutations, 10 uploads, and 6 provider sync requests per minute per authenticated identity. Rejected requests return HTTP 429 with `Retry-After`; database failures return HTTP 503 rather than bypassing the control.
- SQLite upsert with `RETURNING` counts each request atomically across local processes that share the database file. Old buckets are pruned opportunistically. The counters do not store email addresses or raw identity subjects.
- This is a local baseline, not a complete production abuse-control layer. Unauthenticated inbound webhooks and auth-disabled local development routes do not pass through this limiter. Production needs edge/WAF limits for webhook and network traffic, a shared distributed limiter for horizontally scaled hosts, provider-specific quotas, alerting, and load testing. The fixed workspace context also remains `ws-default` pending tenant-context implementation.

## Verification

- Deterministic SQLite test covers limits, separate actor buckets, reset windows, and remaining quota.
- `npm run typecheck`: passed.
- `npm test`: 48 passed, 0 failed.
- `npm run build`: passed.
- `git diff --check`: passed.
- Verification ran locally on Windows.