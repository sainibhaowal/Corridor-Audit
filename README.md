<p align="center">
  <img src="./public/banner.svg" alt="CorridorAudit - Cross-Border Settlement &amp; Hidden-Fee Forensics" width="100%" />
</p>

<p align="center">
  <strong>Cross-Border Settlement, FX Spread &amp; Hidden-Fee Forensics powered by Concurrent Mozaik Agents</strong>
</p>

<p align="center">
  <a href="https://build.jigjoy.ai/">JigJoy Black Friday AI Hackathon</a> ·
  Built on <code>@mozaik-ai/core@6.0.0</code> ·
  Integer-Cents Math ·
  ECB Mid-Market Verification
</p>

---

> [!NOTE]
> **Local Preview & Scope:** CorridorAudit is a local settlement-review workbench built with Next.js, SQLite (`node:sqlite`), and `@mozaik-ai/core`. It ingests supplied invoice, payout, and bank-record data, compares FX rates against public European Central Bank reference rates (`api.frankfurter.app`), and produces reviewable case verdicts and draft dispute letters. It does **not** transmit payments, authenticate source documents, or provide financial or legal advice. See [CHANGELOG.md](./CHANGELOG.md) and [Versioning Policy](./docs/VERSIONING.md).

---

## End-to-End Case Study & Architecture Blueprint

Read the complete technical & product Case Study in **[`docs/Case Study/`](./docs/Case%20Study/README.md)**:

| Case Study Module | What It Covers |
| :--- | :--- |
| **[Case Study Home](./docs/Case%20Study/README.md)** | Executive summary, navigation tiles & full blueprint |
| **[01 · Problem Statement](./docs/Case%20Study/01-problem-statement.md)** | Why cross-border payouts leak 3%–7% across B2C & B2B |
| **[02 · Data Ingestion & Raw Vault](./docs/Case%20Study/02-data-ingestion-and-raw-vault.md)** | 5 ingestion channels, integration adapters, SHA-256 digests & `raw_ingestions` |
| **[03 · System Architecture & Pipeline](./docs/Case%20Study/03-system-architecture-and-pipeline.md)** | Full Input → Vault → Mozaik → Gate → Output blueprint & sequence diagram |
| **[04 · Mozaik 4+1 Agent System](./docs/Case%20Study/04-mozaik-4-plus-1-agents.md)** | 4+1 concurrent agents, `CorridorState` slots, `DynamicEndpointRouter` & breakpoints |
| **[05 · Financial Math & Algorithms](./docs/Case%20Study/05-algorithms-and-financial-math.md)** | Integer minor-unit math, Cent-Conservation Equation, FX bps & Mod-97 |
| **[06 · Outputs, Disputes & ROI](./docs/Case%20Study/06-outputs-disputes-and-roi.md)** | Worked `€5,000` EUR→USD example, dispute letters & B2C/B2B ROI |
| **[07 · Security, Hashing & Data Protection](./docs/Case%20Study/07-security-hashing-and-data-protection.md)** | Security boundaries, HMAC-SHA256 webhooks, SHA-256 fingerprints & data-protection controls |
| **[Implementation Architecture](./docs/ARCHITECTURE.md)** | Module-by-module codebase & runtime implementation notes |

![CorridorAudit Production Architecture Blueprint](./docs/Case%20Study/assets/architecture-blueprint.svg)

---

## What It Does

Global SMBs, remote freelancers (`Upwork` / `Wise` / `Payoneer`), and fintech merchants (`Stripe` / checkout) lose **3% to 10%** on cross-border payouts to hidden FX spread markups, unexpected correspondent "lifting fees," ISO 20022 repair fees, duplicate wires, and stripped remittance references.

**CorridorAudit** ingests invoices and bank/platform payout files (`.csv`, `.txt` SWIFT MT103, `.xml` ISO 20022 `camt.053`, `.pdf`, `.json`, raw paste, webhooks, and `./data/inbox/` hot folder) and deploys **up to 5 concurrent Mozaik agents** (`@mozaik-ai/core@6.0.0`) backed by deterministic TypeScript tools to:

1. Isolate **hidden FX spread** against official European Central Bank (ECB) mid-market rates on the exact settlement value date.
2. Catch **unexpected fee deductions** (e.g., SWIFT `:71G:` receiver fees deducted when contract/wire specifies `:71A:OUR`).
3. Detect **ISO 13616 IBAN Mod-97 & SWIFT BIC checksum issues** that trigger repair fees, plus **unexplained short-pay variances**.
4. Match **orphaned wires** whose remittance reference (`:70:`) was stripped in transit using deterministic sender/date/amount scoring.
5. Flag **duplicate wires & beneficiary bank changes** (BEC risk) via conditional `DuplicateAnomalyAgent`.
6. Check **cent-conservation** (`ECB Mid-Market - FX Spread - Fees - Tax - Net Landed == Unexplained Variance`) with structured `SourceRef[]` citations and pause at an **interruptible Mozaik `InterceptionHandler` breakpoint** (`Approve`, `Reject & Steer`, `Stop`) before generating a downloadable draft bank dispute letter.

