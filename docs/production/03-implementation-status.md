# Implementation Status and Release Gates

This is the live delivery record for production-readiness engineering. A row is complete only when its code path, documentation, operational configuration, and evidence are all present. Do not mark work complete because a screen or API route exists.

## Delivery Sequence

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Baseline and code-backed production record | **Complete** |
| 1 | Canonical evidence completeness, provider mapping correctness, upload validation, and accurate states | **In Progress** |
| 2 | Identity, workspace isolation, role authorization, team invitations, and protected API/SSE access | **In Progress** |
| 3 | Executable versioned tax and threshold policies, durable approvals, and accurate summaries | **In Progress** |
| 4 | Durable database, queue, outbox, idempotency, retries, dead-letter handling, and independent workers | **In Progress** |
| 5 | Raw evidence object storage, encryption/key lifecycle, retention, backup, restore, and deletion | **In Progress** |
| 6 | Provider adapters with pagination, cursors, token refresh/revocation, event security, and reconciliation | **In Progress** |
| 7 | Monitoring, audit logs, deployment configuration, threat review, and operational runbooks | **In Progress** |
| 8 | Provider and security validation evidence, controlled pilot release gates | **Not Started** |

---

## Quick Navigation

### Phase 0 — Baseline
- [Phase 0 Baseline Findings](./milestones/00-baseline-findings.md)

### Phase 1 — Evidence & Validation
- [2026-11-27 Local Milestone](./milestones/01-evidence-validation/2026-11-27-local-milestone.md)
- [JSON Intake Validation Follow-up](./milestones/01-evidence-validation/2026-11-27-json-intake-validation.md)
- [Evidence Trust & Review Follow-up](./milestones/01-evidence-validation/2026-11-27-evidence-trust-review.md)

### Phase 2 — Identity & Authorization
- [2026-11-27 Identity Milestone](./milestones/02-identity-auth/2026-11-27-identity-milestone.md)
- [Cognito Subject Membership Binding](./milestones/02-identity-auth/2026-11-27-cognito-subject-binding.md)
- [Team Role Validation & Owner Retention](./milestones/02-identity-auth/2026-11-27-team-role-validation.md)
- [Signed Email Payload Validation](./milestones/02-identity-auth/2026-11-27-signed-email-validation.md)
- [Live Stream Membership Revalidation](./milestones/02-identity-auth/2026-11-27-stream-membership-revalidation.md)
- [Persisted Session Revocation](./milestones/02-identity-auth/2026-11-27-session-revocation.md)
- [Workspace-Bound Sessions & Partial API Scoping](./milestones/02-identity-auth/2026-11-27-workspace-bound-sessions.md)
- [Team Invitation Record Validation](./milestones/02-identity-auth/2026-11-27-team-invitation-validation.md)

### Phase 3 — Tax, Thresholds & Approvals
- [Versioned Review Threshold Follow-up](./milestones/03-tax-thresholds-approvals/2026-11-27-versioned-threshold.md)
- [Workspace Tax Profile Wiring](./milestones/03-tax-thresholds-approvals/2026-11-27-tax-profile-wiring.md)
- [Durable Review Decision Records](./milestones/03-tax-thresholds-approvals/2026-11-27-durable-review-decisions.md)
- [Review Approval Expiry & Version Binding](./milestones/03-tax-thresholds-approvals/2026-11-27-approval-expiry.md)
- [Authenticated Manual Upload Maker/Checker](./milestones/03-tax-thresholds-approvals/2026-11-27-maker-checker-upload.md)

