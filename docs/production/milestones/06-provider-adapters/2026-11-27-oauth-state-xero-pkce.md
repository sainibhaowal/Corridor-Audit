# 2026-11-27 Durable Provider OAuth State & Xero PKCE

## Summary

OAuth state persisted in SQLite with one-use consume; Xero PKCE S256 with verifier encryption.

## Changes

- OAuth state is persisted in SQLite with provider, workspace, expiry, and a one-use consume operation. Xero's PKCE verifier is encrypted with the local vault before storage. Consumption is a single conditional delete, preventing two callbacks from using the same state concurrently.
- Xero authorization now sends an S256 code challenge, and token exchange sends the persisted verifier without requiring a client secret. This follows [Xero's PKCE flow](https://developer.xero.com/documentation/guides/oauth2/pkce-flow/). Other provider OAuth flows still use the existing confidential-client path and do not yet add PKCE.

## Verification

- Tests verify restart recovery, expiration, one-use state, verifier encryption/readback, the S256 challenge, and the exchanged Xero verifier.
- `npm run typecheck`: passed.
- `npm test`: passed, 38 tests, 0 failures.
- `git diff --check`: passed.
- Verification ran locally on Windows; provider requests are mocked; no real OAuth account was connected.