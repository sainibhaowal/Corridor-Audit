# Changelog

CorridorAudit release history. Versions follow the policy in [docs/VERSIONING.md](docs/VERSIONING.md). Each release entry records the application scope and verified behavior at that release; it is not limited to files changed in the release commit.

## [Unreleased]

### Added
- **Multi-Format Export & In-Built Preview:** Added zero-dependency PDF 1.4 (`?format=pdf`), RFC-4180 CSV with formula-injection neutralization (`?format=csv`), TXT, and JSON exports on `/api/report/[caseId]` and batch `/api/report`, plus `?preview=1` inline preview in the Case Inspector (live PDF `<iframe>`, parsed CSV table, TXT, JSON).
- **Interactive Analytics Dashboard & Trace Waterfall:** Added `CorridorAnalyticsPanel` (Line/Area/Bar Trend chart, Stacked/Pie Leak Breakdown, Model & Agent Usage Meter, Case Risk Heat-Graph, Trust & Accuracy Proof) and `TraceWaterfall` parallel Gantt chart in the Case Inspector.
- **Hybrid Vision LLM + `tesseract.js` OCR Fallback:** Added receipt image support (`.png`, `.jpg`, `.jpeg`, `.webp`) using the active Vision LLM when capable and automatic fallback to local `tesseract.js` OCR for text-only models or Vision failures.
- **Persistent Case Sequences, Checkpoints & Deduplication:** Added SQLite `case_sequences` (`MT103-0001`, ...), AES-256-GCM encrypted `case_checkpoints` so retries/restarts skip already-finished specialists, and SHA-256 upload deduplication.
- **Model-Decided Single-Specialist Re-Run:** Added `rerun_specialist_agent` (`specialist.rerun`) with feedback history (`previousFeedbacks`, no hard cap) and parent wait-and-stop discipline on `AuditorAgent`.
- **Sidebar Quick-Upload & Multi-Tab Live Sync:** Added drag-and-drop / click upload on the sidebar `Upload source` button with inline progress stages, top toast notification, SSE reconnect catch-up, `visibilitychange` resync, and `BroadcastChannel` cross-tab sync.
- **Live Ready State & Execution Stream UI:** Added `> Waiting for Data` live status indicator with subtle bottom-edge aurora glow on the empty-state card (automatically hiding `Configure LLM Key` once a provider is live), plus a live Run-Activity header (agent/tool counts & elapsed timer), `Subagent` / `Lead Agent` badges, live `Thinking` elapsed timer, and expandable tool-call cards.
- **Lead-LLM Dynamic Subagent Delegation & Execution Tree:** Added `delegate_subagents` (`onCaseQueuedPlan` Phase 0 planning) so `AuditorAgent` dynamically hires only needed subagents on `@mozaik-ai/core`, plus the collapsible nested `AgentTraceTree` UI with live barrier counters and `Expand all` / `Collapse all`.
- **Documentation:** Added `docs/developer/` (`README.md`, `api-reference.md`, `database-schema.md`, `execution-layer.md`, `module-map.md`, `env-and-security.md`), `docs/DEMO-GUIDE.md`, and Case Study Module `07`.

## [0.2.0] - 2026-11-27

Feature release for local persistence, ingestion records, integration setup, and the expanded review workbench. This remains a local preview; connector coverage and production safeguards are limited as described in the README and architecture documents.

### Added

- Added local SQLite persistence for cases, verdicts, integrations, sync runs, and raw-ingestion records across the implemented input paths.
- Added a data-source catalog, integration setup and OAuth flows, provider model discovery, configurable LLM settings, and an in-process integration sync worker. Stripe, Wise, QuickBooks Online, and Xero have provider-specific polling/mapping code; catalog entries do not imply complete provider-certified connectors.
- Added signed-webhook verification options for supported providers and AES-256-GCM encryption for integration credentials and webhook secrets.
- Added raw-ingestion inspection, download, and reprocessing views, plus an allowlisted in-app runtime console.
- Added the responsive three-panel workbench, case inspection, light/dark themes with reduced-motion-aware transitions, and compact panel controls.

### Changed

