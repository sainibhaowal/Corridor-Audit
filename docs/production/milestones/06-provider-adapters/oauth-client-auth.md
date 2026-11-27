# 2026-11-27 Provider OAuth Client Authentication

## Summary

QuickBooks and Wise authorization-code exchanges authenticate confidential client with HTTP Basic.

## Changes

- QuickBooks and Wise authorization-code exchanges now authenticate the confidential client with HTTP Basic and keep client credentials out of the form body. This matches the provider token request guidance: [Intuit OAuth 2.0](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0) and [Wise OAuth 2.0](https://docs.wise.com/guides/developer/auth-and-security/oauth-2-setup).
- Provider-specific OAuth differences remain explicit. QuickBooks and Wise are still configured as confidential clients; no PKCE parameters were added because the reviewed provider authorization instructions document state and client credentials but do not document PKCE for these flows. Xero and TrueLayer retain their existing PKCE handling.
- Mocked tests assert the Basic authorization header and that the QuickBooks and Wise request bodies contain no client ID or secret.

## Verification

- Focused integration suite passed (42 tests).
- `npm run typecheck` passed.
- No external provider account was contacted.
- The current app and database remain local; this does not establish live provider conformance or production deployment readiness.