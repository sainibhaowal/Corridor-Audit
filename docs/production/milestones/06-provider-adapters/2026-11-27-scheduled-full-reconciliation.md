# 2026-11-27 Scheduled Full Provider Reconciliation

## Summary

Stripe, Wise, QuickBooks, Xero run full provider fetch when no prior full-sync timestamp or interval elapsed.

## Changes

- Stripe, Wise, QuickBooks, and Xero now run a full provider fetch when they have no prior full-sync timestamp or their configured full-reconciliation interval has elapsed. The local default interval is 168 hours and the accepted range is 24 to 720 hours. Successful full runs persist their timestamp in SQLite; raw sync evidence records whether the run was full or incremental. A page-limit failure records its attempt time. When a prior successful cursor exists, the sync warns and continues incrementally, then suppresses another full scan until the configured interval elapses. An oversized first-ever full sync fails visibly and makes no provider request during the cooldown because no safe incremental cursor exists.
- Existing databases receive an additive `last_full_synced_at` column. A legacy integration with no value is forced through a full fetch on its next sync. Subsequent runs return to their incremental cursor. Existing connector pagination remains capped at 100 pages, so a provider history larger than that bound is not claimed as fully reconciled.

## Verification

- Migration and end-to-end Wise full-then-incremental tests passed.
- `npm test` passed (82 tests).
- `npm run typecheck` passed.
- `npm run build` passed.
- Provider accounts were not contacted.