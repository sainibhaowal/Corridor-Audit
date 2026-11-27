# Dynamic Execution Layer (`@mozaik-ai/core@6.0.0`)

This document explains how **CorridorAudit** executes audits end-to-end across **Phase 0 (Lead-LLM Planning)**, **Phase 1 (Parallel Subagents)**, **Phase 2 (Verification, Self-Healing & Breakpoint Gate)**, and the **`AgentTraceTree` SSE Stream**.

---

## End-to-End Execution Sequence

```mermaid
sequenceDiagram
    autonumber
    participant UI as Workbench UI (AgentTraceTree)
    participant API as /api/audit/upload + /api/events
    participant ORCH as CorridorOrchestrator
    participant LEAD as AuditorAgent (Lead LLM)
    participant SUBS as Subagents (Terms / FX / Wire / Anomaly)
    participant TOOLS as Deterministic TypeScript Tools (money.ts)
    participant GATE as SettlementGateInterceptionHandler

    UI->>API: Upload / Drag-and-Drop / Webhook / Email
    API->>ORCH: Normalize -> SettlementCase -> publish("case.queued")
    ORCH->>LEAD: Phase 0: onCaseQueuedPlan wakes AuditorAgent
    LEAD->>ORCH: delegate_subagents(caseId, roles, rationale)
    Note over LEAD: Stops planning turn & waits
    ORCH-->>UI: SSE: phase.changed + barrier ("Waiting on N subagents...")
    ORCH->>SUBS: publish("subagents.delegated")

    par Hired Subagents Run Concurrently
        SUBS->>TOOLS: Call deterministic tools (ECB, Mod-97, integer cents)
        TOOLS-->>SUBS: Exact integer results + SourceRef[]
        SUBS-->>ORCH: Save encrypted checkpoint (case_checkpoints)
        SUBS-->>UI: SSE: Thinking + Tool-Call Args/Results (ms)
    end

    ORCH->>LEAD: All hired roles ready -> publish("specialist.ready")
    LEAD->>TOOLS: verify_settlement_balance + verify_citations_integrity
    alt Missing or inconsistent subagent output
        LEAD->>ORCH: rerun_specialist_agent(caseId, role, feedback)
        Note over LEAD: Stops turn & waits for single subagent
        ORCH->>SUBS: publish("specialist.rerun") -> re-runs only that role
    end
    LEAD->>TOOLS: simulate_corridor_replay + finalize_settlement_action
    alt Risky case (OUR breach / variance / duplicate)
        TOOLS->>GATE: Pause at Human Review Breakpoint
        GATE-->>UI: SSE: breakpoint.paused (Approve / Reject+Steer / Stop)
    end
    TOOLS-->>UI: SSE: audit.verdict -> Summary Charts, Trace Waterfall, PDF/CSV/TXT/JSON
```

---

## 1. Phase 0 — Lead-LLM Dynamic Planning (`onCaseQueuedPlan`)
- When a case arrives (`case.queued`), `CorridorState.registerCase()` initializes `expectedRolesByCaseId` as empty (unless checkpoints are restored from SQLite).
- **`AuditorAgent`** (`src/runtime/agents/corridor-agents.ts`) wakes first, reads the normalized case summary, and calls **`delegate_subagents({ caseId, roles, rationale })`** (`src/runtime/tools/audit-tools.ts`) to hire only the needed roles (`"terms"`, `"fx"`, `"wire"`, `"anomaly"`).
- `AuditorAgent` immediately stops its planning turn and waits.

---

## 2. Phase 1 — Parallel Subagent Execution (`subagents.delegated`)
- Hired subagents wake simultaneously in isolated `ModelContext`s and write only to their own per-role slot in `CorridorState` (`termsByCaseId`, `fxByCaseId`, `wireByCaseId`, `anomalyByCaseId`) — eliminating race conditions.
- **Zero LLM Arithmetic:** Subagents decide *which* tools to invoke; deterministic TypeScript tools (`src/core/money.ts`) perform 100% of the currency math and ECB lookups.
- As each subagent finishes, `trajectory-observer.ts` persists an **AES-256-GCM encrypted checkpoint** to SQLite (`case_checkpoints`) so retries/restarts never repeat finished work.

---

## 3. Phase 2 — Barrier, Targeted Self-Healing & Breakpoint Gate
- **`onAllSpecialistsReady`** triggers `AuditorAgent` once every hired role is present in `findingsByRole`.
- `AuditorAgent` runs `verify_settlement_balance` and `verify_citations_integrity`:
  - If satisfied → proceeds directly to `simulate_corridor_replay` and `finalize_settlement_action`.
  - If a specialist failed or missed evidence → calls `rerun_specialist_agent(caseId, role, feedback)` (tracking `previousFeedbacks` with no hard retry cap; `AuditorAgent` waits and decides when to stop).
- High-risk verdicts pause at `SettlementGateInterceptionHandler` (`Approve`, `Reject & Steer`, `Stop`) before publishing `AuditVerdict`.

---

## 4. Live UI Representation (`AgentTraceTree`)
- **`src/components/agent-trace-tree.tsx`** renders the live SSE stream as a collapsible tree:
  - Root summary toggle (`Working (Xs)...` → `Worked for Xs · N agents, M tools, K thoughts`) + `Expand all` / `Collapse all`.
  - Live parallel barrier row (`Waiting on N subagents (done/total joined)...`).
  - Expandable `Subagent` / `Lead Agent` branches with nested `Thinking` and `ARGS` / `RESULT` tool-call cards.
