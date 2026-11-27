# 2026-11-27 Provider Raw Response & Currency Unit Follow-up

## Summary

Stripe, Wise, QuickBooks, Xero fetch results retain original response body; Wise/QuickBooks/Xero use currency-specific minor-unit rules.

## Changes

- Stripe, Wise, QuickBooks, and Xero fetch results now retain the original response body. The sync worker stores that response in the encrypted raw vault, separately from normalized audit cases, including syncs that return no new cases.
- Wise, QuickBooks, and Xero major-unit amounts now convert through currency-specific minor-unit rules. This avoids multiplying every currency by 100, which is wrong for currencies such as JPY and KWD. Stripe amounts remain in the provider's minor units.
- Automated connector tests mock provider HTTP responses, check original response preservation, and verify Wise JPY and KWD amount conversion. No live provider calls or OAuth refresh were performed.
- Pagination, incremental sync cursors, provider token refresh/revocation, exact payment-to-invoice matching, reconciliation fixtures, and a real provider acceptance test remain open.

## Verification

- `npm run typecheck`: passed.
- `npm test`: passed, 35 tests, 0 failures.
- `npm run build`: passed.
- `git diff --check`: passed.
- Verification ran locally on Windows.