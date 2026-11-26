<p align="center">
  <img src="./src/server/public/banner.svg" alt="CorridorAudit — Cross-Border Settlement &amp; Hidden-Fee Forensics" width="100%" />
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
> **Compliance & Disclaimer:** All bundled scenarios use synthetic datasets and public European Central Bank reference rates (`api.frankfurter.app`). No real customer data, real bank accounts, or live money transfers are used. Output is for operational reconciliation demonstration only and **is not financial or legal advice**.

---

## What It Does

Global SMBs, remote freelancers (`Upwork` / `Wise` / `Payoneer`), and fintech merchants (`Stripe` / checkout) lose **3% to 10%** on cross-border payouts to hidden FX spread markups, unexpected correspondent "lifting fees," ISO 20022 repair fees, duplicate wires, and stripped remittance references.

**CorridorAudit** ingests invoices and bank/platform payout files (`.csv`, `.txt` SWIFT MT103, `.xml` ISO 20022 `camt.053`, `.pdf`, `.json`, raw paste, webhooks, and `./data/inbox/` hot folder) and deploys **up to 5 concurrent Mozaik agents** (`@mozaik-ai/core@6.0.0`) backed by **20 deterministic TypeScript tools** to:

1. Isolate **hidden FX spread** against official European Central Bank (ECB) mid-market rates on the exact settlement value date.
2. Catch **wrongful fee deductions** (e.g., SWIFT `:71G:` receiver fees deducted when contract/wire specifies `:71A:OUR`).
3. Detect **ISO 13616 IBAN Mod-97 & SWIFT BIC checksum issues** that trigger repair fees, plus **unexplained short-pay variances**.
4. Match **orphaned wires** whose remittance reference (`:70:`) was stripped in transit using deterministic sender/date/amount scoring.
5. Flag **duplicate wires & beneficiary bank changes** (BEC risk) via conditional `DuplicateAnomalyAgent`.
6. Prove every cent (`ECB Mid-Market - FX Spread - Fees - Tax - Net Landed == Unexplained Variance`) with clickable `SourceRef[]` proofs and pause at an **interruptible Mozaik `InterceptionHandler` breakpoint** (`Approve`, `Reject & Steer`, `Stop`) before generating a downloadable bank dispute letter.

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
    BP --> OUT["Pure-White 3-Panel UI + Technical Proof Overlay + Dispute Letter (.txt)"]
```

### How Agents Run Concurrently
- All agents join a single shared `CorridorState` (`defineRuntime<CorridorState>()`).
- When `case.queued` fires, `TermsAgent`, `FxBenchmarkAgent`, `WireDetectiveAgent` (and `DuplicateAnomalyAgent` when duplicate/BEC triggers hit) wake **simultaneously** in non-blocking `runLoop(...)` executions and write into isolated per-role state slots (`termsByCaseId`, `fxByCaseId`, `wireByCaseId`, `anomalyByCaseId`).
- Once all claimed parallel roles finish (`expectedRolesByCaseId`), **`AuditorAgent`** reactively triggers, verifies zero-drift integer-cents balance and `SourceRef[]` integrity, replays optimal corridor savings, and pauses via **`SettlementGateInterceptionHandler`** when an `OUR` fee breach, unexplained variance, or duplicate wire is detected.

---

## Quickstart (Runs in < 60 Seconds)

### Prerequisites
- **Node.js 20+**

### 1. Install & Configure Any LLM Provider (or Run Out-of-the-Box in Demo Mode)
```bash
git clone https://github.com/sainibhaowal/Corridor-Audit.git
cd Corridor-Audit
npm install
cp .env.example .env
```

Add **any one** API key inside `.env` (or configure directly inside the Web UI via **⚙ AI Model / API Key** — if no key is set, `CorridorAudit` automatically runs in offline-safe **Deterministic Demo Runner** mode executing all 5 agents and 20 TypeScript tools):

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
npm start          # Boots unified server & Web Dashboard at http://127.0.0.1:3000
```
Or run headless terminal mode & unit tests:
```bash
npm run cli        # Runs all 6 synthetic Black Friday cases end-to-end in CLI
npm test           # Runs unit + HTTP/SSE end-to-end tests
npm run typecheck  # Runs TypeScript compiler check
```

---

## Data Sources & Verification
- **Bundled Synthetic Scenarios (`data/`):** 6 realistic multi-corridor cases (clean match, `:71A:OUR` fee violation + hidden 4.50% FX spread, invalid IBAN repair fee + unexplained `€120.00` short-pay, orphaned stripped-`:70:` wire, duplicate wire anomaly, and Upwork platform withdrawal with hidden 3.60% FX markup).
- **Public FX Benchmark:** Live [Frankfurter ECB API](https://api.frankfurter.app) (`0` API key required) with automatic fallback to `data/fallback-rates.json`.
- **Zero LLM Arithmetic:** All money calculations run strictly in integer minor units (`src/core/money.ts`).

---

## License
MIT — see [LICENSE](./LICENSE).
