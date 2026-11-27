# 2026-11-27 Bounded Lookup for Linked Accounting Invoices

## Summary

QB/Xero request missing invoice IDs referenced by payments in batches of 40, max 20 batches per sync.

## Changes

- QuickBooks and Xero now request missing invoice IDs referenced by fetched payment records, in batches of up to 40 and a maximum of 20 batches per sync. Returned source pages are retained with the sync's encrypted raw evidence and mapped through the existing accounting-payment path.
- Links still unresolved after the bounded lookup remain unmapped and produce a warning in recent sync activity. Sync status stays successful when provider fetching succeeded; the warning describes a mapping gap, not a transport failure. No bank settlement is inferred.

## Verification

- Verified mocked lookups for both providers, unresolved-link warning behavior, raw response retention, and mapped payment applications.
- `npm test` passed (79 tests).
- `npm run typecheck` passed.
- `npm run build` passed.
- Live provider credentials and account conformance were not used.