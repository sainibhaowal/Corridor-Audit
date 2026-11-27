# 2026-11-27 QuickBooks Scheduled Full Reconciliation

## Summary

QuickBooks joins full reconciliation schedule with unfiltered invoice/payment queries on full run.

## Changes

- QuickBooks joins Stripe, Wise, and Xero in the configurable 168-hour full reconciliation schedule. A full run queries invoices and payments without a modification-time filter, then subsequent runs resume the five-minute-overlap `MetaData.LastUpdatedTime` cursor. The provider's query API supports unfiltered entity queries and bounded pagination; the adapter retains its 100-page cap and page-limit fallback behavior. See [Intuit query operations](https://static.developer.intuit.com/output_html/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries.html).
- Mocked sync tests verify both accounting resources are fetched unfiltered on the scheduled full run and use the modification cursor on the next run.

## Verification

- Full `npm test` passed (84 tests).
- Focused integration tests passed (41 tests).
- `npm run typecheck` passed.
- `npm run build` passed.
- `git diff --check` passed.
- This does not establish live QuickBooks company conformance. No provider account was contacted.