---

## Multi-Agent Concurrency Architecture (`@mozaik-ai/core@6.0.0`)

```mermaid
flowchart LR
    IN["CSV / MT103 / CAMT.053 / PDF / Webhook"] -->|case.queued| BUS["Mozaik Runtime\nCorridorState (RuntimeState)"]
    BUS -->|parallel| A1["TermsAgent\n(Contract, IBAN, Tax, OUR)"]
    BUS -->|parallel| A2["FxBenchmarkAgent\n(ECB Rate & FX Spread)"]
    BUS -->|parallel| A3["WireDetectiveAgent\n(Fees & Orphan Match)"]
    BUS -.->|conditional parallel| A4["DuplicateAnomalyAgent\n(Duplicates & BEC Guard)"]
    A1 & A2 & A3 & A4 -->|CorridorState + *.ready| A5["AuditorAgent\n(Cent-Proof Cross-Check)"]
    A5 -->|finalize_settlement_action| BP["SettlementGateInterceptionHandler\n(Pause / Approve / Reject+Steer / Stop)"]
    BP --> OUT["3-Panel Workbench UI + Proof Overlay + Draft Dispute Letter (.txt)"]
```

### How Agents Run Concurrently
- All agents join a single shared `CorridorState` (`defineRuntime<CorridorState>()`).
- When `case.queued` fires, `TermsAgent`, `FxBenchmarkAgent`, `WireDetectiveAgent` (and `DuplicateAnomalyAgent` when duplicate/BEC triggers hit) wake **simultaneously** in non-blocking `runLoop(...)` executions and write into isolated per-role state slots (`termsByCaseId`, `fxByCaseId`, `wireByCaseId`, `anomalyByCaseId`).
- Once all claimed parallel roles finish (`expectedRolesByCaseId`), **`AuditorAgent`** reactively triggers, verifies integer-cents balance and `SourceRef[]` structure, replays optimal corridor savings, and pauses via **`SettlementGateInterceptionHandler`** when an `OUR` fee breach, unexplained variance, or duplicate wire is detected.

---

## Quickstart (Runs in < 60 Seconds)

### Prerequisites
- **Node.js 22.5 or later** (uses built-in `node:sqlite`)
- **npm**

### 1. Install & Configure Any LLM Provider
```bash
git clone https://github.com/sainibhaowal/Corridor-Audit.git
cd Corridor-Audit
npm install
cp .env.example .env
```

For PowerShell, copy the environment template with `Copy-Item .env.example .env`. Add **any one** API key inside `.env` (or configure directly inside the Web UI via **System Settings** with live `/models` auto-discovery):

| Provider | `.env` Setting | Free Tier? |
|---|---|---|
| **NVIDIA NIM** | `LLM_PROVIDER=nvidia` + `NVIDIA_API_KEY=...` | Yes |
| **Google Gemini** | `LLM_PROVIDER=gemini` + `GEMINI_API_KEY=...` | Yes (AI Studio) |
| **Groq** | `LLM_PROVIDER=groq` + `GROQ_API_KEY=...` | Yes |
| **OpenRouter** | `LLM_PROVIDER=openrouter` + `OPENROUTER_API_KEY=...` | Yes (`:free`) |
| **OpenAI** | `OPENAI_API_KEY=...` *(auto-detected)* | Paid |
| **Anthropic** | `ANTHROPIC_API_KEY=...` *(auto-detected)* | Paid |
| **Ollama (Local)** | `LLM_PROVIDER=ollama` + `OLLAMA_MODEL=llama3.2` | Free Local |

### 2. Run
```bash
npm run dev        # Launch Next.js dev server at http://127.0.0.1:3000
npm start -- --no-open   # Serve built app on http://127.0.0.1:3000
```
Or run build, CLI, and verification checks:
```bash
npm run typecheck  # Runs TypeScript compiler check
npm test           # Runs unit + API tests
npm run build      # Builds Next.js production bundle
npm run cli -- <input-file>   # Runs CLI audit against a supplied input file
```

---

## Data Sources & Verification
- **Public FX Benchmark:** Live [Frankfurter ECB API](https://api.frankfurter.app) (`0` API key required) with automatic fallback to `data/fallback-rates.json`.
- **Integer Minor-Unit Arithmetic:** Money calculations run in integer minor units (`src/core/money.ts`); FX conversion uses JavaScript `number` arithmetic with `Math.round`.
- **Important Boundaries:** The app does not authenticate source documents, verify account ownership, transmit funds, or provide financial/legal advice.

---

## License
MIT. See [LICENSE](./LICENSE).
