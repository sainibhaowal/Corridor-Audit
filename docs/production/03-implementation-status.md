# Implementation Status and Release Gates

This is the live delivery record for production-readiness engineering. A row is complete only when its code path, documentation, operational configuration, and evidence are all present. Do not mark work complete because a screen or API route exists.

## Delivery sequence

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Baseline and code-backed production record | Complete |
| 1 | Canonical evidence completeness, provider mapping correctness, upload validation, and accurate states | In progress: request and decoded-file limits, 500-case ingestion batches, and 100 candidate wires per JSON case are enforced; provider conformance, broad source fixtures, and pilot evidence remain |
| 2 | Identity, workspace isolation, role authorization, team invitations, and protected API/SSE access | Cognito role gates implemented but not configured; storage-level case and raw-record ownership guards added; SQLite-backed session revocation on logout and 15-second SSE revalidation implemented locally; signed sessions now carry workspace IDs and membership checks use that claim. Integration list/connect/disconnect, workspace settings, audit log, raw-ingestion reads, and dead-letter listing use the authorized workspace context. Unmigrated APIs fail closed with HTTP 503 for non-default workspace sessions. Sign-in still provisions only into `ws-default`, and workspace creation/selection, email invitations, full route and runtime tenant isolation, and a shared multi-host session store remain. |
| 3 | Executable versioned tax and threshold policies, durable approvals, and accurate summaries | Versioned tax and review policies, persisted pending approvals restored into the existing UI, exact approval ID decisions, safe local replay after a dead-lettered approval, authenticated manual upload maker/checker, 24-hour approval expiry, and evidence plus policy-version binding implemented; approval cancellation, approval history, source attribution for system initiated cases, and production workflow controls remain |
| 4 | Durable database, queue, outbox, idempotency, retries, dead-letter handling, and independent workers | Local SQLite retries, atomic cross-process leases, expired-lease recovery, dead-letter listing, and controller replay implemented; transactional outbox, independent worker deployment, distributed queue, and production database remain open |
| 5 | Raw evidence object storage, encryption/key lifecycle, retention, backup, restore, and deletion | Local SQLite encryption covers raw payloads, filenames, ingestion metadata and parse errors, normalized cases, verdicts, pending approval payloads, and integration credentials. ClamAV scanning is wired for uploads, email attachments, and hot-folder files, with production fail-closed behavior. An operator-run local backup with integrity verification and a restore test is implemented. Managed storage, KMS, key rotation, scheduled/off-site backups, restore drills, retention, deletion, and an actual scanner service remain open |
| 6 | Provider adapters with pagination, cursors, token refresh/revocation, event security, and reconciliation | Bounded pagination and evidence capture, plus limits of 10,000 records per provider resource, 5,000 mapped cases per sync, 10 MiB per provider page, and 50 MiB of retained sync evidence are implemented. Limit failures retain encrypted failed evidence, queue no partial cases, and do not advance the successful cursor. Local token refresh for Wise, QuickBooks, Xero, and TrueLayer, SQLite refresh leases across processes sharing the local database, overlapping incremental cursors for Stripe payouts, Wise transfers, QuickBooks invoices and payments, and Xero invoices and payments, scheduled full reconciliation for Stripe, Wise, QuickBooks, and Xero, and Wise RSA-SHA256 webhook verification are implemented. QuickBooks and Xero payment applications attach to current, previously persisted, or bounded ID-looked-up invoice records, and remain incomplete pending independent bank evidence. Changed provider payloads create deterministic revision cases. Lookup is capped at 800 linked invoices per sync and unresolved links appear as warnings. Lower-latency Wise and Xero old-record update discovery between full runs, managed multi-host refresh coordination, provider revocation, bank statement matching, and live provider conformance remain open |
| 7 | Monitoring, audit logs, deployment configuration, threat review, and operational runbooks | In progress: authenticated API requests have SQLite-backed per-user limits in the local deployment; external edge limits, webhook limits, monitoring, and incident operations remain |
| 8 | Provider and security validation evidence, controlled pilot release gates | Not started |

## Phase 0 baseline findings

The following records the initial baseline and is historical. Current behavior and remaining gaps are maintained in [`01-current-state.md`](01-current-state.md) and the dated implementation entries below.

- The application is local-only today. It uses a single fixed workspace ID, local SQLite, process-local agent runtime and queue, a process-local periodic sync timer, and local filesystem hot-folder watching. AWS managed services remain the recommended eventual hosting target in `02-target-architecture.md`; no cloud deployment is configured or authorized by the current local-only work.
- The initial baseline exposed three data concerns that have since been addressed in code: invoice-only inputs could be represented with an equal-value comparison wire, QuickBooks and Xero created matching placeholder wires, and provider responses were not consistently retained. Current limitations include incomplete provider-specific webhook and email schemas, limited payment and bank matching, and incomplete sync cursor coverage.
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
- This is not an activated identity deployment. Cognito pool, hosted domain, client, callback URL, session secret, and bootstrap owner email are not configured locally. Team invitations still do not send email, workspace data remains one fixed workspace, and an already-open SSE stream is not immediately closed when membership is removed. Phase 2 stays in progress.

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

### 2026-11-27 local durable case retries and dead letters

- SQLite case rows now persist attempt count, next retry time, and the latest bounded error detail. Existing databases receive these columns through an additive migration; existing terminal `failed` rows move to the dead-letter state for operator review.
- Eligible agent execution failures retry up to three attempts, with one second and five second backoff intervals. Verdict timeouts go directly to dead letter so a late agent run cannot overlap a retry. The app poller resumes delayed retries after restarts. Exhausted or repeatedly interrupted cases enter dead letter handling instead of being lost. A controller-only API lists dead letters and requeues one case with its attempt counter reset.
- The retry path remains local and single-process. There is no cross-process job claim/lease, independent worker executable, transactional outbox, or provider-sync retry queue. The current SQLite worker cannot be treated as a distributed production queue.
- Tests cover successful recovery after two transient failures, max-attempt dead letter creation, saved error context, replay, interrupted-running recovery, and delayed queue eligibility.
- `npm run typecheck`: passed. `npm test`: passed, 40 tests, 0 failures. `npm run build`: passed. `git diff --check`: passed. Verification is local on Windows.

### 2026-11-27 normalized financial record encryption

- Case payloads, audit verdicts, and pending approval JSON now use the local AES-256-GCM vault before SQLite writes. Read paths decrypt the payloads for existing runtime, case, and review behavior. New encrypted-state columns allow additive migration of existing databases.
- On open, legacy plaintext case, verdict, and pending approval payloads are encrypted in place. Tests inspect raw SQLite values to confirm the vendor and settlement details are not visible, then verify decrypted readback and migration from plaintext fixtures.
- This does not encrypt every SQLite column. Case IDs, titles, sync errors, selected ingestion metadata, event identifiers, and operational fields remain plaintext. The local vault key is not managed key custody and this does not replace database-level encryption, access control, or backup protection.
- `npm run typecheck`: passed. `npm test`: passed, 41 tests, 0 failures. `npm run build`: passed. `git diff --check`: passed. Verification is local on Windows.

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

### 2026-11-27 local SQLite case ownership leases

