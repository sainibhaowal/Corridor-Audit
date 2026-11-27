# Phase 0 Baseline Findings

*Historical record — current behavior and remaining gaps are maintained in [`01-current-state.md`](../01-current-state.md) and the dated implementation entries.*

## Baseline Summary

- The application is local-only today. It uses a single fixed workspace ID, local SQLite, process-local agent runtime and queue, a process-local periodic sync timer, and local filesystem hot-folder watching. AWS managed services remain the recommended eventual hosting target in [`02-target-architecture.md`](02-target-architecture.md); no cloud deployment is configured or authorized by the current local-only work.
- The initial baseline exposed three data concerns that have since been addressed in code: invoice-only inputs could be represented with an equal-value comparison wire, QuickBooks and Xero created matching placeholder wires, and provider responses were not consistently retained. Current limitations include incomplete provider-specific webhook and email schemas, limited payment and bank matching, and incomplete sync cursor coverage.
- The workspace threshold and tax fields persist but are not consumed by audit policy. Team role labels are not authorization. Webhook signature enforcement defaults to disabled.
- Existing product UI and workflow must remain. Production work may add authentication, evidence states, and controls while retaining the existing workbench layout and feature areas.
- Production cloud target is not configured. The provisional recommendation is AWS managed services. User has asked to keep the current working environment local for now.

---

## Related Milestones

- [2026-11-27 Local Milestone](../milestones/01-evidence-validation/2026-11-27-local-milestone.md) — First evidence/validation work
- [2026-11-27 Identity Milestone](../milestones/02-identity-auth/2026-11-27-identity-milestone.md) — First identity/auth work