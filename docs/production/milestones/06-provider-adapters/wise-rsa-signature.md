# 2026-11-27 Wise Webhook RSA Signature Correction

## Summary

Replaced incorrect HMAC interpretation of Wise `X-Signature-SHA256` with RSA-SHA256 verification using Wise's published public key.

## Changes

- Replaced the incorrect HMAC interpretation of Wise `X-Signature-SHA256` with RSA-SHA256 verification of the exact UTF-8 raw request body using Wise's published sandbox or production public key. `WISE_WEBHOOK_ENVIRONMENT` selects an environment explicitly; `WISE_WEBHOOK_PUBLIC_KEY` supports a provider key override. Non-production defaults to the published sandbox key, production defaults to the published production key.
- The implementation is based on [Wise's event-handling guide](https://docs.wise.com/guides/developer/webhooks/event-handling) and its [official verification example](https://github.com/transferwise/digital-signatures-examples/blob/main/verify-webhook-signature/verify-signature.js). Wise webhook requests do not sign a timestamp header, so the adapter retains event-ID or exact-payload deduplication and does not claim cryptographic freshness.

## Verification

- The published sandbox test vector verifies, and a one-byte body change fails.
- No Wise account or external webhook was contacted.
- `npm run typecheck`: passed.
- `npm test`: 49 passed, 0 failed.
- `npm run build`: passed.
- `git diff --check`: passed.
- Verification ran locally on Windows.