- Removed bundled synthetic demo scenarios and demo execution controls. Running an agent workflow now requires a configured LLM provider; the CLI requires an input file.
- Updated generated dispute text to request a review based on supplied records without asserting that a charge is unlawful or recoverable.
- Clarified that citation checks validate SourceRef structure and do not authenticate source documents or figures.
- Rewrote the README, architecture notes, case study, and diagrams to distinguish implemented behavior from incomplete connector coverage and deployment requirements.

### Known limitations

- This release is for local evaluation with synthetic or public data. It has no user authentication, authorization, tenant isolation, distributed durable queue, encrypted raw-payload storage, or production backup/monitoring controls.
- Integration coverage, OAuth lifecycle, provider mappings, webhook enforcement, and operational error handling require provider-specific setup and validation.
- Financial figures depend on submitted data and implemented approximations; they are not legal determinations or guarantees of recovery.

### Verification

- `npm test` passed: 16 tests.
- `npm run typecheck` passed.
- `npm run build` passed for application version `0.2.0`.
- `npm start -- --no-open` started the built app; `/` and `/api/health` returned HTTP 200, with health reporting app version `0.2.0` and Mozaik core `6.0.0`.

## [0.2.1] - 2026-11-27

Patch release fixing six production-affecting UI/runtime bugs discovered during hackathon submission preparation. All fixes are local-only with no external dependencies.

### Fixed

- **SSE status indicators** (`src/components/corridor-workspace.tsx`): Replaced malformed Tailwind class `bg-[#2c2111]0` with valid `bg-amber-600` for disconnected state at two locations (header status row and footer status bar). The invalid class produced no visible dot in production builds.

- **Settings sidebar GitHub icon overlap** (`src/components/settings-view.tsx`): Added `pb-10` bottom padding to the settings `Card` so the absolute-positioned GitHub octocat icons (repo + issues links) no longer cover the last settings tile.

- **Hot-folder watcher re-ingestion** (`src/runtime/orchestrator.ts`): Changed `seenFiles` from a `Set<string>` to a `Map<string, string>` keyed by filename with values of `${mtimeMs}:${size}`. The watcher now re-ingests a file when its modification time or size changes, skips directories and non-files, and avoids partial-write races by verifying the signature again after the 250 ms debounce.

- **Stale production bundle** (`scripts/start.mjs`): Added `bundleIsStale()` that compares the newest mtime among tracked source directories (`src`, `public`, `next.config.mjs`, `package.json`, `tailwind.config.ts`, `postcss.config.mjs`, `tsconfig.json`) against the `.next/BUILD_ID` mtime. The start script now rebuilds when sources are newer instead of serving a stale bundle.

- **Preview format race condition** (`src/components/case-inspector-modal.tsx`): Added a `useRef` run counter that clears `previewText`/`previewError` on format change and ignores stale fetch responses, preventing CSV/TXT previews from showing stale PDF content while the new fetch is in flight.

- **CSV export negative amounts** (`src/core/reports/export-formats.ts`): Fixed `csvEscape()` to keep plain numbers (including negatives like `-35.00`) numeric in spreadsheets. Only values that start with `= + - @` and are **not** plain numbers receive the leading-apostrophe neutralization. Added regression test covering `-35.00` → `-35.00` (not `'-35.00`).

### Verification

- `npm test` passed: 93 tests, 0 failures.
- `npm run typecheck` passed.
- `npm run build` passed for application version `0.2.1`.
- `npm start -- --no-open` started the built app; `/api/runtime/status` reports `sourceRevision: c3523593bcb8`, `workingTree: "clean"`, provider mode `unconfigured`, queue stats all zero.
- Runtime SSE indicators show emerald (connected) / amber (disconnected).
- Settings sidebar GitHub icons no longer overlap at any viewport.
- Hot-folder re-drop of edited file re-ingests with new ingestion ID.
- Case inspector preview tabs switch without stale content.
- CSV export opens in spreadsheet with numeric negative cells (SUM works).

## [0.1.1] - 2026-11-26

Patch release for the command-line audit completion message and release documentation. Reconciliation rules and audit-rules version remain unchanged from `0.1.0`.

### Changed

