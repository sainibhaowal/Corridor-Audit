# 2026-11-27 Accounting Invoice Mapping Correction

## Summary

QuickBooks and Xero invoice-only cases no longer carry equal-value synthetic payment; evidence gap made explicit.

## Changes

- QuickBooks and Xero invoice-only cases no longer carry an equal-value synthetic payment. Their structurally required wire field has zero settled value, an unmatched ID, and an explicit evidence gap. The invoice amount remains preserved in the invoice record, and the case stays estimated and blocked from a complete-settlement verdict.
- Their source references now identify accounting-platform records rather than bank CSV evidence.
- Automated mocked connector coverage checks that both mappings preserve the provider response and do not imply that the invoice was paid. No provider credentials or live account data were used.

## Verification

- `npm run typecheck`: passed.
- `npm test`: passed, 35 tests, 0 failures.
- `npm run build`: passed.
- `git diff --check`: passed.
- Verification ran locally on Windows.