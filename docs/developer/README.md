# CorridorAudit Developer Engineering Documentation

Welcome to the **CorridorAudit** technical engineering reference. These documents are grounded directly in the TypeScript codebase (`src/`), SQLite schema (`src/core/db/schema.ts`), Mozaik runtime (`@mozaik-ai/core@6.0.0`), and test suite (`tests/`).

## System Architecture Overview

```mermaid
flowchart TB
    subgraph Ingress["1. Ingress & Adapters (src/app/api + src/core/ingest)"]
        U["POST /api/audit/upload\n(CSV, MT103, CAMT.053, PDF, JSON)"]
        W["POST /api/webhooks/inbound\n(HMAC-SHA256 / Stripe Sig)"]
        E["POST /api/webhooks/email\n(Email Attachments + ClamAV)"]
        HF["Hot Folder ./data/inbox/\n(fs.watch)"]
        SY["Provider Sync Workers\n(Stripe, Wise, QBO, Xero)"]
    end

    subgraph Vault["2. Persistence & Vault (src/core/db + src/core/security)"]
        DB[("SQLite WAL\n17 Tables")]
        AES["AES-256-GCM Vault\n(CORRIDOR_VAULT_KEY)"]
        LOG["Tamper-Evident\nworkspace_audit_log"]
    end

    subgraph Runtime["3. Mozaik 4+1 Runtime (src/runtime)"]
        ORCH["CorridorOrchestrator\n(Durable Queue + Retries)"]
        P1["Phase 1 Parallel Specialists\nTerms | FX | Wire | Anomaly"]
        P2["Phase 2 Reactive Cross-Check\nAuditorAgent"]
        GATE["SettlementGateInterceptionHandler\n(Approve / Reject+Steer / Stop)"]
    end

    subgraph Output["4. Outputs & In-Built Preview (src/core/reports + UI)"]
        EXP["/api/report/[caseId]?format=pdf|csv|txt|json&preview=1"]
        UI["Next.js 15 Workbench\nSummary + Case Inspector Preview"]
    end

    U & W & E & HF & SY --> AES --> DB
    DB --> ORCH --> P1 --> P2 --> GATE --> DB
    DB --> EXP --> UI
    DB --> LOG
```

---

## Developer Reference Modules

| Document | Scope |
| :--- | :--- |
| **[API Endpoints Reference](./api-reference.md)** | All 29 `/api/*` route files, HTTP methods, RBAC roles, request/response contracts, and `?format=pdf\|csv\|txt\|json&preview=1` |
| **[Database Schema & Vault](./database-schema.md)** | All 17 SQLite tables, columns, foreign keys, leases, WAL backup, and AES-256-GCM encryption boundaries |
| **[Codebase Module Map](./module-map.md)** | Complete file-by-file map of `src/core/`, `src/runtime/`, `src/components/`, `src/operations/`, and `tests/` |
| **[Environment & Security Config](./env-and-security.md)** | Every `.env` variable, Cognito/local RBAC, SSRF DNS pinning, webhook signatures, and ClamAV scanning |
| **[Bug Fixes — 2026-11-27](./bug-fixes-2026-11-27.md)** | Root-cause analysis, code diffs, and verification for six production-affecting UI/runtime/export bugs fixed for hackathon submission |

---

## Related Documentation
- **Product & Judge Case Study:** [`docs/Case Study/README.md`](../Case%20Study/README.md)
- **Implementation Architecture:** [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md)
- **Production Operations & Status:** [`docs/production/README.md`](../production/README.md)
- **Versioning & Changelog:** [`docs/VERSIONING.md`](../VERSIONING.md) · [`CHANGELOG.md`](../../CHANGELOG.md)