- Replaced the CLI completion message that described every completed case as clean. The CLI now reports that case audits finished and directs operators to review the individual verdicts, preserving the distinction between execution completion and a clean audit result.
- Expanded release documentation to describe the application workflow, supported inputs, agent execution model, human review gate, verification results, and preview limitations.

### Verification

- `npm test` passed: 10 tests, including the App Router approval, reject-and-steer, and report flow.
- `npm run typecheck` passed.
- `npm run cli` completed all six bundled synthetic cases using the deterministic demo provider; the completion output no longer implies that all cases were clean.
- `npm run build` passed for the `0.1.1` application version.
- `npm start -- --no-open` started the production build; `/api/health` reported application version `0.1.1`, source revision `f041affec12c`, a clean working tree, demo provider mode, and audit-rules version `0.1.0`.

## [0.1.0] - 2026-11-26

Initial versioned preview release of CorridorAudit, a local demonstration application for reconciling cross-border payout records and investigating potential FX, fee, duplicate, and short-payment issues. The application is intended for the JigJoy Agents in Finance hackathon and uses synthetic or public data.

### Application and workflow

- Implemented a Next.js 15 App Router application in TypeScript with React, Tailwind CSS, and reusable shadcn-style UI primitives.
- Added a three-panel workspace for agent activity, case results and artifacts, corridor summaries, and ledger details.
- Added ingestion workflows for invoice and payout CSV, SWIFT MT103 text, ISO 20022 camt.053 XML, JSON, PDF text extraction, pasted text, inbound webhooks, and a local `data/inbox` watcher.
- Added six bundled synthetic scenarios: clean settlement, OUR fee deduction, unexplained short payment, orphaned wire, duplicate wire, and platform FX markup.

### Reconciliation and review

- Added Mozaik agent roles for contract and invoice terms, FX benchmarking, wire and fee analysis, conditional duplicate and account-change analysis, and final audit review.
- Runs specialist agents concurrently within an individual case; cases in a submitted batch are processed sequentially.
- Added deterministic TypeScript calculations using integer minor currency units for line items, withholding, FX spread, fees, and settlement variance. FX lookup uses the Frankfurter ECB reference-rate service with bundled fallback rates.
- Added a human review breakpoint for risk-bearing cases with approve, reject-and-steer, and stop decisions.
- Added downloadable JSON and text audit outputs, case history, source references, and a financial-use disclaimer. Fee findings can produce a dispute-letter draft; the application does not send letters or initiate payments.
- Added a deterministic demo provider for agent workflow execution without an LLM API key and configurable external LLM provider settings.

### Release and runtime support

- Established the initial preview release as `0.1.0`, added the annotated `v0.1.0` Git tag, and documented release versioning.
- Added application version, source revision, working-tree state, and audit-rules version to the UI, health response, and finalized audit verdicts.
- Updated the production launcher to invoke Next.js through Node, supporting project paths containing spaces.

### Known limitations

- The release is a local demonstration, not a production financial operations system. Cases, queue state, approvals, and reports are held in server memory and are lost on restart. Durable persistence, user authentication, and multi-tenant isolation are not implemented.
- Batch processing is sequential across cases; only specialist agents within one case run concurrently.
- Input handling is format-oriented and does not replace validation against a financial institution's complete production schema. Some payout-only inputs derive an invoice-like comparison record from payout data; source contracts and invoices require independent review.
- Citation checks validate reference presence and basic structure. They do not authenticate source documents or independently prove that every reported field matches its source.
- FX rates require network access when a requested rate is absent from bundled fallback data. Provider-backed LLM execution requires valid provider configuration.
- Use is limited to synthetic or public data. Real bank accounts, live funds movement, and financial decision-making are outside the supported scope.

### Verification recorded for 0.1.0

- `npm run typecheck` passed.
- `npm run build` passed.
- `npm test` passed: 10 tests, including the App Router approval, reject-and-steer, and report flow.
- `npm run cli` completed all six bundled cases using the deterministic demo provider.
- `npm start -- --no-open` started the production build from the project path; `/api/health` reported application version `0.1.0`, source revision `9c2d8e84111e`, a clean working tree, and audit-rules version `0.1.0`.
