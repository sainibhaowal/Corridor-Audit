# 2026-11-27 Production Timestamp Requirement for Email Webhooks

## Summary

Email adapter requires timestamped Corridor HMAC format in production; local dev accepts legacy raw-body signature.

## Changes

- The email adapter now requires the same timestamped Corridor HMAC format as the inbound JSON webhook when `NODE_ENV=production`. Local development continues to accept the legacy raw-body signature for compatibility.
- Durable event-ID or exact-payload deduplication remains the replay protection for duplicate deliveries. This does not add a signed timestamp capability to Wise requests.

## Verification

- Verified the shared signature helper's timestamp enforcement in existing tests, email webhook integration tests, typecheck, and production build.
- No external webhook provider was contacted.