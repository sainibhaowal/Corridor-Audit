# 2026-11-27 Live Stream Membership Revalidation

## Summary

The live `/api/events` SSE stream now rechecks signed session and active team membership every 15 seconds.

## Changes

- The live `/api/events` stream now rechecks the signed session and current active team membership every 15 seconds. It closes the stream when the token expires, the membership is removed, or the stored role no longer matches the signed session. Disconnect cleanup removes the event subscriber and heartbeat timer.
- This does not revoke an issued token on logout, scope the stream to a different workspace, or isolate the process-global agent runtime. Those remain separate identity and tenant-isolation gaps.

## Verification

- `npm run typecheck`: passed.
- Auth tests: 10 passed, 0 failed.
- Full suite: 68 passed, 0 failed.
- `npm run build`: passed.
- `git diff --check`: passed.
- Verification ran locally on Windows.