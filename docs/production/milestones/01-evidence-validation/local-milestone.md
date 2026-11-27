# 2026-11-27 Local Milestone — Evidence & Validation

## Summary

Established baseline evidence handling for invoice-only, wire-only, and mixed inputs with explicit evidence states.

## Changes

- Invoice-only JSON, invoice CSV, plain-text, and PDF normalized cases carry `settlementEvidence: "estimated"`; generated comparison dates come from the invoice due date or current date instead of a fixed example date.
- Settlement evidence is `observed` only when an invoice and supplied wire carry distinct source references and sender and receiver charge fields are present. Wire-only JSON, MT103/camt.053-derived invoice expectations, payout-only Stripe/Wise, and same-row payout CSV inputs are `incomplete` with a user-visible evidence gap. QuickBooks and Xero invoice-only mappings are `estimated`.
- Estimated records finalize as `EVIDENCE_INCOMPLETE`, cannot generate a fee-dispute draft, and cannot be promoted to a clean result by the model's `CLOSE_CLEAN` action. Human overrides remain recorded, while missing payment evidence stays visible.
- The saved variance threshold now controls Risk Only gate pauses and verdict classification. Above-threshold differences are `VARIANCE_DETECTED`; nonzero differences within tolerance remain recorded as `VARIANCE_WITHIN_THRESHOLD`. The setting is interpreted in minor units of the case settlement currency.
- Corridor summary wording now describes calculated flags and estimates, excludes evidence-incomplete records from FX and fee totals, and separates above-threshold cases from incomplete evidence cases.
- Upload request envelopes now reject unknown fields, invalid formats, missing or simultaneous content fields, oversized requests, and base64 files above 10 MiB. Upload and webhook request bodies are read through bounded streaming readers; the upload endpoint allows a 14 MiB envelope, inbound JSON webhooks 1 MiB, and email webhooks 10 MiB.

## Verification

- `npm run typecheck`: passed on the local Windows development environment.
- `npm test`: passed, 19 tests, 0 failures. Three tests cover invoice-only JSON, explicit payment evidence, and invoice CSV evidence status.
- `npm run build`: passed.
- `git diff --check`: passed.
- Remaining Phase 1 work: strict validation of nested settlement cases and all provider/webhook payloads, plus source-specific tests for live connector mappings. No external provider was contacted or certified in this milestone.