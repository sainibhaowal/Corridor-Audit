# API Endpoints Reference (`src/app/api/**`)

All API routes run on the Next.js 15 App Router (`export const runtime = "nodejs"`). Protected endpoints enforce RBAC via `authorizeCorridorRequest(request, minRole)` in [`src/core/security/authorization.ts`](../../src/core/security/authorization.ts) and cross-site mutation checks via [`src/middleware.ts`](../../src/middleware.ts).

## Role Hierarchy
`viewer` < `analyst` < `controller` < `owner`

---

## 1. Ingestion & Webhooks

| Endpoint | Method | Min Role | Purpose & Key Behavior | Source |
| :--- | :--- | :--- | :--- | :--- |
| `/api/audit/upload` | `POST` | `analyst` | Ingests `content` (CSV, MT103, camt.053 XML, JSON, text) or `base64` (PDF or receipt images `.png`/`.jpg`/`.jpeg`/`.webp` up to 10 MiB decoded; 14 MiB JSON body limit). Runs `scanFileBytes`, deduplicates identical payloads by SHA-256 (`200` with `duplicate: true` unless `force: true`), extracts image text via Vision LLM with automatic `tesseract.js` OCR fallback (`ocr-extractor.ts`), assigns monotonic case IDs (`MT103-0001`, ...), saves to `raw_ingestions`, and enqueues on `CorridorOrchestrator`. Returns `202`. | [`upload/route.ts`](../../src/app/api/audit/upload/route.ts) |
| `/api/webhooks/inbound` | `POST` | Signature | 1 MiB body limit. Verifies Corridor HMAC-SHA256 (`X-Corridor-Signature` / timestamped) or Stripe signature (`Stripe-Signature`). Uses idempotent `recordWebhookReceipt` (`409` on payload conflict, `200` on duplicate, `503 Retry-After: 5` if lease active). | [`webhooks/inbound/route.ts`](../../src/app/api/webhooks/inbound/route.ts) |
| `/api/webhooks/email` | `POST` | Signature | 10 MiB body limit. Verifies signature, validates email JSON (`validateInboundEmailPayload`), scans every attachment with `scanFileBytes`, and extracts MT103/CSV/XML/JSON/PDF cases. | [`webhooks/email/route.ts`](../../src/app/api/webhooks/email/route.ts) |
| `/api/ingestions` | `GET` | `viewer` | Lists Raw Data Vault (`raw_ingestions`) records for the workspace (metadata + parse status + `caseIds`). | [`ingestions/route.ts`](../../src/app/api/ingestions/route.ts) |
| `/api/ingestions/[id]` | `GET` | `viewer` | Inspects a single raw ingestion or downloads original payload (`?download=1`), decrypting via the vault API. | [`ingestions/[id]/route.ts`](../../src/app/api/ingestions/%5Bid%5D/route.ts) |
| `/api/ingestions/[id]/reprocess` | `POST` | `analyst` | Re-parses a stored raw ingestion payload and re-enqueues normalized cases. | [`ingestions/[id]/reprocess/route.ts`](../../src/app/api/ingestions/%5Bid%5D/reprocess/route.ts) |

---

## 2. Reports, Exports & In-Built Preview

| Endpoint | Method | Min Role | Purpose & Key Behavior | Source |
| :--- | :--- | :--- | :--- | :--- |
| `/api/report` | `GET` | `viewer` | Batch export of all completed verdicts in the workspace. Supports `?format=csv` (default, RFC-4180 with formula-injection neutralization) and `?format=json`, plus `?preview=1` (`inline` disposition). | [`report/route.ts`](../../src/app/api/report/route.ts) |
| `/api/report/[caseId]` | `GET` | `viewer` | Single-case export & preview. Supports `?format=pdf` (valid PDF 1.4), `?format=csv`, `?format=txt` (review request draft / report), and `?format=json` (verdict + specialist outputs + trajectory). Pass `?preview=1` for `Content-Disposition: inline` (used by the UI `<iframe>` PDF viewer and preview tabs). | [`report/[caseId]/route.ts`](../../src/app/api/report/%5BcaseId%5D/route.ts) |

---

## 3. Mozaik Runtime, Events, Breakpoints & Queue

