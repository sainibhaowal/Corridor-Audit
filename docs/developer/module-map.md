# Codebase Module Map (`src/` & `tests/`)

## 1. Core Domain, Parsers & Reports (`src/core/`)
| Module | Responsibility |
| :--- | :--- |
| `src/core/money.ts` | Deterministic integer minor-unit arithmetic (`parseDecimalStringToMinor`, `convertMinorUnits`, `validateIbanMod97`, `validateBicFormat`, `computeTaxWithholding`). Zero LLM math. |
| `src/core/types.ts` | Canonical TypeScript interfaces: `SettlementCase`, `InvoiceInput`, `WireOrBankInput`, `AuditVerdict`, `SourceRef`, `PendingBreakpointDecision`, `TrajectoryEvent`. |
| `src/core/fx/frankfurter-client.ts` | Live ECB mid-market FX lookup (`api.frankfurter.app`) with automatic fallback to `data/fallback-rates.json`. |
| `src/core/parsers/mt103-parser.ts` | Multi-block SWIFT MT103 parser (`:20:`, `:32A:`, `:50K:`, `:59:`, `:70:`, `:71A:`, `:71F:`, `:71G:`) with grounded `SourceRef` extraction. |
| `src/core/parsers/camt053-parser.ts` | ISO 20022 `camt.053` / `pacs.008` XML parser extracting settlement amounts, charges, and repair fees. |
| `src/core/parsers/csv-parser.ts` | Upwork, Stripe, Wise, Payoneer, and bank/invoice CSV parsers. |
| `src/core/parsers/pdf-parser.ts` | Extracts text from text-based PDFs and rejects mislabeled or image-only non-extractable PDFs. |
| `src/core/parsers/ocr-extractor.ts` | Hybrid OCR for receipt images (`.png`, `.jpg`, `.jpeg`, `.webp`): uses configured Vision LLM when capable and automatically falls back to local `tesseract.js` OCR for text-only models or Vision failures. |
| `src/core/ingest/normalize-upload.ts` | Unified format auto-detection (`json`, `xml`, `mt103`, `csv`, `pdf`, `text`) and `markSuppliedWireEvidence` (`observed` vs `incomplete` vs `estimated`). |
| `src/core/ingest/case-schema.ts` & `limits.ts` | Zod validation and bounded case/wire limits for JSON, CSV, MT103, XML, and email attachment batches. |
| `src/core/reports/export-formats.ts` | Multi-format exporters: `buildVerdictTxt`, `buildVerdictsCsv` (with formula-injection protection), and `buildVerdictPdf` (zero-dependency PDF 1.4). |
| `src/core/llm/providers.ts` | `DynamicEndpointRouter` supporting NVIDIA NIM, Gemini, Groq, OpenRouter, OpenAI, Anthropic, and Ollama with live `/models` discovery and concurrency throttling (`MAX_CONCURRENT_LLM_CALLS`). |
| `src/core/integrations/` | `catalog.ts` (12-provider catalog), `connectors.ts` (Stripe, Wise Sandbox V2/Prod, QuickBooks, Xero, generic JSON), `oauth.ts` (PKCE S256 & Basic auth), `http.ts` (SSRF + DNS pinning + timeouts), `email-parser.ts`. |
| `src/core/policies/tax-profile.ts` | Resolves explicit invoice withholding rate vs. workspace tax profile. |

---

