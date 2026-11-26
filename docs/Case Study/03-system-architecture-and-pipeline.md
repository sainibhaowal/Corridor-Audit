# 03 · End-to-End System Architecture & Processing Pipeline

## 1. Infographic Architecture Blueprint

![CorridorAudit Production Architecture Blueprint](./assets/architecture-blueprint.svg)

---

## 2. End-to-End Pipeline Sequence

```mermaid
sequenceDiagram
    autonumber
    actor User as B2C User / B2B Employee / Platform
    participant Ingest as Ingestion Route / Sync Worker
    participant Vault as SQLite Raw Vault (raw_ingestions)
    participant Norm as Multi-Format Normalizer
    participant Mozaik as Mozaik Runtime (4+1 Agents)
    participant Tools as 20 Deterministic TS Tools + ECB API
    participant Gate as SettlementGateInterceptionHandler
    participant UI as Live Workbench & Reports

    User->>Ingest: Upload file / Webhook / Email / Platform Sync
    Ingest->>Vault: saveRawIngestion() + SHA-256 checksum
    Ingest->>Norm: normalizeInboundPayloadToCases()
    Norm-->>Vault: updateRawIngestionOutcome(caseIds, parsed)
    Ingest->>Mozaik: enqueueBatch(cases) -> publishCorridorEvent("case.queued")

    par 4 Parallel Specialists
        Mozaik->>Tools: TermsAgent (IBAN Mod-97, WHT, OUR check)
        Mozaik->>Tools: FxBenchmarkAgent (ECB rate, FX spread bps)
        Mozaik->>Tools: WireDetectiveAgent (:71G: fees, orphan match)
        Mozaik->>Tools: DuplicateAnomalyAgent (duplicate vs split, BEC)
    end

    Mozaik->>Mozaik: Reactive Barrier waits for all expected specialists
    Mozaik->>Tools: AuditorAgent (Cent conservation + Optimal Rail Replay)
    Tools-->>Gate: Risky finding? (OUR > 0, variance != 0, duplicate, BEC)
    Gate-->>UI: Pause & emit breakpoint.paused (SSE)
    User->>Gate: Approve / Reject & Steer / Stop
    Gate-->>Mozaik: Resume & finalize_settlement_action()
    Mozaik-->>Vault: saveAuditVerdict(verdict)
    Mozaik-->>UI: Stream verdict_ready + Dispute Letter
```

---

## 3. Hybrid Design Principle: Why Deterministic Tools + Mozaik AI?

| Responsibility | Handled By | Why? |
| :--- | :--- | :--- |
| **Currency math, FX spread bps, tax, IBAN Mod-97** | **Deterministic TypeScript (`src/core/money.ts`)** | LLMs must **never** do financial arithmetic; integer minor-unit math guarantees zero rounding drift. |
| **Unstructured parsing, reasoning, steering, dispute letters** | **Mozaik AI Agents (`@mozaik-ai/core`)** | Handles messy PDFs, stripped `:70:` remittance hints, plain-English explanations, and human "Reject & Steer" overrides. |
| **Live Model Routing & Auto-Discovery** | **`DynamicEndpointRouter`** | Supports NVIDIA NIM, Gemini, Groq, OpenRouter, OpenAI, Anthropic, and Ollama with live `/models` discovery. |