- Case acquisition is a single conditional SQLite update. Two local processes sharing the same database cannot both claim a case while its lease is live. Lease renewals are conditional on the current worker ID, and a stale worker cannot complete the case after another worker has reclaimed it.
- The local poller offers queued work and expired running leases. A claim expires after 60 seconds unless renewed every 20 seconds. Cases at the attempt limit are moved to dead letter after their lease expires. Startup no longer resets every running row, which could have stolen work from another live process.
- This is a local single-host coordination improvement, not a distributed production queue. It depends on processes sharing one SQLite file and does not provide multi-host semantics, an independent worker deployment, an outbox, or durable agent execution state.
- `npm run typecheck`: passed. `npm test`: passed, 41 tests, 0 failures, including exclusive claims, lease expiry recovery, retry and dead-letter behavior. `npm run build`: passed. `git diff --check`: passed. Verification ran locally on Windows; provider accounts were not contacted.

### 2026-11-27 timestamped Corridor webhook signatures

- The Corridor inbound webhook accepts timestamped signatures in the form `t=<unix>,v1=<hex>`, signing `<unix>.<raw-body>` with HMAC-SHA256. Production enforces this format and a 300-second timestamp tolerance. The prior raw-body signature remains available for local development compatibility.
- Stripe already uses a five-minute timestamp tolerance. Wise's current adapter format signs the raw body without a timestamp header, so webhook event-ID deduplication and exact-body fallback remain its replay controls. The SQLite receipt is durably recorded before `202` is returned, but scheduling is still process-local and not backed by a transactional outbox.
- Tests cover current, stale, and legacy Corridor signatures. This does not constitute provider certification or validate business meaning of signed data.
- `npm run typecheck`: passed. `npm test`: passed, 41 tests, 0 failures. `npm run build`: passed. `git diff --check`: passed. Verification ran locally on Windows; no external webhook provider was contacted.

### 2026-11-27 fail-closed production vault key

- Production encryption no longer creates or reads the local development key file when `CORRIDOR_VAULT_KEY` is absent. Secret encryption and decryption fail with a configuration error until an explicit key is supplied. Local development retains the existing persistent key-file behavior.
- This guards against creating a fresh, unrelated key after a production restart. `CORRIDOR_VAULT_KEY` is still a manually supplied static key, not AWS KMS envelope encryption or automated rotation. Production deployment should provide it through a managed secret service until a KMS-backed key provider is implemented.
- `npm run typecheck`: passed. `npm test`: passed, 42 tests, 0 failures. `npm run build`: passed. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 storage ownership guards

- A case ID already owned by one workspace cannot be overwritten by `saveCase` from another workspace. Verdict writes require the case to exist in the same workspace, and conflicting verdict ownership is rejected inside a transaction.
- Raw-ingestion lookup and outcome updates now include a workspace condition. Webhook duplicate lookup uses the receipt's workspace. Tests create a second workspace and verify that case collisions fail and raw records cannot be read or updated through the default workspace.
- This is a storage-layer safeguard, not completed multi-tenant support. API routes and sign-in still select `ws-default`, so workspace identity must be derived from the authenticated session and propagated through every API, job, SSE stream, and provider callback before multiple customer workspaces can be enabled.
- `npm run typecheck`: passed. `npm test`: passed, 43 tests, 0 failures. `npm run build`: passed. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 fail-closed webhook secret reads

- Reading workspace settings or verifying inbound webhooks no longer replaces an undecryptable webhook secret. Both paths return a clear vault-key configuration error, preserving the stored ciphertext for recovery or an explicit operator rotation.
- This prevents a wrong or lost vault key from silently invalidating webhook clients. Key recovery and rotation are still manual and need a managed key provider and documented rotation procedure for production.
- `npm run typecheck`: passed. `npm test`: passed, 44 tests, 0 failures. `npm run build`: passed. `git diff --check`: passed. Verification ran locally on Windows.

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

### 2026-11-27 bounded provider pagination

- Stripe payout sync follows `has_more` using the last payout ID as `starting_after`. Wise transfer sync uses `limit` and `offset`. QuickBooks invoice queries use `STARTPOSITION` and `MAXRESULTS`; Xero invoice sync uses `page` and `pageSize`.
- Each connector stops after at most 100 pages and fails visibly if another page is indicated beyond the safety bound. The original response bodies for every fetched page are retained together in the raw ingestion payload. Wise profile discovery response is also retained when the connector discovers the profile automatically.
- Mocked tests exercise multi-page results for all four connectors and assert the provider cursor or page parameter. Existing tests verify currency conversion and that invoice-only accounting records do not imply payment evidence. No live provider calls were made.
- This is bounded page traversal only. It does not yet persist incremental sync cursors, handle changing records consistently across pages, coordinate refreshes across app instances, revoke OAuth grants, retry rate limits, or reconcile invoices with independent bank settlement records.
- `npm run typecheck`: passed. `npm test`: passed, 36 tests, 0 failures. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 durable provider OAuth state and Xero PKCE

