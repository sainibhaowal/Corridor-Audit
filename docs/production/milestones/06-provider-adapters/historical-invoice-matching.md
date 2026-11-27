# 2026-11-27 Historical Local Invoice Matching for Payment Updates

## Summary

Sync worker supplies previously persisted QB/Xero invoice cases to connector mapper for incremental payment updates.

## Changes

- The sync worker supplies previously persisted QuickBooks and Xero invoice cases to the connector mapper. Incremental payment records can now update the corresponding local invoice case even when the provider omits that unchanged invoice from the current invoice query. Changed accounting payment details are emitted as immutable case revisions through the existing sync revision path.
- This does not backfill invoice records that were never fetched by this installation. Unmatched payment records remain available in the encrypted raw provider response and no completed settlement is inferred.

## Verification

- Verified by a mocked Xero two-sync scenario where the first run stores the invoice and the second returns only its payment. The second run creates a revision with the payment application, keeps the structural wire at zero, and retains `EVIDENCE_INCOMPLETE`.
- Full local test suite and typecheck passed.
- No provider account was contacted.