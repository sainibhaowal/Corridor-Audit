# 2026-11-27 Atomic Case, Review & Sync Audit Events

## Summary

Audit chain extended to record final case verdicts, human review decisions, and completed/failed provider syncs in same SQLite transaction.

## Changes

- Extended the audit chain to record final case verdicts, human review decisions, and completed or failed provider syncs. Approval state plus reviewer attribution and decision metadata commit with the event in one SQLite transaction. Sync run completion plus its event commit together. Case verdict state plus its event commit together.
- Audit event insertion now uses a SQLite savepoint when called inside a transaction, retaining atomicity while keeping standalone event appends serialized. Review reasons and provider error text are deliberately excluded from event metadata.
- Queue transitions, approval requests, rejected or failed intake, and sync start are still not fully covered. Existing workspace and integration setting actions append after their primary mutation, so those pairs are not atomic. The local hash chain remains rewriteable by a privileged SQLite file operator.

## Verification

- `npm run typecheck`: passed.
- `npm test`: 63 passed, 0 failed.
- `npm run build`: passed.
- `git diff --check`: passed.
- Verification ran locally on Windows.