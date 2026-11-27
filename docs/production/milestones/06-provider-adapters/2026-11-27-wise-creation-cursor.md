# 2026-11-27 Wise Transfer Creation-Time Cursor

## Summary

Wise incremental requests use persisted successful-sync time as `createdDateStart` with 5-min overlap.

## Changes

- The local sync worker now forces a full Stripe, Wise, or Xero fetch when no full reconciliation has been recorded or the configured interval has elapsed, then resumes incremental cursors. The interval defaults to 168 hours and accepts 24 to 720 hours. Wise incremental requests use the persisted successful-sync time as `createdDateStart`, with the existing five-minute overlap, while retaining offset pagination and original response capture. Wise documents the inclusive creation-date filter in its [transfer listing API](https://github.com/transferwise/api-docs/blob/master/source/includes/reference/_transfers.md).
- This filter discovers newly created transfers. It does not guarantee detection of later status changes to old transfers; the scheduled full reconciliation catches them only when they fall within the provider's 100-page bound.

## Verification

- Focused cursor test passed.
- `npm test` passed (79 tests).
- `npm run typecheck` passed.
- `npm run build` passed.
- No live provider account was contacted.