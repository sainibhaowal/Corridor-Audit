# 2026-11-27 Signed Email Payload Validation

## Summary

The inbound email adapter now validates its JSON envelope and attachment structure before scanning or parsing.

## Changes

- The inbound email adapter now validates its JSON envelope, supported field types, attachment object shape, a maximum of 50 attachments, and bounded string sizes before scanning or parsing. Provider-specific extra fields are allowed so the generic adapter can retain vendor metadata without trusting known financial fields by cast.
- A malformed signed JSON body or invalid signed envelope is durably retained in the encrypted raw-ingestion vault, marked failed, and answered with `422`. Invalid signatures remain rejected before payload storage. This is envelope validation only; it does not certify provider-specific payload semantics or financial truth.

## Verification

- `npm run typecheck`: passed.
- Integration test file: 26 passed, 0 failed.
- Full suite: 68 passed, 0 failed.
- `npm run build`: passed.
- `git diff --check`: passed.
- Verification ran locally on Windows.