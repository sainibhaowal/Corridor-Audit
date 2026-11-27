# CorridorAudit

CorridorAudit is a local preview of a settlement-review workbench built with Next.js and `@mozaik-ai/core`. It accepts supplied invoice, payout, and bank-record data, runs a fixed set of finance-focused agent checks, and presents a reviewable case result. It is not a production financial service and does not send payments or bank disputes.

## Current scope

- Ingests supported CSV, SWIFT MT103 text, camt.053 XML, JSON, pasted text, and PDF text extraction through upload and adapter routes.
- Stores cases, verdicts, and raw-ingestion records in local SQLite. Raw payloads are currently stored as plaintext; a SHA-256 digest is recorded but does not make the record immutable.
- Runs the terms, FX, and wire specialists concurrently within one case. Duplicate/anomaly analysis is conditional, and the auditor starts after expected specialists complete. Cases in a batch are serialized.
- Uses configured LLM inference with deterministic TypeScript tools for the calculations they implement. Source references are structurally checked, not authenticated.
- Offers manual upload, an inbound JSON webhook, an email-adapter JSON route, a local hot folder, and integration sync. Stripe, Wise, QuickBooks Online, and Xero have provider-specific polling/mapping code. Other catalog entries may use a generic JSON endpoint or remain setup placeholders.
- Provides a human review breakpoint and downloadable case reports. Review actions do not transmit funds or contact a bank.

The integration catalog is not a claim of complete, provider-certified connectors. Provider scopes, token renewal, pagination, field coverage, and error handling need provider-specific validation. The local timer and agent queue are in-process. There is no authentication, tenant isolation, distributed durable queue, encrypted raw-payload storage, or production backup/monitoring setup. Use synthetic or public data for local evaluation.

## Architecture and case study

- [Implementation architecture](./docs/ARCHITECTURE.md)
- [Case study overview](./docs/Case%20Study/README.md)
- [Data ingestion and integration limits](./docs/Case%20Study/02-data-ingestion-and-raw-vault.md)
- [Financial calculations and matching limits](./docs/Case%20Study/05-algorithms-and-financial-math.md)
- [Security and data-protection boundaries](./docs/Case%20Study/07-security-hashing-and-data-protection.md)
- [Versioning policy](./docs/VERSIONING.md)
- [Changelog](./CHANGELOG.md)

## Requirements

- Node.js 22.5 or later (the application uses the built-in `node:sqlite` module)
- npm
- A supported, reachable LLM provider configured through System Settings or environment variables to run agent workflows

## Run locally

```bash
git clone https://github.com/sainibhaowal/Corridor-Audit.git
cd Corridor-Audit
npm install
npm run dev
```

The development server binds to `127.0.0.1:3000`. Configure a provider key in System Settings or in a local `.env` file based on `.env.example`. Keep secrets out of source control. The app does not include an offline demo runner or bundled scenario command; `npm run cli` requires an input file and provider configuration.

For PowerShell, copy the environment template with `Copy-Item .env.example .env`.

## Useful commands

```bash
npm run typecheck
npm test
npm run build
npm start -- --no-open
```

`npm start` serves the built app on `127.0.0.1:3000` by default. See [CHANGELOG.md](./CHANGELOG.md) for release-specific verification results.

## Important boundaries

Amounts use integer minor units in many calculations, but FX conversion uses JavaScript `number` arithmetic and `Math.round`; this is not arbitrary-precision accounting. The app does not authenticate source documents, determine legal fee recoverability, verify account ownership, or provide financial/legal advice. Review source records and every finding independently.

## License

MIT. See [LICENSE](./LICENSE).
