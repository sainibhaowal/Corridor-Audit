# 2026-11-27 Bounded Provider Pagination

## Summary

Stripe, Wise, QuickBooks, Xero connectors stop after 100 pages with original response retention.

## Changes

- Stripe payout sync follows `has_more` using the last payout ID as `starting_after`. Wise transfer sync uses `limit` and `offset`. QuickBooks invoice queries use `STARTPOSITION` and `MAXRESULTS`; Xero invoice sync uses `page` and `pageSize`.
- Each connector stops after at most 100 pages and fails visibly if another page is indicated beyond the safety bound. The original response bodies for every fetched page are retained together in the raw ingestion payload. Wise profile discovery response is also retained when the connector discovers the profile automatically.
- Mocked tests exercise multi-page results for all four connectors and assert the provider cursor or page parameter. Existing tests verify currency conversion and that invoice-only accounting records do not imply payment evidence. No live provider calls were made.
- This is bounded page traversal only. It does not yet persist incremental sync cursors, handle changing records consistently across pages, coordinate refreshes across app instances, revoke OAuth grants, retry rate limits, or reconcile invoices with independent bank settlement records.

## Verification

- `npm run typecheck`: passed.
- `npm test`: passed, 36 tests, 0 failures.
- `git diff --check`: passed.
- Verification ran locally on Windows.