## 2. Mozaik Multi-Agent Runtime (`src/runtime/`)
| Module | Responsibility |
| :--- | :--- |
| `src/runtime/corridor-runtime.ts` | `defineRuntime<CorridorState>()` with isolated per-role state slots (`termsByCaseId`, `fxByCaseId`, `wireByCaseId`, `anomalyByCaseId`, `auditByCaseId`, `pendingApprovals`) and checkpoint restoration in `registerCase`. |
| `src/runtime/orchestrator.ts` | `CorridorOrchestrator` singleton: initializes Mozaik runtime, joins the 4+1 agents + observer, restores `case_checkpoints` on retry/restart, starts `./data/inbox/` hot-folder watcher, `startCaseQueueWorker`, `startBackgroundSyncWorker`, and serializes batches with `runWithDurableCaseRetries`. |
| `src/runtime/agents/corridor-agents.ts` | Defines `TermsAgent`, `FxBenchmarkAgent`, `WireDetectiveAgent`, conditional `DuplicateAnomalyAgent` (skipping already-checkpointed roles), and reactive `AuditorAgent` (`onAllSpecialistsReady`). |
| `src/runtime/agents/agent-prompts.ts` | System prompts enforcing tool-first execution and zero fabricated figures. |
| `src/runtime/agents/trajectory-observer.ts` | Streams Mozaik lifecycle & tool events to `TrajectoryEvent[]` for the UI live console & SSE (`/api/events`), and persists encrypted specialist checkpoints to SQLite on role completion. |
| `src/runtime/interception/settlement-gate.ts` | `SettlementGateInterceptionHandler` pausing `finalize_settlement_action` for human review (`Approve`, `Reject & Steer`, `Stop`). |
| `src/runtime/interception/human-override.ts` | Validates human override provenance against recorded `review_approvals`. |
| `src/runtime/tools/*.ts` | Instrumented specialist & auditor tools (`terms-tools.ts`, `fx-tools.ts`, `wire-tools.ts`, `anomaly-tools.ts`, `audit-tools.ts`, `instrument.ts`). |
| `src/runtime/workers/*.ts` | `durable-case-queue.ts` (bounded retries + dead-letter queue), `sync-worker.ts` (scheduled incremental + periodic full sync), `review-approval-expiry.ts`. |

---

## 3. Frontend Workbench (`src/components/` & `src/app/`)
| Component | Responsibility |
| :--- | :--- |
| `src/components/corridor-workspace.tsx` | 3-panel workbench shell: navigation, sidebar drag-and-drop / click `Upload source` with live stage indicator (`uploading` → `processing` → `ingested`), top toast notification, auto-switch to Live Agent Stream, breakpoint resolution controls, and Cases / Artifacts / Ledger drawer. |
| `src/components/corridor-summary-view.tsx` | KPI summary cards, per-case verdict table, and batch **Export Sheet (.csv)** / **Export All (.json)**. |
| `src/components/case-inspector-modal.tsx` | Case Inspector modal with **Summary & Cent Ledger**, **In-Built File Preview** (inline `.pdf` iframe, parsed `.csv` table, `.txt`, `.json`), **Technical JSON**, and **Review Request Draft (.txt)**. |
| `src/components/inbound-sources-view.tsx` | File drag-and-drop & paste uploader (`.csv`, `.txt`, `.xml`, `.json`, `.pdf`). |
| `src/components/raw-vault-view.tsx` | Raw Data Vault browser with SHA-256 inspection, raw download, and reprocess triggers. |
| `src/components/integrations-panel.tsx` | OAuth2 / API token connector cards and manual sync controls. |
| `src/components/settings-view.tsx` & `provider-settings-modal.tsx` | Workspace tax/threshold/team settings + LLM provider key, `/models` discovery, and custom display label config. |
| `src/components/workbench-terminal.tsx` | Bottom terminal & Mozaik runtime console drawer. |

---

## 4. Verification Suite (`tests/`)
All **98 tests** run via `npm test` (`node --import tsx --test tests/*.test.ts`), covering auth/RBAC, money math, parsers (`mt103`, `camt053`, `csv`, `pdf`, hybrid Vision + `tesseract.js` OCR), vault encryption, OAuth PKCE, SSRF DNS pinning, provider sync cursors, ClamAV scanning, durable retries, persistent case sequences, encrypted agent checkpoints, SHA-256 upload deduplication, audit log hash-chaining, and report exports (`.txt`, `.csv`, `.pdf`, `.json`).
