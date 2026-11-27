# Implementation Status and Release Gates

This is the live delivery record for production-readiness engineering. A row is complete only when its code path, documentation, operational configuration, and evidence are all present. Do not mark work complete because a screen or API route exists.

## Delivery sequence

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Baseline and code-backed production record | Complete |
| 1 | Canonical evidence completeness, provider mapping correctness, upload validation, and accurate states | In progress |
| 2 | Identity, workspace isolation, role authorization, team invitations, and protected API/SSE access | In progress |
| 3 | Executable versioned tax and threshold policies, durable approvals, and accurate summaries | Versioned tax and review policies plus durable approval records implemented locally; approval UI and production workflow controls remain |
| 4 | Durable database, queue, outbox, idempotency, retries, dead-letter handling, and independent workers | Local SQLite queue recovery and webhook deduplication slices complete; production queue not started |
| 5 | Raw evidence object storage, encryption/key lifecycle, retention, backup, restore, and deletion | Local SQLite raw-payload encryption complete; managed storage and lifecycle not started |
| 6 | Provider adapters with pagination, cursors, token refresh/revocation, event security, and reconciliation | Local raw-response retention and currency-unit fixes for Stripe, Wise, QuickBooks, and Xero; connector completeness remains in progress |
| 7 | Monitoring, audit logs, deployment configuration, threat review, and operational runbooks | Not started |
| 8 | Provider and security validation evidence, controlled pilot release gates | Not started |

## Phase 0 findings

- The application is local-only today. It uses a single fixed workspace ID, local SQLite, process-local agent runtime and queue, a process-local periodic sync timer, and local filesystem hot-folder watching.
- Three data concerns are known blockers: invoice-only inputs can be represented with a generated equal-value wire; QuickBooks and Xero create matching placeholder wires; integrations do not preserve the original provider response consistently.
- The workspace threshold and tax fields persist but are not consumed by audit policy. Team role labels are not authorization. Webhook signature enforcement defaults to disabled.
- Existing product UI and workflow must remain. Production work may add authentication, evidence states, and controls while retaining the existing workbench layout and feature areas.
- Production cloud target is not configured. The provisional recommendation is AWS managed services. User has asked to keep the current working environment local for now.

## Required release evidence

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

## External configuration still required

No code-only change can activate production identity or managed services without operator configuration. Before deployment, provide the chosen identity issuer and client, PostgreSQL connection, object-storage bucket, queue, key-management service, provider OAuth client registrations and secrets, public webhook URLs and secrets, email delivery service for team invitations, monitoring sink, backup policy, retention policy, and production network/domain configuration.

## Verification record

Update this section per milestone with the exact command, result, environment, and date. Do not claim tests, provider certification, security review, or recovery exercises that were not actually performed.

### 2026-11-27 local milestone

- Invoice-only JSON, invoice CSV, plain-text, and PDF normalized cases carry `settlementEvidence: "estimated"`; generated comparison dates come from the invoice due date or current date instead of a fixed example date.
- Settlement evidence is `observed` only when an invoice and supplied wire carry distinct source references and sender and receiver charge fields are present. Wire-only JSON, MT103/camt.053-derived invoice expectations, payout-only Stripe/Wise, and same-row payout CSV inputs are `incomplete` with a user-visible evidence gap. QuickBooks and Xero invoice-only mappings are `estimated`.
- Estimated records finalize as `EVIDENCE_INCOMPLETE`, cannot generate a fee-dispute draft, and cannot be promoted to a clean result by the model's `CLOSE_CLEAN` action. Human overrides remain recorded, while missing payment evidence stays visible.
- The saved variance threshold now controls Risk Only gate pauses and verdict classification. Above-threshold differences are `VARIANCE_DETECTED`; nonzero differences within tolerance remain recorded as `VARIANCE_WITHIN_THRESHOLD`. The setting is interpreted in minor units of the case settlement currency.
- Corridor summary wording now describes calculated flags and estimates, excludes evidence-incomplete records from FX and fee totals, and separates above-threshold cases from incomplete evidence cases.
- `npm run typecheck`: passed on the local Windows development environment.
- `npm test`: passed, 19 tests, 0 failures. Three tests cover invoice-only JSON, explicit payment evidence, and invoice CSV evidence status.
- Upload request envelopes now reject unknown fields, invalid formats, missing or simultaneous content fields, oversized requests, and base64 files above 10 MiB. Upload and webhook request bodies are read through bounded streaming readers; the upload endpoint allows a 14 MiB envelope, inbound JSON webhooks 1 MiB, and email webhooks 10 MiB.
- Remaining Phase 1 work: strict validation of nested settlement cases and all provider/webhook payloads, plus source-specific tests for live connector mappings. No external provider was contacted or certified in this milestone.
- Follow-up local verification: `npm run typecheck` passed; `npm test` passed, 20 tests, 0 failures; `git diff --check` reported no whitespace errors. These checks ran locally on Windows.

