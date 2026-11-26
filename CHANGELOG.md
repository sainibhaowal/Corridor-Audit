# Changelog

Release history for CorridorAudit. Versions follow the process in [docs/VERSIONING.md](docs/VERSIONING.md). The `0.1.0` entry describes the complete app at that tag; its final items describe the release/versioning work that established the tag.

## [0.1.0] - 2026-11-26

First versioned preview of CorridorAudit, a local demonstration app for reconciling cross-border payout records and investigating potential FX, fee, duplicate, and short-pay issues. It is designed for the JigJoy Agents in Finance hackathon and uses synthetic or public data.

### App and workflow

- Built the product as a real Next.js 15 App Router application in TypeScript, with React, Tailwind CSS, and reusable shadcn-style UI primitives.
- Added a three-panel workspace for live agent activity, case results and artifacts, plus a corridor summary and ledger.
- Added inbound upload and paste workflows for invoice and payout CSV, SWIFT MT103 text, ISO 20022 camt.053 XML, JSON, and PDF text extraction; also added an inbound webhook and local `data/inbox` watcher.
- Added six bundled synthetic scenarios covering a clean settlement, OUR fee deduction, unexplained short pay, orphaned wire, duplicate wire, and platform FX markup.

### Reconciliation and review

- Added Mozaik agents for contract and invoice terms, FX benchmarking, wire and fee analysis, conditional duplicate/account-change checks, and final audit review.
- Specialists run concurrently within a case; the auditor runs after their findings are ready. Cases in an enqueued batch are processed one at a time.
- Added deterministic TypeScript calculations in integer minor units for line items, withholding, FX spread, fees, and settlement variance. The FX lookup uses the Frankfurter ECB reference-rate service with a bundled fallback.
- Added a risk-only human breakpoint with approve, reject-and-steer, and stop decisions. A completed fee finding can produce a downloadable dispute-letter draft; the app does not send the letter or initiate payments.
- Added JSON and text audit exports, case history, source references, and a not-financial-advice disclaimer.
- Added a deterministic demo provider so the agent workflow can run without an LLM API key, plus configurable external LLM provider settings.

### Release and run support

- Set the initial preview release to `0.1.0`; added an annotated `v0.1.0` Git tag and release guidance.
- Added app version, source revision, working-tree state, and audit-rules version to the UI, health response, and finalized audit verdicts.
- Fixed the production launcher to invoke Next.js through Node so `npm start` works when the project path contains spaces.

### Known limits in this preview

- This is a local demonstration, not a production financial operations system. Cases, queue state, approvals, and reports live in server memory and are lost when the server restarts. There is no durable database, user authentication, or multi-tenant isolation.
- The batch queue serializes cases; only the specialist agents for an individual case run in parallel.
- Input parsing is format-oriented and not a substitute for validating a bank's complete production schema. Some payout-only formats derive an invoice-like comparison record from the payout itself; verify the original contract and invoice before relying on a result.
- Citation integrity checks the presence and basic shape of references; it does not independently authenticate source documents or prove that every reported field matches the original file.
- FX rates require network access when the requested rate is not available in the bundled fallback data. Provider-backed LLM mode also needs a working provider configuration.
- Use only synthetic or public data. Do not connect real bank accounts or use the output to move money or make financial decisions.

### Verification recorded for 0.1.0

- `npm run typecheck` passed.
- `npm run build` passed.
- `npm test` passed: 10 tests, including the App Router approval/reject-and-steer/report flow.
- `npm run cli` completed all six bundled cases with the deterministic demo provider.
- `npm start -- --no-open` started the production build from this workspace path; `/api/health` reported version `0.1.0`, source revision `9c2d8e84111e`, a clean tree, and audit-rules version `0.1.0`.

