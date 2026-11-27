# 2026-11-27 Bounded Ingestion Batch Size

## Summary

Upload, JSON webhook, email attachment, CSV, MT103, ISO 20022, and JSON settlement normalization cap single ingestion at 500 settlement cases.

## Changes

- Upload, JSON webhook, email attachment, CSV, MT103, ISO 20022, and JSON settlement normalization now cap a single ingestion at 500 settlement cases. JSON input is checked before Zod materializes case records, CSV line counting stops once the cap is exceeded, and XML entry matching stops at the first excess record. A JSON case can include at most 100 candidate wires.
- Oversized imports return HTTP 413. Upload and webhook paths retain raw intake as failed evidence and queue no partial cases. Email attachment case counts are enforced across the whole message, not separately per attachment.

## Verification

- Focused parser and route tests passed (9 tests).
- Full `npm test` passed (90 tests).
- `npm run build` passed.
- `npm run typecheck` passed serially after the build.
- `git diff --check` passed.