# 2026-11-27 Authenticated Manual Upload Maker/Checker Control

## Summary

Manual upload persists each case with its submitter identity; self-approval is rejected in authenticated mode.

## Changes

- Manual upload persists each case and its verified session subject in the same SQLite transaction as the successful raw-ingestion parse outcome. Case updates preserve the first submitter identity.
- In authenticated mode, approval of a manually submitted case is rejected when the reviewer subject matches its submitter. The check and decision update run in one immediate SQLite transaction. Reject and stop remain available to the submitter. Local single-operator mode is unaffected, and webhook or provider initiated cases remain system initiated.
- The existing review card displays the API error when a review action is denied. No broader UI layout changes were made.
- Existing local databases receive the nullable `submitted_by_sub` column through an additive migration.

## Verification

- `npm run typecheck`: passed.
- `npm test` passed (76 tests), covering rejection of submitter self-approval, approval by an independent reviewer, preservation of submitter identity on case updates, and additive migration of an existing SQLite database.
- `npm run build` passed.
- Verification ran locally on Windows.