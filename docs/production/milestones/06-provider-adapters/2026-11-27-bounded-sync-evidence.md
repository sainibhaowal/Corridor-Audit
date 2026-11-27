# 2026-11-27 Bounded Provider Sync Records & Evidence

## Summary

Provider syncs capped at 5,000 mapped cases; native resources at 10,000 records; response pages at 10 MiB; combined raw evidence at 50 MiB.

## Changes

- Stripe, Wise, QuickBooks, Xero, and generic JSON polling now reject provider syncs above 5,000 mapped cases. Native paginated resources are capped at 10,000 fetched records each, each response page at 10 MiB, and combined raw provider evidence at 50 MiB. Generic endpoints retain their original JSON response in the raw vault on successful mapping.
- A limit breach stops the sync without queuing partial cases or updating the successful sync cursor. The worker stores the bounded response evidence as an encrypted failed raw-ingestion record with resource, fetched-record count, truncation state, and zero queued cases. Oversized generic endpoint responses retain a capped response prefix in this evidence. A failed full reconciliation records its attempt timestamp to avoid repeatedly rescanning the same oversized history. Existing 100-page limit behavior and incremental fallback remain separate.
- Generic endpoint development mode now accepts explicit IPv4 and IPv6 loopback addresses consistently with URL validation. Production still rejects loopback and private addresses.

## Verification

- Verification on the local Windows environment: `npm test` passed (91 tests), including oversized Stripe evidence retention, zero case queueing, unchanged successful cursor, and generic endpoint prefix capture.
- `npm run typecheck`, `npm run build`, and `git diff --check` passed.
- Provider accounts were not contacted.