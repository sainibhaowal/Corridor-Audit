# Current Behavior and Gaps

This page records behavior visible in the current source tree. It distinguishes persisted data from process-local state and provider-specific code from catalog entries.

## Current request and processing flow

```mermaid
flowchart LR
    U[Upload or paste] --> P[Parse in Next.js process]
    W[Inbound JSON or email adapter] --> P
    H[Local hot folder] --> P
    I[Integration poll] --> N[Provider mapping]
    N --> P
    P --> R[SQLite raw ingestion record]
    P --> Q[In-process case promise chain]
    Q --> T[Terms specialist]
    Q --> F[FX specialist]
    Q --> D[Wire specialist]
    Q -. conditional .-> A[Anomaly specialist]
    T --> B[Expected-role barrier]
    F --> B
    D --> B
    A -. when expected .-> B
    B --> C[Auditor]
    C --> G[In-process review gate]
    G --> V[SQLite verdict and current workbench]
```

Uploads and inbound webhooks parse in the request process. Upload and webhook bodies have endpoint-specific streaming size limits. The API normally returns `202` after parsing and starting an in-process queue operation, not after the audit finishes. Three specialist agents run concurrently per case. The anomaly agent runs when candidate wires or account-change evidence is present. The auditor starts after all expected specialists complete. Cases are serialized through a process-local promise chain. See [`src/runtime/orchestrator.ts`](../../src/runtime/orchestrator.ts).

## Feature status

| Area | Implemented now | Production gap |
| --- | --- | --- |
| Data Sources | Upload, text paste, JSON webhook, email-adapter JSON, local hot folder, and integration catalog. Stripe, Wise, QuickBooks Online, and Xero have provider-specific polling code. | Polling is limited and does not yet provide complete, reconciled source records. Other catalog options may use a generic JSON endpoint, local folder, or setup-only record. OAuth token refresh, pagination, cursors, and provider conformance are incomplete. |
| Raw records | SQLite stores payload text or base64, SHA-256, metadata, parse status, and linked case IDs. Raw payload bytes are now encrypted at rest with AES-256-GCM through the local vault key, and legacy raw rows are encrypted in place when the database opens. Reprocess and download routes return decrypted content through the existing application path. Upload and webhook request sizes are bounded. | Case JSON and other database fields remain unencrypted. A digest stored beside an editable database row is not tamper evidence. Platform sync currently saves normalized cases rather than the original response. Managed key custody, key rotation, malware scanning, retention, and immutable evidence custody are missing. |
| Corridor summary | UI totals saved verdict fields and lists cases. Evidence-incomplete invoice-only cases are excluded from fee and FX totals. Fee and FX labels describe calculated flags and estimates. | Summary is not grouped into a complete corridor analytics model. Amount flags are not independently verified recoveries. Zero variance is arithmetic over submitted values, not proof that source records are authentic. |
| Review gate | Risk-only and every-tool modes. Risk Only pauses for recoverable OUR fee flags, above-threshold variance, duplicate classification, or supplied bank-change signal. Nonzero below-threshold differences remain visible in the verdict. | Gate mode, pending approvals, queue, and run state are process-local. Approval identity and role are not recorded. |
| Workspace and tax profile | A single `ws-default` workspace can store name, mode, currency, country, a withholding rate, a variance threshold, and webhook signature setting. Tax settings are versioned. An explicit invoice rate, including zero, takes precedence; an omitted rate uses the current workspace profile and records the applied version and source in the terms assessment. | API routes select the fixed workspace. The tax profile is a configured basis-point assumption, not a statutory tax engine or jurisdictional determination. Historical replay under old policy and approved effective-date changes are not implemented. |
| Identity and API access | Cognito authorization-code login uses PKCE, state, nonce, verified email, and signed HTTP-only sessions. Production middleware protects pages and API routes; Node handlers recheck current team membership and role. | Cognito has not been configured. Sessions expire after one hour. Team invitations do not send email, workspace identity is fixed, and OAuth connector state remains process-local. |
| Team | Owner, controller, analyst, and viewer roles are applied to protected routes. Verified invited members activate on first sign-in. A configured bootstrap email can create the initial owner. | No invitation email is sent. The owner must provision the invited address in Cognito or otherwise arrange identity enrollment. |
| Webhooks | HMAC checks exist for Stripe, Wise, and Corridor signatures. Stripe timestamp tolerance is 300 seconds. Production always requires a recognized signature, independent of the local workspace toggle. | Wise and Corridor signatures do not have a timestamp window. There is no durable provider event ID ledger or deduplication. A valid signature only authenticates a signed body, not its accounting meaning. |
| Integrations and scheduling | Sync records are persisted. A manual sync awaits provider fetch. An in-process timer polls connected integrations at a configurable interval. | The timer is not a durable scheduler and can run in multiple application instances. Sync success records fetch completion, not audit completion. Background jobs have no durable lease, retry policy, or dead-letter process. |
| Local persistence | `node:sqlite` uses `DatabaseSync` and writes to `data/corridoraudit.db` by default. Cases, verdicts, raw records, integrations, and sync history persist locally. | Synchronous SQLite is not the production multi-instance database. There is no managed backup/restore process, database failover, migration service, or tenant-aware data authorization. |

## Important source limitations

Supported JSON case arrays and case objects now pass Zod validation for core amount, currency, date, invoice, wire, and fee fields. A JSON case is only marked observed when invoice and wire evidence have distinct source references and both charge lists are present. Provider webhook payloads and email-adapter payloads still need their own strict schemas. Invoice-only CSV, text, PDF, and supported JSON normalization marks generated comparison wires as estimated. Wire-only records and payments whose invoice expectation is derived from the same MT103/camt.053 or payout row are incomplete. QuickBooks and Xero invoice mappings are marked estimated. These records finalize as `EVIDENCE_INCOMPLETE` and cannot create fee-dispute drafts. Complete evidence validation across all ingestion paths remains open work.

Stripe polling currently requests a limited payout page. Wise polling requests a limited transfer page. QuickBooks and Xero poll invoices and create comparison wires marked estimated because they do not prove payment. The connector implementation is in [`src/core/integrations/connectors.ts`](../../src/core/integrations/connectors.ts).

## Current source locations

- Intake and parsing: [`src/app/api/audit/upload/route.ts`](../../src/app/api/audit/upload/route.ts), [`src/core/ingest/normalize-upload.ts`](../../src/core/ingest/normalize-upload.ts)
- Storage: [`src/core/db/schema.ts`](../../src/core/db/schema.ts), [`src/core/db/database.ts`](../../src/core/db/database.ts)
- Queue and sync timer: [`src/runtime/orchestrator.ts`](../../src/runtime/orchestrator.ts), [`src/runtime/workers/sync-worker.ts`](../../src/runtime/workers/sync-worker.ts)
- Review gate and calculations: [`src/runtime/interception/settlement-gate.ts`](../../src/runtime/interception/settlement-gate.ts), [`src/runtime/tools/audit-tools.ts`](../../src/runtime/tools/audit-tools.ts)
- Workspace and team settings: [`src/app/api/settings/workspace/route.ts`](../../src/app/api/settings/workspace/route.ts)
- Webhook verification: [`src/core/security/webhook-signatures.ts`](../../src/core/security/webhook-signatures.ts)