### Phase 4 — Queue, Retries & Durability
- [Local Queue Recovery Slice](./milestones/04-queue-durability/2026-11-27-queue-recovery.md)
- [Durable Case Retries & Dead Letters](./milestones/04-queue-durability/2026-11-27-durable-retries.md)
- [Local SQLite Case Ownership Leases](./milestones/04-queue-durability/2026-11-27-case-ownership-leases.md)
- [Atomic Local Webhook Receipt Idempotency](./milestones/04-queue-durability/2026-11-27-webhook-idempotency.md)
- [Leased Webhook Receipt Processing](./milestones/04-queue-durability/2026-11-27-leased-webhook-processing.md)
- [Webhook In-Progress Duplicate Retry](./milestones/04-queue-durability/2026-11-27-webhook-duplicate-retry.md)
- [Durable Review Restoration & Timeout Handling](./milestones/04-queue-durability/2026-11-27-review-restoration.md)
- [Atomic Webhook Case Acceptance](./milestones/04-queue-durability/2026-11-27-atomic-webhook-acceptance.md)
- [Hot-Folder Parse Failure Evidence](./milestones/04-queue-durability/2026-11-27-hotfolder-parse-failure.md)
- [Bounded Ingestion Batch Size](./milestones/04-queue-durability/2026-11-27-bounded-ingestion-batch.md)

### Phase 5 — Encryption, Vault & Backup
- [Normalized Financial Record Encryption](./milestones/05-encryption-vault-backup/2026-11-27-financial-record-encryption.md)
- [Fail-Closed Production Vault Key](./milestones/05-encryption-vault-backup/2026-11-27-fail-closed-vault-key.md)
- [Storage Ownership Guards](./milestones/05-encryption-vault-backup/2026-11-27-storage-ownership-guards.md)
- [Fail-Closed Webhook Secret Reads](./milestones/05-encryption-vault-backup/2026-11-27-fail-closed-webhook-secrets.md)
- [Local Raw-Payload Encryption Slice](./milestones/05-encryption-vault-backup/2026-11-27-raw-payload-encryption.md)
- [Local Raw Ingestion Metadata Encryption](./milestones/05-encryption-vault-backup/2026-11-27-ingestion-metadata-encryption.md)
- [Verified Local SQLite Backup](./milestones/05-encryption-vault-backup/2026-11-27-verified-backup.md)
- [Production Vault Key Format](./milestones/05-encryption-vault-backup/2026-11-27-vault-key-format.md)

### Phase 6 — Provider Adapters & Reconciliation
- [Provider Raw Response & Currency Unit](./milestones/06-provider-adapters/2026-11-27-provider-raw-response.md)
- [Accounting Invoice Mapping Correction](./milestones/06-provider-adapters/2026-11-27-accounting-invoice-mapping.md)
- [Bounded Provider Pagination](./milestones/06-provider-adapters/2026-11-27-bounded-pagination.md)
- [Durable Provider OAuth State & Xero PKCE](./milestones/06-provider-adapters/2026-11-27-oauth-state-xero-pkce.md)
- [Expiring Provider OAuth Token Refresh](./milestones/06-provider-adapters/2026-11-27-oauth-token-refresh.md)
- [Incremental Stripe & Xero Sync with Source Revisions](./milestones/06-provider-adapters/2026-11-27-incremental-sync-revisions.md)
- [QuickBooks Incremental Invoice Query](./milestones/06-provider-adapters/2026-11-27-qb-incremental-query.md)
- [Provider Sync & Audit Status Separation](./milestones/06-provider-adapters/2026-11-27-sync-audit-separation.md)
- [Local Provider Sync Lease](./milestones/06-provider-adapters/2026-11-27-sync-lease.md)
- [Provider Request Bounds & Unconfigured Queue Behavior](./milestones/06-provider-adapters/2026-11-27-provider-bounds.md)
- [Connector Scope & Generic Endpoint Guardrails](./milestones/06-provider-adapters/2026-11-27-connector-scope-guardrails.md)
- [Production Generic Endpoint Allowlist](./milestones/06-provider-adapters/2026-11-27-generic-allowlist.md)
- [Local API Cross-Site Mutation Guard](./milestones/06-provider-adapters/2026-11-27-cross-site-mutation-guard.md)
- [Provider Timeout Cannot Be Overridden](./milestones/06-provider-adapters/2026-11-27-provider-timeout-guard.md)
- [Wise Webhook RSA Signature Correction](./milestones/06-provider-adapters/2026-11-27-wise-rsa-signature.md)
- [Wise Environment & Sandbox V2 Endpoints](./milestones/06-provider-adapters/2026-11-27-wise-sandbox-v2.md)
- [Wise Transfer Creation-Time Cursor](./milestones/06-provider-adapters/2026-11-27-wise-creation-cursor.md)
- [Scheduled Full Provider Reconciliation](./milestones/06-provider-adapters/2026-11-27-scheduled-full-reconciliation.md)
- [QuickBooks Scheduled Full Reconciliation](./milestones/06-provider-adapters/2026-11-27-qb-full-reconciliation.md)
- [Provider OAuth Client Authentication](./milestones/06-provider-adapters/2026-11-27-oauth-client-auth.md)
- [Bounded Provider Sync Records & Evidence](./milestones/06-provider-adapters/2026-11-27-bounded-sync-evidence.md)
- [Generic Provider Endpoint DNS Pinning](./milestones/06-provider-adapters/2026-11-27-dns-pinning.md)
- [Historical Local Invoice Matching for Payment Updates](./milestones/06-provider-adapters/2026-11-27-historical-invoice-matching.md)
- [Bounded Lookup for Linked Accounting Invoices](./milestones/06-provider-adapters/2026-11-27-bounded-invoice-lookup.md)
- [Production Timestamp Requirement for Email Webhooks](./milestones/06-provider-adapters/2026-11-27-email-webhook-timestamp.md)

