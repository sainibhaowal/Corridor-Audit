# Changelog

CorridorAudit release history. Versions follow the policy in [docs/VERSIONING.md](docs/VERSIONING.md). Each release entry records the application scope and verified behavior at that release; it is not limited to files changed in the release commit.

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
