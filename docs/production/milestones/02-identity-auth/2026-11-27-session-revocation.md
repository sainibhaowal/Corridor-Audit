# 2026-11-27 Persisted Session Revocation

## Summary

Signed app sessions now include a unique `jti` plus issue and expiry times with SQLite-backed revocation.

## Changes

- Signed app sessions now include a unique `jti` plus issue and expiry times. The Cognito callback persists the session ID and subject in SQLite before issuing the cookie. The logout endpoint revokes that ID. Authenticated Node API authorization and SSE revalidation reject revoked or unregistered sessions; expired and old-format tokens fail closed.
- The Edge middleware validates JWT claims but cannot consult the SQLite session table, so a revoked cookie may still load a protected page shell until its next data API call. Production multi-instance deployment needs a shared session/revocation store. Cognito is not configured locally.

## Verification

- `npm run typecheck`: passed.
- Auth tests: 10 passed, 0 failed.
- Full suite: 68 passed, 0 failed.
- `npm run build`: passed.
- `git diff --check`: passed.
- Verification ran locally on Windows.