### Phase 7 — Monitoring, Audit & Operations
- [Local Authenticated API Rate Limits](./milestones/07-monitoring-audit/2026-11-27-api-rate-limits.md)
- [Workspace Audit Trail](./milestones/07-monitoring-audit/2026-11-27-workspace-audit-trail.md)
- [Atomic Case, Review & Sync Audit Events](./milestones/07-monitoring-audit/2026-11-27-atomic-audit-events.md)
- [Case Queue Audit Coverage](./milestones/07-monitoring-audit/2026-11-27-case-queue-audit.md)
- [Intake, Approval Request & Sync Start Audit Coverage](./milestones/07-monitoring-audit/2026-11-27-intake-approval-sync-audit.md)
- [Atomic Workspace & Integration Audit Writes](./milestones/07-monitoring-audit/2026-11-27-atomic-workspace-integration-audit.md)
- [Public Liveness & Protected Runtime Status](./milestones/07-monitoring-audit/2026-11-27-liveness-runtime-status.md)

### UI Runtime Bug Fixes & Export Hardening
- [2026-11-27 UI Runtime Bug Fixes](./milestones/ui-bug-fixes/2026-11-27-ui-runtime-bug-fixes.md)

---

## Phase 0 Baseline Findings

See [Phase 0 Baseline Findings](./milestones/00-baseline-findings.md).

## Required Release Evidence

Before real financial records are enabled, this repository and its deployment must provide:

1. Authentication and tests or external review showing workspace isolation on every API, report, object, event stream, integration, and approval operation.
2. An authenticated acceptance flow for all four team roles, including invitation and revocation behavior.
3. Provider-specific integration evidence using redacted official fixtures for pagination, backfill, incremental sync, token expiry, refresh, revocation, schema changes, retries, and raw-response preservation.
4. Proof that invoice-only, payout-only, duplicate, stale, malformed, and mismatched inputs cannot receive a clean complete-settlement verdict without the required evidence.
5. Webhook verification, duplicate delivery, replay, out-of-order event, and worker-crash recovery evidence.
6. Durable job lifecycle evidence for restart, retry exhaustion, dead-letter review, replay, and queue backlog recovery.
7. Backup and restore evidence, key rotation and recovery procedure, retention and deletion exercise, and documented incident contacts.
8. Financial control sign-off for formulas, currencies, tax assumptions, thresholds, and report language. Legal and compliance applicability must be assessed for target jurisdictions and product role.
9. Operational alerts, service health checks, a deployment rollback procedure, data migration strategy, and an incident runbook.

---

## External Configuration Still Required

No code-only change can activate production identity or managed services without operator configuration. Before deployment, provide the chosen identity issuer and client, PostgreSQL connection, object-storage bucket, queue, key-management service, provider OAuth client registrations and secrets, public webhook URLs and secrets, email delivery service for team invitations, monitoring sink, backup policy, retention policy, and production network/domain configuration.

---

## Verification Record Index

Detailed verification records are maintained in each milestone file under `docs/production/milestones/`. Each entry includes exact commands, results, environment, and date.