# 2026-11-27 Evidence Trust & Review Follow-up

## Summary

Strengthened evidence handling — JSON uploads now use nested Zod schemas; missing payment evidence is not synthesized; finalization stops when evidence is incomplete.

## Changes

- JSON uploads now use nested Zod schemas for case, invoice, wire, charge, and source-reference fields. Missing payment evidence is not synthesized from invoice or payout values. Invoice-only files remain estimates; wire-only and same-record invoice/payment inputs remain incomplete.
- Finalization and fee-dispute drafting stop when settlement evidence is incomplete. Corridor summary excludes incomplete cases from evidence-dependent totals and labels their evidence state clearly.
- A model response cannot manufacture a human override. The runtime accepts only the exact override note recorded after a reviewer rejects the fee breakpoint. This is still process memory, so durable, attributable approvals remain outstanding.

## Verification

- `npm run typecheck`: passed on the local Windows development environment.
- `npm test`: passed, 28 tests, 0 failures.
- `npm run build`: passed.
- `npm audit --omit=dev`: 0 production dependency vulnerabilities reported.
- `git diff --check`: passed.
- The Phase 1 and Phase 2 states remain in progress. Durable approvals, provider-specific payload validation and mapping evidence, full workspace isolation, outbound team invitations, durable queueing, and operational cloud configuration remain open.