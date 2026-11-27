# 2026-11-27 Versioned Review Threshold Follow-up

## Summary

Variance threshold updates now create review-policy snapshots with explicit minor-unit interpretation.

## Changes

- Variance threshold updates now create review-policy snapshots. Risk gate decisions and final verdicts read the current snapshot, and the final verdict records its policy ID and threshold in source references.
- The threshold is explicitly interpreted as minor units of the case settlement currency. API writes reject negative, non-integer, or unsafe threshold values.
- This preserves the current UI field while making its unit explicit and adding calculation provenance. Per-currency threshold tables and historical policy replay remain future release work.

## Verification

- `npm run typecheck`: passed.
- `npm test`: passed, 33 tests, 0 failures.
- `npm run build`: passed.
- `git diff --check`: passed.
- Verification ran locally on Windows.