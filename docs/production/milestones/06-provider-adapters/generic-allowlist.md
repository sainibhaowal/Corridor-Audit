# 2026-11-27 Production Generic Endpoint Allowlist

## Summary

Generic provider URLs require exact hostname entry in `CORRIDOR_PROVIDER_ENDPOINT_HOSTS` in production.

## Changes

- Generic provider URLs now require an exact hostname entry in `CORRIDOR_PROVIDER_ENDPOINT_HOSTS` when `NODE_ENV=production`, and production requests must use standard HTTPS port 443. The check runs when saving a connection and again before each poll. Production generic endpoint connections fail closed if the allowlist is empty or the host is absent. `.env.example` documents the new setting.
- Local development continues to allow configured public HTTPS endpoints without a production allowlist. Private and reserved address checks still apply, and requests still reject redirects.
- DNS-to-socket pinning and production network egress rules remain necessary to close DNS rebinding risk.

## Verification

- Verification in the local Windows environment: `npm run typecheck`, `npm test` (72 passed, 0 failed), and `npm run build` passed.
- No provider or cloud service was contacted.