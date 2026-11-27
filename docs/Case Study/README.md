# CorridorAudit — End-to-End Engineering & Product Case Study

> [!IMPORTANT]
> **CorridorAudit** is a local settlement-review prototype built on **Next.js 15 (TypeScript)** and **Mozaik (`@mozaik-ai/core@6.0.0`)**. It demonstrates a finance-specific audit flow using supplied records and public ECB reference data.

---

## Case Study Navigation Tiles

| Module | Focus Area | Key Artifacts & Visuals |
| :--- | :--- | :--- |
| **[01. Problem Statement](./01-problem-statement.md)** | Problem framing and illustrative settlement examples | Example case, personas and assumptions |
| **[02. Data Ingestion & Raw Vault](./02-data-ingestion-and-raw-vault.md)** | Ingestion paths, connector coverage, credential vault & `raw_ingestions` | Channel diagram, provider table, raw ingestion details |
| **[03. System Architecture & Pipeline](./03-system-architecture-and-pipeline.md)** | Ingestion, normalization, agent stages, review and outputs | Architecture SVG + Mermaid sequence and flow |
| **[04. Mozaik Agent System](./04-mozaik-4-plus-1-agents.md)** | Agent roles, `CorridorState`, conditional anomaly checks and breakpoints | Agent topology SVG and Mermaid state machine |
| **[05. Financial Math & Algorithms](./05-algorithms-and-financial-math.md)** | Minor-unit calculations, reconciliation equation, Mod-97, FX bps | Formulas, waterfall SVG and algorithm descriptions |
| **[06. Outputs, Disputes & ROI](./06-outputs-disputes-and-roi.md)** | Example outputs, illustrative EUR-to-USD case, draft dispute letter and operating considerations | Example ledger, draft letter and ROI considerations |
| **[07. Security, Hashing & Data Protection](./07-security-hashing-and-data-protection.md)** | Credential encryption, configurable webhook signatures, SHA-256 fingerprints and account-change signals | Security SVG, webhook sequence and implementation limits |

---

## System Blueprint at a Glance

![CorridorAudit Implementation and Integration Map](./assets/architecture-blueprint.svg)

---

## Executive Snapshot (Implemented Controls and Limits)

| Control | Current Behavior | Where in Code |
| :--- | :--- | :--- |
| **Deterministic Audit Calculations** | Reconciliation tools compute amounts and variance in TypeScript; agent choices and narrative remain model-driven | [`src/core/money.ts`](../../src/core/money.ts) |
| **Raw Ingestion Records** | Supported routes store submitted content and a SHA-256 digest before parsing; records are not immutable and raw content is not encrypted | [`src/core/db/database.ts`](../../src/core/db/database.ts) |
| **Concurrent Mozaik Agents** | Three specialists run per case, anomaly analysis is conditional, the auditor follows expected specialists, and separate cases are serialized | [`src/runtime/agents/corridor-agents.ts`](../../src/runtime/agents/corridor-agents.ts) |
| **Human Review Breakpoint** | The handler can pause a proposed action; auto-approval is configurable and no bank payment is controlled | [`src/runtime/interception/`](../../src/runtime/interception/) |
| **Configurable Model Providers** | Provider routing is available; key validity and model discovery depend on each provider and endpoint | [`src/core/llm/providers.ts`](../../src/core/llm/providers.ts) |
| **Encrypted Credential Storage** | Stored integration credentials use AES-256-GCM; webhook HMAC checks are available and signature enforcement is configurable | [`src/core/security/vault.ts`](../../src/core/security/vault.ts) |
