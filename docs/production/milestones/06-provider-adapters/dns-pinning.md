# 2026-11-27 Generic Provider Endpoint DNS Pinning

## Summary

Generic provider sync resolves host at request time, rejects private/reserved answers, connects to validated IP.

## Changes

- Generic provider sync now resolves the configured host at request time, rejects private or reserved answers, and connects to the same validated IP while retaining the original HTTP host and TLS server name. It does not follow redirects and caps response bodies at 10 MiB. The timeout remains 20 seconds.
- This closes the DNS rebinding gap between validation and socket connection for generic JSON sync. Production still requires the exact hostname allowlist and should use network egress controls as defense in depth. Endpoint creation continues to validate DNS before saving as an early configuration check.

## Verification

- Focused integration suite passed (43 tests), including a local server assertion that the socket connects to the validated loopback address, rejection of a private DNS answer, rejection of an oversized response, and enforcement of the total request timeout.
- Full `npm test` passed (87 tests).
- `npm run build` passed.
- `npm run typecheck` passed serially after the build.
- No external endpoint was contacted.