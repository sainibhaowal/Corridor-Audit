# 2026-11-27 Local API Cross-Site Mutation Guard

## Summary

API authorization helper checks `Origin` and Fetch Metadata before local-auth bypass; cross-origin mutations rejected with 403.

## Changes

- The shared API authorization helper now checks mutation request `Origin` and Fetch Metadata before the local-auth bypass. Cross-origin and `Sec-Fetch-Site: cross-site` browser requests are rejected with `403`; same-origin local calls and requests without browser-origin metadata continue to work.
- Signed webhook routes remain separate external entry points and keep their signature and event-receipt checks.

## Verification

- Verification in the local Windows environment: `npm run typecheck`, `npm test` (73 passed, 0 failed), and `npm run build` passed.
- This guard does not replace authentication, authorization, or host validation.