| Endpoint | Method | Min Role | Purpose & Key Behavior | Source |
| :--- | :--- | :--- | :--- | :--- |
| `/api/events` | `GET` | `viewer` | Server-Sent Events (SSE) stream emitting live Mozaik `TrajectoryEvent`s, `agent.started`, `tool.completed`, `breakpoint.paused`, and `audit.verdict`. | [`events/route.ts`](../../src/app/api/events/route.ts) |
| `/api/history` | `GET` | `viewer` | Returns persisted cases, completed `AuditVerdict`s, pending breakpoints, and trajectory summaries. | [`history/route.ts`](../../src/app/api/history/route.ts) |
| `/api/runtime/status` | `GET` | `viewer` | Returns `DynamicEndpointRouter` public status (active provider/model, mode) and `queueStats`. | [`runtime/status/route.ts`](../../src/app/api/runtime/status/route.ts) |
| `/api/breakpoints/[caseId]/resolve` | `POST` | `controller` | Resolves a paused `SettlementGateInterceptionHandler` breakpoint (`approve`, `reject` + steering instruction, or `stop`), binding the decision to `case_evidence_sha256`. | [`breakpoints/[caseId]/resolve/route.ts`](../../src/app/api/breakpoints/%5BcaseId%5D/resolve/route.ts) |
| `/api/terminal` | `POST` | `analyst` | Executes workbench CLI-style commands (`status`, `replay`, etc.) from the UI terminal drawer. | [`terminal/route.ts`](../../src/app/api/terminal/route.ts) |
| `/api/queue/dead-letters` | `GET` | `controller` | Lists cases that exhausted `runWithDurableCaseRetries` backoff attempts. | [`queue/dead-letters/route.ts`](../../src/app/api/queue/dead-letters/route.ts) |
| `/api/queue/dead-letters/[caseId]/replay` | `POST` | `controller` | Re-queues an exhausted dead-letter case for processing. | [`queue/dead-letters/[caseId]/replay/route.ts`](../../src/app/api/queue/dead-letters/%5BcaseId%5D/replay/route.ts) |

---

## 4. Integrations & OAuth

| Endpoint | Method | Min Role | Purpose & Key Behavior | Source |
| :--- | :--- | :--- | :--- | :--- |
| `/api/integrations` | `GET` | `viewer` | Lists integration catalog status (`connected`, `disconnected`, `syncing`, `error`) and recent `sync_runs`. | [`integrations/route.ts`](../../src/app/api/integrations/route.ts) |
| `/api/integrations/[provider]/connect` | `GET`, `POST` | `controller` | Starts OAuth2 (PKCE S256 for Xero/TrueLayer; Basic auth for QBO/Wise) or saves encrypted API token / generic endpoint config (SSRF-validated). | [`integrations/[provider]/connect/route.ts`](../../src/app/api/integrations/%5Bprovider%5D/connect/route.ts) |
| `/api/integrations/[provider]/callback` | `GET` | OAuth State | Validates single-use `oauth_authorization_states`, exchanges code for tokens, encrypts credentials with AES-256-GCM. | [`integrations/[provider]/callback/route.ts`](../../src/app/api/integrations/%5Bprovider%5D/callback/route.ts) |
| `/api/integrations/[provider]/sync` | `POST` | `analyst` | Triggers an immediate lease-locked provider sync (`Stripe`, `Wise`, `QuickBooks`, `Xero`, or generic JSON). | [`integrations/[provider]/sync/route.ts`](../../src/app/api/integrations/%5Bprovider%5D/sync/route.ts) |
| `/api/integrations/[provider]/disconnect` | `POST` | `controller` | Clears encrypted credentials and marks the integration disconnected. | [`integrations/[provider]/disconnect/route.ts`](../../src/app/api/integrations/%5Bprovider%5D/disconnect/route.ts) |

---

## 5. Settings, Auth, Audit Log & Health

| Endpoint | Method | Min Role | Purpose & Key Behavior | Source |
| :--- | :--- | :--- | :--- | :--- |
| `/api/settings/provider` | `POST` | `owner` | Updates runtime LLM provider, API key, model ID, or custom display label in `DynamicEndpointRouter`. | [`settings/provider/route.ts`](../../src/app/api/settings/provider/route.ts) |
| `/api/settings/models` | `POST` | `owner` | Live-discovers available models from the selected provider's `/models` endpoint. | [`settings/models/route.ts`](../../src/app/api/settings/models/route.ts) |
| `/api/settings/test` | `POST` | `owner` | Runs a lightweight connectivity probe against the configured LLM endpoint. | [`settings/test/route.ts`](../../src/app/api/settings/test/route.ts) |
| `/api/settings/workspace` | `GET`, `POST` | `viewer` (`GET`), `controller` (`POST`) | Reads/updates workspace profile, tax rate (`withholding_tax_bps`), variance threshold, team invitations, and webhook signature policy. | [`settings/workspace/route.ts`](../../src/app/api/settings/workspace/route.ts) |
| `/api/audit-log` | `GET` | `viewer` | Reads the hash-chained `workspace_audit_log` and reports chain integrity verification status. | [`audit-log/route.ts`](../../src/app/api/audit-log/route.ts) |
| `/api/auth/login` | `GET` | Public | Initiates Cognito OIDC login flow (when `CORRIDOR_AUTH_MODE=cognito`). | [`auth/login/route.ts`](../../src/app/api/auth/login/route.ts) |
| `/api/auth/callback` | `GET` | Public | Verifies OIDC callback, binds Cognito `sub` to `team_members`, and issues signed session cookie (`auth_sessions`). | [`auth/callback/route.ts`](../../src/app/api/auth/callback/route.ts) |
| `/api/auth/logout` | `POST` | Public | Revokes the session in `auth_sessions` and clears the session cookie. | [`auth/logout/route.ts`](../../src/app/api/auth/logout/route.ts) |
| `/api/health` | `GET` | Public | Liveness check returning service status and runtime metadata. | [`health/route.ts`](../../src/app/api/health/route.ts) |