### 2026-11-27 identity milestone, local code only

- Added a Cognito hosted sign-in flow using authorization code, PKCE, state, nonce, HTTPS issuer checks, verified-email validation, and short-lived HTTP-only session cookies. The flow follows [Amazon Cognito's PKCE guidance](https://docs.aws.amazon.com/cognito/latest/developerguide/using-pkce-in-authorization-code.html).
- Protected workbench pages and APIs fail closed when production mode is active. API handlers recheck the current active team row and role, so removing or changing a member rejects their next API request. Role thresholds distinguish analyst, controller, and owner actions. Cross-origin mutation requests are rejected.
- Verified invited team emails activate on first Cognito sign-in. `CORRIDOR_BOOTSTRAP_OWNER_EMAIL` creates the initial owner after that identity is verified. The workbench shows a sign-out control when Cognito mode is built.
- Model-provided override text no longer bypasses the human review gate. Only the exact note stored after a human rejection can override the fee flag, and the note is consumed by that case's finalization.
- Webhook signature verification is mandatory in production even if the local setting is off.
- `npm run typecheck`: passed. `npm test`: passed, 26 tests, 0 failures, including session integrity, role gate, invite activation, owner bootstrap, wire-only handling, and MT103 obligation separation.
- `npm run build`: passed. `npm audit --omit=dev`: zero vulnerabilities after pinning PostCSS to a fixed compatible release through npm overrides.
- This is not an activated identity deployment. Cognito pool, hosted domain, client, callback URL, session secret, and bootstrap owner email are not configured locally. Team invitations still do not send email, OAuth connector state is still process-local, workspace data remains one fixed workspace, and an already-open SSE stream is not immediately closed when membership is removed. Phase 2 stays in progress.

### 2026-11-27 JSON intake validation follow-up

- Added Zod validation for supported JSON case arrays and single-case/webhook objects, including safe integer amounts, ISO currency codes and dates, supported wire formats, fee lists, invoice fields, source references, and payload bounds. Invalid financial amounts and incomplete fee fields are rejected or marked `EVIDENCE_INCOMPLETE`; they are not silently treated as zero.
- A wire-only webhook and an MT103 whose instructed amount is reused as its invoice expectation both remain incomplete. Existing signed webhook examples were updated to supply the required wire format and charge lists.
- `npm run typecheck`: passed. `npm test`: passed, 27 tests, 0 failures. No live provider calls were made.
- Remaining Phase 1 work is provider-specific webhook schema validation, email-adapter schema validation, complete provider mapping tests, source reconciliation, and upload file-signature scanning.

### 2026-11-27 evidence trust and review follow-up

- JSON uploads now use nested Zod schemas for case, invoice, wire, charge, and source-reference fields. Missing payment evidence is not synthesized from invoice or payout values. Invoice-only files remain estimates; wire-only and same-record invoice/payment inputs remain incomplete.
- Finalization and fee-dispute drafting stop when settlement evidence is incomplete. Corridor summary excludes incomplete cases from evidence-dependent totals and labels their evidence state clearly.
- A model response cannot manufacture a human override. The runtime accepts only the exact override note recorded after a reviewer rejects the fee breakpoint. This is still process memory, so durable, attributable approvals remain outstanding.
- `npm run typecheck`: passed on the local Windows development environment.
- `npm test`: passed, 28 tests, 0 failures.
- `npm run build`: passed; Next.js production build completed.
- `npm audit --omit=dev`: 0 production dependency vulnerabilities reported.
- `git diff --check`: passed. No external providers were contacted. These checks do not establish production readiness or provider certification.
- The Phase 1 and Phase 2 states remain in progress. Durable approvals, provider-specific payload validation and mapping evidence, full workspace isolation, outbound team invitations, durable queueing, and operational cloud configuration remain open.

### 2026-11-27 local queue recovery slice

- New cases are written to SQLite before the in-process scheduler starts them. Queue state is recorded as queued, running, completed, or failed.
- On local process startup, cases left queued or running are loaded again. Running cases are reset to queued because their in-memory agent execution was interrupted. This gives the current single-process local app restart recovery.
- Failed cases remain failed and are not retried automatically. There is no attempt counter, backoff, operator replay, dead-letter review, transactional webhook inbox/outbox, or multi-worker claim/lease. This is not a production distributed queue.
- Upload, webhook, email, hot-folder, and reprocess background failures are now caught and logged rather than becoming unhandled promise rejections. The initial acceptance response follows the local SQLite write and scheduling call.
- Added a database test for queued work and interrupted running work recovery.
- `npm run typecheck`: passed. `npm test`: passed, 29 tests, 0 failures. `npm run build`: passed. `git diff --check`: passed. These ran locally on Windows.
- Cloud queue, independent workers, retry policy, idempotent webhook receipts, and durable approvals remain release blockers.

### 2026-11-27 local webhook inbox deduplication

- Signed inbound and email webhook deliveries now derive an event key from the provider event ID in the signed JSON body. If no event ID exists, the inbox keys the exact raw body by SHA-256.
- SQLite records the event receipt and encrypted raw ingestion in one transaction. Repeated delivery of a queued event returns the existing ingestion without creating another raw record. Reusing an event ID with a different body returns HTTP 409. Queue failures mark the receipt failed, and a repeated delivery can resume it.
- The local orchestrator now coalesces concurrent case work and returns an existing completed verdict for the same case ID, reducing duplicate audits when a receipt is retried.
- Event-ID idempotency does not replace provider timestamp/replay controls. Wise and Corridor still lack signed timestamp windows. Events without IDs only deduplicate byte-for-byte, and the queue remains local, single-process recovery.
- `npm run typecheck`: passed. `npm test`: passed, 33 tests, 0 failures, including duplicate delivery and changed-payload conflict checks. `npm run build`: passed. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 versioned review threshold follow-up

- Variance threshold updates now create review-policy snapshots. Risk gate decisions and final verdicts read the current snapshot, and the final verdict records its policy ID and threshold in source references.
- The threshold is explicitly interpreted as minor units of the case settlement currency. API writes reject negative, non-integer, or unsafe threshold values.
- This preserves the current UI field while making its unit explicit and adding calculation provenance. Per-currency threshold tables and historical policy replay remain future release work.
- `npm run typecheck`: passed. `npm test`: passed, 33 tests, 0 failures. `npm run build`: passed. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 durable review decision records

- Review breakpoints are now stored in SQLite with the exact tool-call digest, question, proof, requested action, status, decision, reason, and reviewer identity. Decisions accept only approve, reject, or stop.
- If the process restarts, a replayed identical tool call can consume its stored decision instead of losing the review. A rejected decision's exact reason is the only note accepted as a human override. A reviewer can record a pending decision even if no in-memory waiter is connected; the endpoint reports that it was stored and will resume on replay.
- Authenticated decisions use the verified session subject, email, and role. Local terminal decisions are labeled as local operator actions.
- This does not make agent execution durable by itself. There is no worker lease, approval expiry, full approval-history UI, maker/checker policy, or multi-instance consistency. Those remain release gates.
- `npm run typecheck`: passed. `npm test`: passed, 34 tests, 0 failures. `npm run build`: passed. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 provider raw-response and currency-unit follow-up

- Stripe, Wise, QuickBooks, and Xero fetch results now retain the original response body. The sync worker stores that response in the encrypted raw vault, separately from normalized audit cases, including syncs that return no new cases.
- Wise, QuickBooks, and Xero major-unit amounts now convert through currency-specific minor-unit rules. This avoids multiplying every currency by 100, which is wrong for currencies such as JPY and KWD. Stripe amounts remain in the provider's minor units.
- Automated connector tests mock provider HTTP responses, check original response preservation, and verify Wise JPY and KWD amount conversion. No live provider calls or OAuth refresh were performed.
- Pagination, incremental sync cursors, provider token refresh/revocation, exact payment-to-invoice matching, reconciliation fixtures, and a real provider acceptance test remain open.
- `npm run typecheck`: passed. `npm test`: passed, 35 tests, 0 failures. `npm run build`: passed. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 accounting invoice mapping correction

- QuickBooks and Xero invoice-only cases no longer carry an equal-value synthetic payment. Their structurally required wire field has zero settled value, an unmatched ID, and an explicit evidence gap. The invoice amount remains preserved in the invoice record, and the case stays estimated and blocked from a complete-settlement verdict.
- Their source references now identify accounting-platform records rather than bank CSV evidence.
- Automated mocked connector coverage checks that both mappings preserve the provider response and do not imply that the invoice was paid. No provider credentials or live account data were used.
- `npm run typecheck`: passed. `npm test`: passed, 35 tests, 0 failures. `npm run build`: passed. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 local raw-payload encryption slice

- Newly ingested raw content is encrypted with AES-256-GCM before it is written to SQLite. Reads decrypt through the existing raw-vault API, so inspect, download, and reprocess retain their current behavior. SHA-256 continues to be computed over the original payload bytes.
- On database open, legacy raw rows are encrypted in place and marked. The migration leaves payload content and digest unchanged. A test covers encryption at rest, readback, and legacy-row migration.
- This protects only raw-ingestion payloads. Case JSON, metadata, and other database fields remain plaintext. The local vault key is not a managed key service; loss of the key makes encrypted payloads unreadable. Production key custody, rotation, backup, retention, deletion, object storage, and immutable evidence remain open.
- `npm run typecheck`: passed. `npm test`: passed, 30 tests, 0 failures. `npm run build`: passed. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 workspace tax-profile wiring

- Tax country and withholding basis points are stored as versioned workspace tax-policy snapshots. Non-tax workspace edits do not create tax versions.
- An explicit invoice rate, including zero, is used as supplied. If an invoice omits the rate, the terms assessment and deterministic withholding calculation use the current workspace profile. The assessment records the policy version, country, rate, and whether the value came from the invoice or workspace profile. The terms evidence explains this as a configured assumption, not a legal tax determination.
- CSV tax-rate values are validated as integer basis points in the 0 to 10,000 range. Missing CSV values remain missing so the workspace default can apply. Workspace API validates country codes and rate bounds.
- Tax profile basis points are not a jurisdictional tax engine. Effective-date policy authoring, maker/checker approval, historical replay under old policy, and legal validation are still required for production.
- `npm run typecheck`: passed. `npm test`: passed, 33 tests, 0 failures. `npm run build`: passed. `git diff --check`: passed. Verification ran locally on Windows.
