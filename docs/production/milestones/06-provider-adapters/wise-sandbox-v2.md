# 2026-11-27 Wise Environment & Sandbox V2 Endpoints

## Summary

Wise selects matching auth/token/API hosts through `WISE_API_ENVIRONMENT`; credentials separated for sandbox/production.

## Changes

- Wise now selects matching authorization, token, and API hosts through `WISE_API_ENVIRONMENT`. Local development defaults to `sandbox`; a production process must explicitly set `sandbox` or `production`. Credentials are separated as `WISE_SANDBOX_CLIENT_ID` and `WISE_SANDBOX_CLIENT_SECRET`, or `WISE_PRODUCTION_CLIENT_ID` and `WISE_PRODUCTION_CLIENT_SECRET`. `WISE_API_VERSION` defaults to `2026Q4` and accepts version strings such as `2026Q4`.
- The sandbox uses Wise Sandbox V2 hosts and versioned API paths. This replaces Sandbox V1 hosts which Wise scheduled for deprecation on June 30, 2026. See Wise's [Sandbox V2 migration guide](https://docs.wise.com/guides/developer/environments/sandbox-v2-migration), [environment endpoints](https://docs.wise.com/guides/developer/environments), and [authorization-code setup](https://docs.wise.com/guides/developer/auth-and-security/personal-token-migration).

## Verification

- Tests verify sandbox and production URL selection, credentials readiness, and that the Wise transfer connector uses the versioned sandbox API host.
- No Wise credentials were used and no live calls were made.
- Production partner access still requires Wise-issued production credentials, registered redirect URI, and the provider's mTLS onboarding; mTLS is not implemented in this local app.