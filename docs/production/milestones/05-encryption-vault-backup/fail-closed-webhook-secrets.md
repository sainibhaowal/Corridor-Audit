# 2026-11-27 Fail-Closed Webhook Secret Reads

## Summary

Reading workspace settings or verifying inbound webhooks no longer replaces an undecryptable webhook secret.

## Changes

- Reading workspace settings or verifying inbound webhooks no longer replaces an undecryptable webhook secret. Both paths return a clear vault-key configuration error, preserving the stored ciphertext for recovery or an explicit operator rotation.
- This prevents a wrong or lost vault key from silently invalidating webhook clients. Key recovery and rotation are still manual and need a managed key provider and documented rotation procedure for production.

## Verification

- `npm run typecheck`: passed.
- `npm test`: passed, 44 tests, 0 failures.
- `npm run build`: passed.
- `git diff --check`: passed.
- Verification ran locally on Windows.