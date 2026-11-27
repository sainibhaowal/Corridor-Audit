# 2026-11-27 Expiring Provider OAuth Token Refresh

## Summary

OAuth credentials refreshed within 2 minutes of expiry for Wise, QuickBooks, Xero, TrueLayer with local promise deduplication.

## Changes

- Before a provider sync, OAuth credentials with an expiry within two minutes are refreshed for Wise, QuickBooks, Xero, and TrueLayer. The access token, rotated refresh token, and new expiry are encrypted and saved before provider API calls start. A missing refresh token or refresh failure makes the sync fail visibly and requires reconnection when appropriate.
- Concurrent refresh attempts in the current local process share one in-flight refresh promise. This matters for providers that invalidate the old access token immediately or rotate refresh tokens. It does not coordinate separate processes or hosts, so horizontal workers still require a durable distributed token lock.
- QuickBooks refresh uses Basic client authentication. Xero PKCE refresh uses a Basic header with the public client ID and empty secret, as documented by [Xero](https://developer.xero.com/documentation/guides/oauth2/token-types/). QuickBooks rotates refresh credentials, and Wise invalidates prior access tokens after refresh, per their [OAuth documentation](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0) and [Wise token guidance](https://docs.wise.com/guides/developer/auth-and-security/refresh-tokens).
- Mocked end-to-end QuickBooks sync coverage verifies concurrent local requests cause one token refresh, the new bearer token is used, and the rotated credentials are persisted. Xero tests verify the PKCE refresh request. No external account was contacted.

## Verification

- `npm run typecheck`: passed.
- `npm test`: passed, 39 tests, 0 failures.
- `npm run build`: passed.
- `git diff --check`: pending final validation for this milestone.