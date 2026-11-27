# 2026-11-27 QuickBooks Incremental Invoice Query

## Summary

QuickBooks invoice sync filters by `MetaData.LastUpdatedTime` with 5-min overlap and bounded pagination.

## Changes

- QuickBooks invoice sync now filters by `MetaData.LastUpdatedTime` from the previous successful sync, with the existing five-minute overlap, and orders results by the same field before bounded pagination. This uses the query syntax described in [Intuit's QuickBooks query documentation](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries).
- Mocked query tests verify the timestamp filter, overlap, ordering, and pagination. No live QuickBooks company was queried, so provider conformance remains unverified. Wise still has offset-only transfer listing and no incremental cursor; payment and bank record matching remains open.

## Verification

- `npm run typecheck`: passed.
- Integration test file: 27 passed, 0 failed.
- Full suite: 69 passed, 0 failed.
- `npm run build`: passed.
- `git diff --check`: passed.
- Verification ran locally on Windows.