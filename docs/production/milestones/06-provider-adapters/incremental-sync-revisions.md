# 2026-11-27 Incremental Stripe & Xero Sync with Source Revisions

## Summary

Stripe uses `created[gte]` with 5-min overlap; Xero uses `If-Modified-Since`; changed Xero content saved as immutable revision case.

## Changes

- Stripe payout polling passes `created[gte]` from the last successful sync time with a five-minute overlap, following the [Stripe payout list parameters](https://docs.stripe.com/api/payouts/list). Xero invoice polling sends `If-Modified-Since` with the same overlap, following [Xero's invoice endpoint](https://developer.xero.com/documentation/api/accounting/invoices).
- Provider sync compares fetched normalized source data against the stored case. Unchanged rows are skipped. Changed Xero content is saved as a deterministic immutable revision case that references the earlier case, preserving its prior verdict. Repeated delivery of the same cursor window does not create duplicate revisions.
- Xero documents that some field changes do not trigger its modification filter. A periodic full reconciliation is still needed to find such changes. Wise and QuickBooks incremental cursors are not implemented. Cursor behavior and Xero revision creation are covered by mocked provider tests; no external account was contacted.

## Verification

- `npm run typecheck`: passed.
- `npm test`: passed, 46 tests, 0 failures.
- `npm run build`: passed.
- `git diff --check`: passed.
- Verification ran locally on Windows.