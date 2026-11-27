# 2026-11-27 JSON Intake Validation Follow-up

## Summary

Added Zod validation for supported JSON case arrays and single-case/webhook objects with strict financial field validation.

## Changes

- Added Zod validation for supported JSON case arrays and single-case/webhook objects, including safe integer amounts, ISO currency codes and dates, supported wire formats, fee lists, invoice fields, source references, and payload bounds. Invalid financial amounts and incomplete fee fields are rejected or marked `EVIDENCE_INCOMPLETE`; they are not silently treated as zero.
- A wire-only webhook and an MT103 whose instructed amount is reused as its invoice expectation both remain incomplete. Existing signed webhook examples were updated to supply the required wire format and charge lists.

## Verification

- `npm run typecheck`: passed.
- `npm test`: passed, 27 tests, 0 failures.
- `npm run build`: passed.
- `git diff --check`: passed.
- No live provider calls were made.
- Remaining Phase 1 work is provider-specific webhook schema validation, email-adapter schema validation, complete provider mapping tests, source reconciliation, and upload file-signature scanning.