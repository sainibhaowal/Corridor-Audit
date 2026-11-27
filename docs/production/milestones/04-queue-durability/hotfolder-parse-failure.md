# 2026-11-27 Hot-Folder Parse Failure Evidence

## Summary

Hot-folder content saved but failing normalization now records `failed` with error text in encrypted parse-error field.

## Changes

- If local hot-folder content has been saved and normalization then fails, the ingestion now records `failed` with the error text in the encrypted parse-error field. Failures during scanning or before raw-record creation remain visible in the local runtime log only.

## Verification

- `npm run typecheck`: passed.
- `npm test` passed (77 tests).
- `npm run build` passed.
- Verification ran locally on Windows.