- OAuth state is persisted in SQLite with provider, workspace, expiry, and a one-use consume operation. Xero's PKCE verifier is encrypted with the local vault before storage. Consumption is a single conditional delete, preventing two callbacks from using the same state concurrently.
- Xero authorization now sends an S256 code challenge, and token exchange sends the persisted verifier without requiring a client secret. This follows [Xero's PKCE flow](https://developer.xero.com/documentation/guides/oauth2/pkce-flow/). Other provider OAuth flows still use the existing confidential-client path and do not yet add PKCE.
- Tests verify restart recovery, expiration, one-use state, verifier encryption/readback, the S256 challenge, and the exchanged Xero verifier. Provider requests are mocked; no real OAuth account was connected.
- `npm run typecheck`: passed. `npm test`: passed, 38 tests, 0 failures. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 expiring provider OAuth token refresh

- Before a provider sync, OAuth credentials with an expiry within two minutes are refreshed for Wise, QuickBooks, Xero, and TrueLayer. The access token, rotated refresh token, and new expiry are encrypted and saved before provider API calls start. A missing refresh token or refresh failure makes the sync fail visibly and requires reconnection when appropriate.
- Concurrent refresh attempts in the current local process share one in-flight refresh promise. This matters for providers that invalidate the old access token immediately or rotate refresh tokens. It does not coordinate separate processes or hosts, so horizontal workers still require a durable distributed token lock.
- QuickBooks refresh uses Basic client authentication. Xero PKCE refresh uses a Basic header with the public client ID and empty secret, as documented by [Xero](https://developer.xero.com/documentation/guides/oauth2/token-types/). QuickBooks rotates refresh credentials, and Wise invalidates prior access tokens after refresh, per their [OAuth documentation](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0) and [Wise token guidance](https://docs.wise.com/guides/developer/auth-and-security/refresh-tokens).
- Mocked end-to-end QuickBooks sync coverage verifies concurrent local requests cause one token refresh, the new bearer token is used, and the rotated credentials are persisted. Xero tests verify the PKCE refresh request. No external account was contacted.
- `npm run typecheck`: passed. `npm test`: passed, 39 tests, 0 failures. `npm run build`: passed. `git diff --check`: pending final validation for this milestone.

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

### 2026-11-27 incremental Stripe and Xero sync with source revisions

- Stripe payout polling passes `created[gte]` from the last successful sync time with a five-minute overlap, following the [Stripe payout list parameters](https://docs.stripe.com/api/payouts/list). Xero invoice polling sends `If-Modified-Since` with the same overlap, following [Xero's invoice endpoint](https://developer.xero.com/documentation/api/accounting/invoices).
- Provider sync compares fetched normalized source data against the stored case. Unchanged rows are skipped. Changed Xero content is saved as a deterministic immutable revision case that references the earlier case, preserving its prior verdict. Repeated delivery of the same cursor window does not create duplicate revisions.
- Xero documents that some field changes do not trigger its modification filter. A periodic full reconciliation is still needed to find such changes. Wise and QuickBooks incremental cursors are not implemented. Cursor behavior and Xero revision creation are covered by mocked provider tests; no external account was contacted.
- `npm run typecheck`: passed. `npm test`: passed, 46 tests, 0 failures. `npm run build`: passed. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 verified local SQLite backup

- Added `npm run db:backup`, which uses SQLite `VACUUM INTO` to create a consistent local copy, runs `PRAGMA integrity_check`, applies restrictive file permissions where supported, and refuses to overwrite an existing backup path. Failed or unverified partial copies are removed.
- Added an automated restore test that backs up committed WAL data, opens the copy with the app database layer, and reads encrypted case and raw-ingestion content. Added [local backup and restore operations](./04-local-operations.md) with key-handling and manual restore instructions.
- This is an operator-run, single-host process. There is no backup schedule, retention cleanup, off-site copy, alerting, or production recovery exercise. A restored database also requires the matching vault key.
- `npm run typecheck`: passed. `npm test`: passed, 47 tests, 0 failures. `npm run build`: passed. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 local authenticated API rate limits

- Protected API requests now use SQLite-backed fixed-window counters keyed by a SHA-256 digest of the current workspace, authenticated identity subject, and request class. Limits are 120 reads, 30 mutations, 10 uploads, and 6 provider sync requests per minute per authenticated identity. Rejected requests return HTTP 429 with `Retry-After`; database failures return HTTP 503 rather than bypassing the control.
- SQLite upsert with `RETURNING` counts each request atomically across local processes that share the database file. Old buckets are pruned opportunistically. The counters do not store email addresses or raw identity subjects.
- This is a local baseline, not a complete production abuse-control layer. Unauthenticated inbound webhooks and auth-disabled local development routes do not pass through this limiter. Production needs edge/WAF limits for webhook and network traffic, a shared distributed limiter for horizontally scaled hosts, provider-specific quotas, alerting, and load testing. The fixed workspace context also remains `ws-default` pending tenant-context implementation.
- A deterministic SQLite test covers limits, separate actor buckets, reset windows, and remaining quota. `npm run typecheck`: passed. `npm test`: 48 passed, 0 failed. `npm run build`: passed. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 atomic local webhook receipt idempotency

- Webhook receipt lookup now runs under `BEGIN IMMEDIATE` in the same SQLite transaction as raw-payload storage and receipt creation. Concurrent deliveries with the same workspace, provider, and event ID cannot both pass the initial lookup and create separate raw records. Matching repeats return the existing receipt; a reused event ID with different payload bytes is returned as a conflict.
- Webhook handlers persist the normalized case rows through the local durable case queue before marking a receipt queued and returning HTTP 202. This remains two SQLite transactions, not a transactional outbox. Recovery from a crash between receipt persistence and queue insertion depends on provider redelivery; a durable outbox dispatcher and production queue remain open.
- Signed webhook and email payloads that produce no supported settlement cases are retained as failed raw evidence and return HTTP 422 instead of being labeled queued. Signed malformed email JSON is retained before parsing and marked failed. A deterministic integration test covers unsupported signed events, malformed email JSON, identical redelivery, conflicting payload reuse, and single raw-record retention. `npm run typecheck`: passed. `npm test`: 49 passed, 0 failed. `npm run build`: passed. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 Wise webhook RSA signature correction

- Replaced the incorrect HMAC interpretation of Wise `X-Signature-SHA256` with RSA-SHA256 verification of the exact UTF-8 raw request body using Wise's published sandbox or production public key. `WISE_WEBHOOK_ENVIRONMENT` selects an environment explicitly; `WISE_WEBHOOK_PUBLIC_KEY` supports a provider key override. Non-production defaults to the published sandbox key, production defaults to the published production key.
- The implementation is based on [Wise's event-handling guide](https://docs.wise.com/guides/developer/webhooks/event-handling) and its [official verification example](https://github.com/transferwise/digital-signatures-examples/blob/main/verify-webhook-signature/verify-signature.js). Wise webhook requests do not sign a timestamp header, so the adapter retains event-ID or exact-payload deduplication and does not claim cryptographic freshness.
- The published sandbox test vector verifies, and a one-byte body change fails. No Wise account or external webhook was contacted. `npm run typecheck`: passed. `npm test`: 49 passed, 0 failed. `npm run build`: passed. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 public liveness and protected runtime status

- Public `/api/health` now returns only `{ ok: true }` with `Cache-Control: no-store`. Provider details, queue counts, build provenance, and the local hot-folder path moved to `/api/runtime/status`, which uses the existing viewer authorization and request limits. The current UI fetches this authenticated status route without changing its layout.
- Health is a liveness probe only. It does not verify database, provider, or worker readiness, and runtime status describes this process rather than a multi-instance service.
- An end-to-end route test checks that public health omits runtime internals and that the local UI status route still returns provider/runtime data; an auth test confirms an unauthenticated request is rejected when authentication is enabled. `npm run typecheck`: passed. `npm test`: 50 passed, 0 failed. `npm run build`: passed. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 local PDF upload validation

- Binary base64 uploads are accepted only for PDFs, and a PDF declaration requires base64 file bytes. The parser verifies the PDF header and end marker, caps PDF streams at 1,000, limits cumulative decompression to 20 MiB, and no longer treats arbitrary bytes as printable invoice text. A valid PDF with no extractable text is marked failed with an OCR requirement; the raw upload remains available for inspection.
- The upload request remains limited to 14 MiB, and decoded PDF bytes remain limited to 10 MiB. These checks do not scan for malware or make PDF parsing safe for hostile files in a production environment. Add managed antivirus or content-disarm scanning before accepting real customer uploads.
- Tests cover valid text PDF extraction, invalid/truncated bytes, scanned PDFs without extractable text, and API rejection of binary base64 mislabeling. `npm run typecheck`: passed. `npm test`: 51 passed, 0 failed. `npm run build`: passed. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 local raw ingestion metadata encryption

- New raw ingestion filenames, metadata JSON, and parser error messages are encrypted through the existing AES-256-GCM vault. Reads for listing, inspect, download, and reprocessing decrypt them through the existing database mapper, so the UI data shape is unchanged. Database-open migrations encrypt legacy plaintext values, including existing filenames and error details.
- Case identifiers, provider and channel labels, status fields, event IDs, and several operational columns remain visible in SQLite. This is local field encryption, not managed KMS, key rotation, immutable evidence, or a substitute for file-system access control.
- A migration test checks ciphertext at rest, round-trip reads, and conversion of legacy plaintext fields. `npm run typecheck`: passed. `npm test`: 51 passed, 0 failed. `npm run build`: passed. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 OAuth redirect origin validation

- Integration OAuth connect and callback now use `CORRIDOR_PUBLIC_BASE_URL` when configured, rather than trusting the incoming request host. Production requires a valid HTTPS origin without path, credentials, query, or fragment. Local development without the setting is restricted to loopback HTTP.
- Added focused tests for spoofed request hosts, missing production configuration, non-HTTPS production origins, path rejection, and accepted local loopback origins. Provider console redirect URLs must match the configured public origin exactly. Production deployment is not configured here.
- `npm run typecheck`: passed. `npm test`: 53 passed, 0 failed. `npm run build`: passed. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 TrueLayer OAuth PKCE

- TrueLayer's optional PKCE flow is enabled with S256, matching its [official authorization link guidance](https://docs.truelayer.com/docs/generate-an-auth-link). The verifier is stored in the existing encrypted, one-use SQLite OAuth state record and supplied during token exchange.
- Stripe, Wise, and QuickBooks remain without PKCE because their current integration paths have not been verified to accept it. Their OAuth flow configuration and provider registration still require provider-specific validation.
- `npm run typecheck`: passed. `npm test`: 54 passed, 0 failed. `npm run build`: passed. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 local cross-process OAuth refresh leases

- Replaced the process-only refresh promise map with a per-workspace and provider SQLite lease. Competing workers sharing the local database wait for the active refresher, reread the persisted credentials, and reuse the rotated token. Expired leases can be reclaimed after a crashed worker. Token refresh HTTP calls now have a 40-second timeout under the 45-second lease.
- A two-connection test verifies exclusive ownership, explicit release, and expiry recovery. This coordinates local processes on one SQLite file. It does not provide multi-host coordination for a future managed database and cannot recover a provider token rotated remotely if the process crashes before persisting it.
- `npm run typecheck`: passed. `npm test`: 55 passed, 0 failed. `npm run build`: passed. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 configurable ClamAV file scanning

- Added ClamAV `clamd` INSTREAM scanning for upload request content, inbound email attachments, and hot-folder files. Infected uploads are rejected, scanner failures return `503` through API intake, oversized files are rejected, and production requires `CORRIDOR_CLAMD_HOST`. Local development can run without the service and records `malwareScan: not_configured` in raw-ingestion metadata.
- A local protocol test server verifies clean, infected, and scanner-error responses, plus production fail-closed behavior. No real ClamAV daemon or malware sample was used. The scanner endpoint must stay on a private network because ClamAV documents that its TCP protocol has no authentication or encryption. See [ClamAV protocol guidance](https://docs.clamav.net/manual/Usage/ClamdProtocol.html).
- `npm run typecheck`: passed. `npm test`: 59 passed, 0 failed. `npm run build`: passed. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 webhook durable enqueue acknowledgment

- `enqueueBatch` now lets synchronous database write failures escape before returning its execution promise. Both webhook routes therefore mark an event queued and return `202` only after every case row has been written to the durable queue. A failed write returns an error; retrying the same event resumes an existing receipt that was left received or failed.
- An end-to-end test injects a case-write failure, verifies the endpoint does not return `202`, restores the write, retries the identical event, and verifies the saved queue row before acknowledgment. Receipt and cases are still separate SQLite transactions, so a crash between them relies on the provider retry; there is no separate transactional outbox.
- `npm run typecheck`: passed. `npm test`: 60 passed, 0 failed. `npm run build`: passed. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 workspace audit trail

- Added a per-workspace SQLite audit table with monotonic sequence numbers and a SHA-256 hash link from each event to its predecessor. A verification method checks sequence continuity and recomputes each event hash. The bounded `GET /api/audit-log` endpoint allows workspace owners and controllers to inspect up to 500 events and view the chain verification result.
- Wired workspace setting updates, team member add/remove, webhook-secret rotation, integration connect/disconnect, and successful inbound webhook queueing. Event metadata is limited to 4 KB and current route callers record only action attributes. They do not include credentials, webhook secrets, or raw financial payloads. The log currently does not cover every case lifecycle, review decision, sync result, or failed intake.
- This detects row edits and accidental corruption. Because the chain and data share a local SQLite file, a privileged operator can rewrite both. There is no external hash anchor, immutable retention, SIEM export, or transaction coupling for every logged mutation. Treat this as an operational audit trail, not a compliance-grade ledger.
- `npm run typecheck`: passed. `npm test`: 63 passed, 0 failed. `npm run build`: passed. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 atomic case, review, and sync audit events

- Extended the audit chain to record final case verdicts, human review decisions, and completed or failed provider syncs. Approval state plus reviewer attribution and decision metadata commit with the event in one SQLite transaction. Sync run completion plus its event commit together. Case verdict state plus its event commit together.
- Audit event insertion now uses a SQLite savepoint when called inside a transaction, retaining atomicity while keeping standalone event appends serialized. Review reasons and provider error text are deliberately excluded from event metadata. Tests verify reviewer attribution, reason exclusion, sync metadata, and chain validity.
- Queue transitions, approval requests, rejected or failed intake, and sync start are still not fully covered. Existing workspace and integration setting actions append after their primary mutation, so those pairs are not atomic. The local hash chain remains rewriteable by a privileged SQLite file operator.
- `npm run typecheck`: passed. `npm test`: 63 passed, 0 failed. `npm run build`: passed. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 case queue audit coverage

- Added hash-linked events for queue claim, retry scheduling, dead-letter transition, startup recovery, and operator replay. Each event is written in the same SQLite transaction as the queue status change. Metadata includes case ID, attempt number, retry time, and a fixed reason code. It excludes raw error text and case financial content.
- A queue integration test confirms that three attempts produce claim and retry history, final verdict is recorded, dead-letter replay is auditable, and the resulting chain verifies.
- Approval request creation, rejected or failed intake, and sync start are still not logged. Existing workspace and integration setting records remain separate from the setting mutation transaction. Local SQLite integrity limitations remain unchanged.
- `npm run typecheck`: passed. Integration test file: 25 passed, 0 failed. Full suite: 63 passed, 0 failed. Production build: passed. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 intake, approval request, and sync start audit coverage

- Raw ingestion creation and parse outcome updates now append audit events in the same SQLite transaction as the raw record state. Webhook and email receipt status changes, including parse failures and successful queueing, are logged transactionally without storing payloads or error text.
- Review approval requests and provider sync starts now produce events in the same transaction as their durable rows. These complete the normal lifecycle trace from source receipt through parse status, case queue processing, review decision, verdict, provider sync, and operator replay.
- Invalid webhook signatures are rejected before durable receipt creation and remain outside the workspace event log. Workspace/integration settings changes still append separately after the primary mutation. External anchoring, export, retention locking, alerting, and immutable storage remain unconfigured.
- Typecheck: passed. Integration test file: 25 passed, 0 failed. Full test suite: 63 passed, 0 failed. Production build: passed. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 atomic workspace and integration audit writes

- Workspace setting updates, team member add/remove, webhook signing secret rotation, and integration connect/disconnect now wrap their mutation and audit append in one SQLite transaction. Removal events are emitted only when a row was actually removed. Disconnect events are emitted only when an integration row changed.
- Added a rollback test that forces audit validation to fail after a workspace update and confirms neither the setting nor a partial audit event remains. Existing API response shapes and UI are unchanged.
- The fixed `ws-default` route selection remains a separate multi-workspace isolation gap. Invalid webhook signature events remain outside persistent logs. Local hash-chain storage is not immutable or externally anchored.
- Typecheck: passed. Full suite: 64 passed, 0 failed. Production build: passed. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 stable Cognito subject membership binding

- Team members now store a Cognito `sub` separately from their verified email address. API authorization resolves the active member by subject, then checks the current stored role. First verified sign-in binds an unbound invitation. A different subject cannot claim an already-bound membership, even if it presents the same verified email. When the same subject returns with a newly verified email, the existing membership email and name are refreshed without changing its role, and that refresh is audited.
- Existing local SQLite databases receive the nullable `identity_sub` column and a per-workspace unique partial index without replacing team rows. Cognito remains an external setup requirement, and workspace routing still targets the current `ws-default` workspace.
- Typecheck: passed. Auth tests: 10 passed, 0 failed. Full suite: 67 passed, 0 failed. Production build: passed. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 team role validation and owner retention

- Workspace team invitations now accept only the four supported roles: owner, controller, analyst, and viewer. Runtime validation rejects crafted role strings even though TypeScript request types are narrower.
- Team removal now runs atomically with an active-owner count check. It refuses to remove the last active owner, returns a distinct not-found result for unknown members, and the API reports clear `409` and `404` responses. A remove request without a member ID now returns `400` instead of falling through to workspace settings updates. Existing UI response shape for successful operations is unchanged.
- Typecheck: passed. Integration test file: 26 passed, 0 failed. Full suite: 68 passed, 0 failed. Production build: passed. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 signed email payload validation

- The inbound email adapter now validates its JSON envelope, supported field types, attachment object shape, a maximum of 50 attachments, and bounded string sizes before scanning or parsing. Provider-specific extra fields are allowed so the generic adapter can retain vendor metadata without trusting known financial fields by cast.
- A malformed signed JSON body or invalid signed envelope is durably retained in the encrypted raw-ingestion vault, marked failed, and answered with `422`. Invalid signatures remain rejected before payload storage. This is envelope validation only; it does not certify provider-specific payload semantics or financial truth.
- Typecheck: passed. Integration test file: 26 passed, 0 failed. Full suite: 68 passed, 0 failed. Production build: passed. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 live stream membership revalidation

- The live `/api/events` stream now rechecks the signed session and current active team membership every 15 seconds. It closes the stream when the token expires, the membership is removed, or the stored role no longer matches the signed session. Disconnect cleanup removes the event subscriber and heartbeat timer.
- This does not revoke an issued token on logout, scope the stream to a different workspace, or isolate the process-global agent runtime. Those remain separate identity and tenant-isolation gaps.
- Typecheck: passed. Auth tests: 10 passed, 0 failed. Full suite: 68 passed, 0 failed. Production build: passed. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 persisted session revocation

- Signed app sessions now include a unique `jti` plus issue and expiry times. The Cognito callback persists the session ID and subject in SQLite before issuing the cookie. The logout endpoint revokes that ID. Authenticated Node API authorization and SSE revalidation reject revoked or unregistered sessions; expired and old-format tokens fail closed.
- The Edge middleware validates JWT claims but cannot consult the SQLite session table, so a revoked cookie may still load a protected page shell until its next data API call. Production multi-instance deployment needs a shared session/revocation store. Cognito is not configured locally.
- Typecheck: passed. Auth tests: 10 passed, 0 failed. Full suite: 68 passed, 0 failed. Production build: passed. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 QuickBooks incremental invoice query

- QuickBooks invoice sync now filters by `MetaData.LastUpdatedTime` from the previous successful sync, with the existing five-minute overlap, and orders results by the same field before bounded pagination. This uses the query syntax described in [Intuit's QuickBooks query documentation](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries).
- Mocked query tests verify the timestamp filter, overlap, ordering, and pagination. No live QuickBooks company was queried, so provider conformance remains unverified. Wise still has offset-only transfer listing and no incremental cursor; payment and bank record matching remains open.
- Typecheck: passed. Integration test file: 27 passed, 0 failed. Full suite: 69 passed, 0 failed. Production build: passed. `git diff --check`: passed. Verification ran locally on Windows.

### 2026-11-27 provider sync and audit status separation

- Sync history now persists the exact case IDs accepted by each provider fetch. The integration activity view distinguishes fetching and fetch completion from downstream case auditing.
- Audit status is derived from the durable local case queue and reports queued, running, completed, failed, partial, or unknown. Existing sync records without stored case IDs report unknown instead of implying the audit finished. A completed fetch with no new cases is labeled as having no new cases.
- The provider sync request still returns after fetch and queue acceptance; audit execution remains asynchronous. This milestone does not add a distributed queue or make the local process a production deployment.
- Verification on the local Windows environment: `npm run typecheck` passed; `node --import tsx --test tests/integrations-and-vault.test.ts` passed, 27 tests and 0 failures; `npm run build` passed; `git diff --check` passed.
- No external provider was contacted. Wise transfer sync still uses offset pagination because no verified incremental cursor was available.

### 2026-11-27 local provider sync lease

- Provider syncs now acquire a SQLite lease keyed by workspace and provider. Competing local processes wait for the current run, and the manual sync route returns HTTP 409 if the lease remains held past its wait window. Lease renewal runs during provider fetches, and writes are stopped if ownership is lost.
- When a new worker acquires a lease, any prior sync run left in `running` is marked failed as interrupted and recorded in the workspace audit trail. Scheduled polling skips a provider that is still busy and continues with other providers.
- This coordinates processes sharing the same local SQLite file only. The timer remains process-local, there is no durable scheduled retry queue, and provider calls still need consistent network timeouts before long-running production use.
- Verification on the local Windows environment: `npm run typecheck` passed; `npm test` passed, 70 tests and 0 failures; `npm run build` passed. Coverage includes two independent SQLite connections competing for the same sync lease and the existing concurrent QuickBooks sync flow.
- No external provider was contacted. No AWS, identity, or mail service was configured.

### 2026-11-27 provider request bounds and unconfigured queue behavior

- Stripe, Wise, QuickBooks, Xero, generic provider reads, and OAuth token requests now use a shared 20 second HTTP request timeout. A stalled request aborts instead of holding its sync lease indefinitely. The timeout is per request; bounded pagination can still make a complete sync take longer.
- When no LLM provider is configured, accepted cases are persisted and remain queued. The local queue worker waits rather than invoking Mozaik with missing credentials, and startup does not attempt to replay queued cases until a provider is configured. The CLI gives a configuration error before starting an audit.
- Verification on the local Windows environment: `npm run typecheck` passed; `npm test` passed, 71 tests and 0 failures; `npm run build` passed. Tests cover HTTP abort signaling and verify that unconfigured uploads remain in the durable queued state.
- No provider, LLM, AWS, or identity service was contacted or configured for this verification.
### 2026-11-27 connector scope and generic endpoint guardrails

- Integration cards now disclose whether the connection is a native provider API, generic JSON endpoint, local folder adapter, or email webhook adapter, including the actual data scope and missing payment/bank matching. The email card shows the application webhook URL and states that no mailbox is provisioned.
- Generic catalog connectors now require an endpoint URL before a connection can be saved. Remote HTTP endpoints, private or reserved IP destinations, and redirect responses are rejected before a configured bearer token can be forwarded.
- DNS is checked immediately before connection and again before polling, but the runtime does not pin DNS resolution to the outbound socket. A production deployment still needs egress firewall rules or an endpoint allowlist. No external provider was contacted and no cloud services were configured.

### 2026-11-27 production generic endpoint allowlist

- Generic provider URLs now require an exact hostname entry in `CORRIDOR_PROVIDER_ENDPOINT_HOSTS` when `NODE_ENV=production`, and production requests must use standard HTTPS port 443. The check runs when saving a connection and again before each poll. Production generic endpoint connections fail closed if the allowlist is empty or the host is absent. `.env.example` documents the new setting.
- Local development continues to allow configured public HTTPS endpoints without a production allowlist. Private and reserved address checks still apply, and requests still reject redirects.
- DNS-to-socket pinning and production network egress rules remain necessary to close DNS rebinding risk. This local verification does not contact a provider or configure an allowlist.
- Verification in the local Windows environment: `npm run typecheck`, `npm test` (72 passed, 0 failed), and `npm run build` passed. No provider or cloud service was contacted.

### 2026-11-27 local API cross-site mutation guard

- The shared API authorization helper now checks mutation request `Origin` and Fetch Metadata before the local-auth bypass. Cross-origin and `Sec-Fetch-Site: cross-site` browser requests are rejected with `403`; same-origin local calls and requests without browser-origin metadata continue to work.
- Signed webhook routes remain separate external entry points and keep their signature and event-receipt checks.
- Verification in the local Windows environment: `npm run typecheck`, `npm test` (73 passed, 0 failed), and `npm run build` passed. This guard does not replace authentication, authorization, or host validation.

### 2026-11-27 provider timeout cannot be overridden by caller signals

- `fetchProvider` now composes a caller cancellation signal with its configured request deadline. Supplying a longer-lived signal no longer bypasses the 20 second provider request bound.
- Verification in the local Windows environment: `npm run typecheck`, `npm test` (74 passed, 0 failed), and `npm run build` passed. A focused test verifies that an external 60 second signal cannot override a 5 millisecond helper deadline.

### 2026-11-27 durable review restoration and timeout handling

- Pending approval records are now listed from encrypted SQLite into the history response and live event snapshot. The existing workbench restores them after page reload or process restart and submits the displayed approval ID with a decision.
- Repeated execution of the same tool call reuses its still-pending approval row. A case's verdict timeout pauses while that case awaits a reviewer, avoiding automatic dead-lettering during a valid human pause. If an old dead-lettered case receives a durable decision outside a live process, the resolve route requeues it to apply the recorded decision.
- Approval records still have no expiry or cancellation policy, maker/checker separation, or historical review screen. The local queue remains sequential, so a pending human decision holds later case execution.
- Dead-letter replay audit events now record the attempt count before the replay resets it, so the operations trace retains the actual retry history.
- Verification in the local Windows environment: `npm run typecheck`, `npm test` (75 passed, 0 failed), and `npm run build` passed. Tests cover encrypted pending approval restoration after SQLite reopen, idempotent pending records, specific approval ID resolution, timeout pause during review, and replay attempt audit metadata.

### 2026-11-27 authenticated manual upload maker and checker control

- Manual upload persists each case and its verified session subject in the same SQLite transaction as the successful raw-ingestion parse outcome. Case updates preserve the first submitter identity.
- In authenticated mode, approval of a manually submitted case is rejected when the reviewer subject matches its submitter. The check and decision update run in one immediate SQLite transaction. Reject and stop remain available to the submitter. Local single-operator mode is unaffected, and webhook or provider initiated cases remain system initiated.
- The existing review card displays the API error when a review action is denied. No broader UI layout changes were made.
- Existing local databases receive the nullable `submitted_by_sub` column through an additive migration.
- Verification in the local Windows environment: `npm run typecheck`, `npm test` (76 passed, 0 failed), and `npm run build` passed. Tests cover rejection of submitter self-approval, approval by an independent reviewer, preservation of submitter identity on case updates, and additive migration of an existing SQLite database.

### 2026-11-27 atomic webhook case acceptance

- Inbound JSON webhooks and email adapter events now persist normalized case rows, raw-ingestion parse outcome, and receipt status `queued` in one SQLite transaction. The orchestrator starts only after commit, and its local startup recovery resumes queued cases after a process restart.
- A conflict or failed write rolls the acceptance transaction back; the existing receipt remains retryable. Initial raw receipt creation and parsing remain separate, so a crash in that window leaves a `received` event that a provider retry can safely resume.
- Raw evidence now starts with parse state `received`; only successful parsing changes it to `parsed`. The Raw Data Vault shows received records as pending instead of reporting them as parsed early.
- Verification in the local Windows environment: `npm run typecheck`, `npm test` (77 passed, 0 failed), and `npm run build` passed. Tests cover transaction rollback for case, parse, and receipt status writes plus the webhook endpoint's durable queued case response.

### 2026-11-27 hot-folder parse failure evidence

- If local hot-folder content has been saved and normalization then fails, the ingestion now records `failed` with the error text in the encrypted parse-error field. Failures during scanning or before raw-record creation remain visible in the local runtime log only.
- Verification in the local Windows environment: `npm run typecheck`, `npm test` (77 passed, 0 failed), and `npm run build` passed.

### 2026-11-27 calculated-result wording and report labels

- Updated the workspace summary, case inspector, review gate, CLI, agent instructions, and exported review-request label to describe fee and FX results as calculated flags or estimates from submitted records. The interface no longer presents them as confirmed recoveries, confirmed losses, or independent bank verification.
- Fee-clause assessments now state that a potential discrepancy or mismatch is calculated from submitted invoice and wire records and should be checked against the original contract and bank statement. Existing internal status and amount fields remain stable for compatibility.
- The downloadable text artifact remains a draft asking the bank to review the submitted records. It does not send a claim or establish that an adjustment is owed.
- Verification in the local Windows environment: `npm run typecheck`, `npm test` (77 passed, 0 failed), and `npm run build` passed. No provider or cloud service was contacted.

### 2026-11-27 local processing architecture record

- Updated the current-state flow to show encrypted raw evidence, the durable SQLite case queue, the single local worker's leases and retries, persisted human review, and verdict storage. Clarified that intake parsing runs in the request process and that audit processing returns after durable acceptance rather than after the full audit completes.
- This is a documentation correction based on the current upload, webhook, database queue, and orchestrator implementations. It does not describe a distributed worker fleet or cloud deployment.

### 2026-11-27 review draft evidence disclaimer

- Replaced the generated review-request draft's synthetic-demo-only disclaimer with wording that describes submitted records and cited ECB reference data, and asks the operator to verify source documents, recipient, and amounts before sending.
- This changes the generated draft text only. It does not send a bank request or certify a recovery.

### 2026-11-27 QuickBooks and Xero accounting payment applications

- QuickBooks sync now fetches paged `Payment` records and links line allocations to `Invoice` IDs. Xero sync now fetches paged `Payments` and links authorized payments to their `InvoiceID`. The five-minute overlapping modification cursor and original API page retention apply to both resources.
- Payment applications are retained in normalized case data and shown in the existing case inspector. The wire remains at zero, cases with ledger payment applications stay `EVIDENCE_INCOMPLETE`, and the UI states that accounting ledger records do not independently confirm bank settlement. QuickBooks multi-invoice lines and currency mismatches are not allocated. Xero non-authorized or malformed amounts are not allocated.
- Incremental runs now attach payment records to an invoice included in the current provider response or to its previously persisted local invoice case. A link to an invoice never fetched locally remains in the encrypted raw response and is not mapped into a case. Provider backfill and conformance with connected test accounts remain pending.
- Verified with mocked official response shapes, pagination and cursor tests, `npm run typecheck`, `npm test`, and `npm run build`. No live QuickBooks or Xero account was connected.

### 2026-11-27 historical local invoice matching for payment updates

- The sync worker supplies previously persisted QuickBooks and Xero invoice cases to the connector mapper. Incremental payment records can now update the corresponding local invoice case even when the provider omits that unchanged invoice from the current invoice query. Changed accounting payment details are emitted as immutable case revisions through the existing sync revision path.
- This does not backfill invoice records that were never fetched by this installation. Unmatched payment records remain available in the encrypted raw provider response and no completed settlement is inferred.
- Verified by a mocked Xero two-sync scenario where the first run stores the invoice and the second returns only its payment. The second run creates a revision with the payment application, keeps the structural wire at zero, and retains `EVIDENCE_INCOMPLETE`. Full local test suite and typecheck passed. No provider account was contacted.

### 2026-11-27 bounded lookup for linked accounting invoices

- QuickBooks and Xero now request missing invoice IDs referenced by fetched payment records, in batches of up to 40 and a maximum of 20 batches per sync. Returned source pages are retained with the sync's encrypted raw evidence and mapped through the existing accounting-payment path.
- Links still unresolved after the bounded lookup remain unmapped and produce a warning in recent sync activity. Sync status stays successful when provider fetching succeeded; the warning describes a mapping gap, not a transport failure. No bank settlement is inferred.
- Verified mocked lookups for both providers, unresolved-link warning behavior, raw response retention, and mapped payment applications. `npm test` passed (79 tests), `npm run typecheck` passed, and `npm run build` passed. Live provider credentials and account conformance were not used.

### 2026-11-27 production timestamp requirement for email webhooks

- The email adapter now requires the same timestamped Corridor HMAC format as the inbound JSON webhook when `NODE_ENV=production`. Local development continues to accept the legacy raw-body signature for compatibility.
- Durable event-ID or exact-payload deduplication remains the replay protection for duplicate deliveries. This does not add a signed timestamp capability to Wise requests.
- Verified the shared signature helper's timestamp enforcement in existing tests, email webhook integration tests, typecheck, and production build. No external webhook provider was contacted.


### 2026-11-27 Wise transfer creation-time cursor

- The local sync worker now forces a full Stripe, Wise, or Xero fetch when no full reconciliation has been recorded or the configured interval has elapsed, then resumes incremental cursors. The interval defaults to 168 hours and accepts 24 to 720 hours. Wise incremental requests use the persisted successful-sync time as `createdDateStart`, with the existing five-minute overlap, while retaining offset pagination and original response capture. Wise documents the inclusive creation-date filter in its [transfer listing API](https://github.com/transferwise/api-docs/blob/master/source/includes/reference/_transfers.md).
- This filter discovers newly created transfers. It does not guarantee detection of later status changes to old transfers; the scheduled full reconciliation catches them only when they fall within the provider's 100-page bound. No live provider account was contacted.
- Verification: focused cursor test passed; `npm test` passed (79 tests), `npm run typecheck` passed, and `npm run build` passed.


### 2026-11-27 scheduled full provider reconciliation

- Stripe, Wise, QuickBooks, and Xero now run a full provider fetch when they have no prior full-sync timestamp or their configured full-reconciliation interval has elapsed. The local default interval is 168 hours and the accepted range is 24 to 720 hours. Successful full runs persist their timestamp in SQLite; raw sync evidence records whether the run was full or incremental. A page-limit failure records its attempt time. When a prior successful cursor exists, the sync warns and continues incrementally, then suppresses another full scan until the configured interval elapses. An oversized first-ever full sync fails visibly and makes no provider request during the cooldown because no safe incremental cursor exists.
- Existing databases receive an additive last_full_synced_at column. A legacy integration with no value is forced through a full fetch on its next sync. Subsequent runs return to their incremental cursor. Existing connector pagination remains capped at 100 pages, so a provider history larger than that bound is not claimed as fully reconciled.
- Verification: migration and end-to-end Wise full-then-incremental tests passed; `npm test` passed (82 tests), `npm run typecheck` passed, and `npm run build` passed. Provider accounts were not contacted.

### 2026-11-27 leased webhook receipt processing

- Signed JSON and email webhook receipts now use durable SQLite processing claims with a 60-second lease, renewed every 15 seconds while parsing and queueing. Concurrent duplicate deliveries return accepted without processing the payload a second time. A later delivery can reclaim a receipt after a worker crash and lease expiry; a stale owner cannot finalize work after another request takes ownership.
- Failed receipts remain retryable, queued receipts remain idempotent, and existing SQLite databases receive the lease columns additively. The queue remains local SQLite and the claim lease is not a distributed cloud queue or a replacement for an outbox.
- Verification: the integration suite passed 40 tests, including migration, claim contention, stale-owner fencing, failed retry, receipt atomicity, both webhook API flows, and email parsing. Full `npm test` passed (83 tests), `npm run typecheck` passed, `npm run build` passed, and `git diff --check` passed. No external provider was contacted.

### 2026-11-27 review approval expiry and version binding

- New human review requests expire after 24 hours and persist the digest of the saved case payload plus the active review-policy ID. Resolution fails closed if either changes. Stored approval decisions and human override notes are only reusable against the same case and policy versions.
- Expired or superseded approvals are audited and removed from the pending list. The local worker resolves an in-process gate safely when its approval becomes invalid, recording `REVIEW_REQUEST_INVALIDATED` instead of claiming an operator stopped it. Existing approvals without a provable historical policy version are superseded during additive migration and need a fresh review.
- The existing review interface and approve, reject, and stop actions are preserved. Approval cancellation and a history view remain open. Full `npm test` passed (84 tests), focused integration tests passed (41 tests), `npm run typecheck` passed, `npm run build` passed, and `git diff --check` passed. No provider or cloud service was contacted.

### 2026-11-27 QuickBooks scheduled full reconciliation

- QuickBooks joins Stripe, Wise, and Xero in the configurable 168-hour full reconciliation schedule. A full run queries invoices and payments without a modification-time filter, then subsequent runs resume the five-minute-overlap `MetaData.LastUpdatedTime` cursor. The provider's query API supports unfiltered entity queries and bounded pagination; the adapter retains its 100-page cap and page-limit fallback behavior. See [Intuit query operations](https://static.developer.intuit.com/output_html/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries.html).
- Mocked sync tests verify both accounting resources are fetched unfiltered on the scheduled full run and use the modification cursor on the next run. Full `npm test` passed (84 tests), focused integration tests passed (41 tests), `npm run typecheck` passed, `npm run build` passed, and `git diff --check` passed. This does not establish live QuickBooks company conformance. No provider account was contacted.

### 2026-11-27 provider OAuth client authentication

- QuickBooks and Wise authorization-code exchanges now authenticate the confidential client with HTTP Basic and keep client credentials out of the form body. This matches the provider token request guidance: [Intuit OAuth 2.0](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0) and [Wise OAuth 2.0](https://docs.wise.com/guides/developer/auth-and-security/oauth-2-setup).
- Provider-specific OAuth differences remain explicit. QuickBooks and Wise are still configured as confidential clients; no PKCE parameters were added because the reviewed provider authorization instructions document state and client credentials but do not document PKCE for these flows. Xero and TrueLayer retain their existing PKCE handling.
- Mocked tests assert the Basic authorization header and that the QuickBooks and Wise request bodies contain no client ID or secret. The focused integration suite passed (42 tests), `npm run typecheck` passed, and no external provider account was contacted. The current app and database remain local; this does not establish live provider conformance or production deployment readiness.

### 2026-11-27 webhook in-progress duplicate retry

- Signed JSON and email webhook routes now return HTTP 503 with `Retry-After` when an identical receipt is still owned by an active processor. They no longer acknowledge an event as accepted while the first delivery may still be parsing or before its case acceptance transaction commits. A provider retry can reclaim the event after a failed attempt or expired processing lease.
- Route-level tests hold each receipt under an active lease and verify the response is retryable, while existing tests continue to verify that completed queued duplicates return HTTP 200 and first accepted deliveries return HTTP 202.
- Verification: focused integration suite passed (42 tests). These checks exercise the local SQLite receipt behavior; provider retry policy, external delivery behavior, and cloud queue processing remain unverified.

### 2026-11-27 Wise environment and Sandbox V2 endpoints

- Wise now selects matching authorization, token, and API hosts through `WISE_API_ENVIRONMENT`. Local development defaults to `sandbox`; a production process must explicitly set `sandbox` or `production`. Credentials are separated as `WISE_SANDBOX_CLIENT_ID` and `WISE_SANDBOX_CLIENT_SECRET`, or `WISE_PRODUCTION_CLIENT_ID` and `WISE_PRODUCTION_CLIENT_SECRET`. `WISE_API_VERSION` defaults to `2026Q4` and accepts version strings such as `2026Q4`.
- The sandbox uses Wise Sandbox V2 hosts and versioned API paths. This replaces Sandbox V1 hosts which Wise scheduled for deprecation on June 30, 2026. See Wise's [Sandbox V2 migration guide](https://docs.wise.com/guides/developer/environments/sandbox-v2-migration), [environment endpoints](https://docs.wise.com/guides/developer/environments), and [authorization-code setup](https://docs.wise.com/guides/developer/auth-and-security/personal-token-migration).
- Tests verify sandbox and production URL selection, credentials readiness, and that the Wise transfer connector uses the versioned sandbox API host. No Wise credentials were used and no live calls were made. Production partner access still requires Wise-issued production credentials, registered redirect URI, and the provider's mTLS onboarding; mTLS is not implemented in this local app.

### 2026-11-27 workspace-bound sessions and partial API scoping

- Signed sessions now include the member's workspace ID. Each API authorization checks the active membership in that workspace, and API rate-limit buckets include the workspace identity. Tokens issued before this claim existed are rejected and require sign-in again.
- Integration listing and connect/disconnect, workspace settings, audit-log reads, raw-ingestion reads, and dead-letter listing use the workspace established by request authorization. Workspace context lookup throws if authorization did not establish a context, instead of silently selecting the default workspace.
- Routes that still use the default workspace or process-global runtime state reject non-default workspace sessions with HTTP 503. Login still provisions against `ws-default`; the UI cannot create or switch workspaces. This milestone is partial API isolation and does not represent end-to-end tenant isolation.
- Verification on the local Windows environment: `node --import tsx --test tests/auth.test.ts` passed (11 tests); `npm test` passed (85 tests); `npm run typecheck` passed; `npm run build` passed. The authorization test creates a second workspace and verifies scoped integration data plus denial from an unmigrated history route. No production identity provider or external service was contacted.

### 2026-11-27 team invitation record validation

- Team member creation now normalizes and validates email addresses, validates names and roles at the database boundary, and checks for an existing address within the workspace inside a `BEGIN IMMEDIATE` transaction. Duplicate API requests return HTTP 409; invalid records return HTTP 400. This protects against concurrent duplicate invitations without modifying existing member rows.
- Invitations remain database records only. No message is sent, and Cognito enrollment or another identity enrollment path must still be arranged by the workspace owner.
- Verification: `npm test` passed (86 tests), including duplicate and malformed address checks at the database layer and duplicate HTTP conflict behavior. `npm run typecheck` passed. No email service or identity provider was contacted.

### 2026-11-27 generic provider endpoint DNS pinning

- Generic provider sync now resolves the configured host at request time, rejects private or reserved answers, and connects to the same validated IP while retaining the original HTTP host and TLS server name. It does not follow redirects and caps response bodies at 10 MiB. The timeout remains 20 seconds.
- This closes the DNS rebinding gap between validation and socket connection for generic JSON sync. Production still requires the exact hostname allowlist and should use network egress controls as defense in depth. Endpoint creation continues to validate DNS before saving as an early configuration check.
- Verification: the focused integration suite passed (43 tests), including a local server assertion that the socket connects to the validated loopback address, rejection of a private DNS answer, rejection of an oversized response, and enforcement of the total request timeout. Full `npm test` passed (87 tests), `npm run build` passed, and `npm run typecheck` passed serially after the build. No external endpoint was contacted.

### 2026-11-27 bounded ingestion batch size

- Upload, JSON webhook, email attachment, CSV, MT103, ISO 20022, and JSON settlement normalization now cap a single ingestion at 500 settlement cases. JSON input is checked before Zod materializes case records, CSV line counting stops once the cap is exceeded, and XML entry matching stops at the first excess record. A JSON case can include at most 100 candidate wires.
- Oversized imports return HTTP 413. Upload and webhook paths retain raw intake as failed evidence and queue no partial cases. Email attachment case counts are enforced across the whole message, not separately per attachment.
- Verification: focused parser and route tests passed (9 tests). Full `npm test` passed (90 tests), `npm run build` passed, `npm run typecheck` passed serially after the build, and `git diff --check` passed.

### 2026-11-27 bounded provider sync records and evidence

- Stripe, Wise, QuickBooks, Xero, and generic JSON polling now reject provider syncs above 5,000 mapped cases. Native paginated resources are capped at 10,000 fetched records each, each response page at 10 MiB, and combined raw provider evidence at 50 MiB. Generic endpoints retain their original JSON response in the raw vault on successful mapping.
- A limit breach stops the sync without queuing partial cases or updating the successful sync cursor. The worker stores the bounded response evidence as an encrypted failed raw-ingestion record with resource, fetched-record count, truncation state, and zero queued cases. A failed full reconciliation records its attempt timestamp to avoid repeatedly rescanning the same oversized history. Existing 100-page limit behavior and incremental fallback remain separate.
- Verification on the local Windows environment: `npm test` passed (91 tests), including an oversized Stripe response that verifies failed evidence retention, zero case queueing, and unchanged successful cursor. `npm run typecheck`, `npm run build`, and `git diff --check` passed. Provider accounts were not contacted.
