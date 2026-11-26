const PROVIDER_MODELS = {
  nvidia: "nvidia/nemotron-3.5-super-vl-120b-a12b",
  gemini: "gemini-2.5-flash",
  groq: "llama-3.3-70b-versatile",
  openrouter: "meta-llama/llama-3.3-70b-instruct:free",
  openai: "gpt-5.4",
  anthropic: "claude-haiku-4-5",
  ollama: "llama3.2",
  demo: "deterministic-demo",
};

const appState = {
  view: "stream",
  rightTab: "cases",
  modalTab: "ledger",
  activeCaseId: null,
  modalCaseId: null,
  cases: new Map(), // caseId -> { info, agents: Map, overlaps, pending, verdict, technical, ledger }
  verdicts: [],
  ledgerEvents: [],
  queueStats: { waiting: 0, active: 0, done: 0, failed: 0 },
  provider: { provider: "demo", label: "Demo", modelName: "deterministic-demo", mode: "demo" },
  breakpointMode: "risk_only",
  expandedTools: new Set(),
  showReasoning: new Set(),
  showSteerBox: false,
  selectedProviderInModal: "nvidia",
  rafScheduled: false,
};

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtMoney(minor, ccy = "USD") {
  const digits = ["JPY", "KRW", "VND"].includes((ccy || "").toUpperCase()) ? 0 : ["BHD", "KWD", "OMR"].includes((ccy || "").toUpperCase()) ? 3 : 2;
  const val = (Number(minor || 0) / 10 ** digits).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const sym = { USD: "$", EUR: "€", GBP: "£", JPY: "¥" }[(ccy || "").toUpperCase()];
  return sym ? `${minor < 0 ? "-" : ""}${sym}${val.replace("-", "")}` : `${val} ${ccy}`;
}

function badgeClass(status) {
  if (status === "CLEAN") return "ok";
  if (status === "ORPHAN_MATCHED") return "violet";
  if (status === "VARIANCE_DETECTED" || status === "ABORTED_BY_OPERATOR") return "bad";
  return "warn";
}

function ensureCaseEntry(caseId) {
  let entry = appState.cases.get(caseId);
  if (!entry) {
    entry = {
      caseId,
      info: { caseId, title: caseId, corridor: "", expectedRoles: ["terms", "fx", "wire"] },
      phase: "PHASE 1 · SPECIALISTS IN PARALLEL",
      agents: new Map(),
      overlaps: [],
      pending: null,
      verdict: null,
      technical: null,
    };
    appState.cases.set(caseId, entry);
  }
  return entry;
}

function ensureAgent(entry, agentName) {
  let a = entry.agents.get(agentName);
  if (!a) {
    a = { name: agentName, status: "idle", startedAt: Date.now(), elapsed: "0.0s", thinking: false, reasoning: "", streamText: "", finalText: "", tools: new Map() };
    entry.agents.set(agentName, a);
  }
  return a;
}

function scheduleRender() {
  if (appState.rafScheduled) return;
  appState.rafScheduled = true;
  requestAnimationFrame(() => {
    appState.rafScheduled = false;
    renderHeader();
    renderStreamView();
    renderRightPanel();
    if (appState.view === "summary") renderSummaryView();
  });
}

function handleTrajectoryEvent(evt) {
  const entry = ensureCaseEntry(evt.caseId);
  if (!appState.activeCaseId || appState.activeCaseId === evt.caseId || evt.kind === "case.queued") {
    appState.activeCaseId = evt.caseId;
  }

  if (evt.kind === "phase.changed") {
    if (evt.phase) entry.phase = evt.phase;
    if (evt.payload?.caseInfo) entry.info = evt.payload.caseInfo;
  } else if (evt.kind === "agent.started" && evt.agentName) {
    const a = ensureAgent(entry, evt.agentName);
    a.status = "running";
    a.startedAt = Date.now();
  } else if (evt.kind === "agent.thinking" && evt.agentName) {
    const a = ensureAgent(entry, evt.agentName);
    a.thinking = true;
    a.status = "running";
  } else if (evt.kind === "agent.reasoning" && evt.agentName) {
    const a = ensureAgent(entry, evt.agentName);
    a.reasoning += evt.text || "";
  } else if (evt.kind === "agent.stream" && evt.agentName) {
    const a = ensureAgent(entry, evt.agentName);
    a.thinking = false;
    a.streamText += evt.text || "";
  } else if (evt.kind === "tool.started" && evt.agentName && evt.callId) {
    const a = ensureAgent(entry, evt.agentName);
    a.tools.set(evt.callId, {
      callId: evt.callId,
      toolName: evt.toolName,
      status: "running",
      durationMs: null,
      argsJson: evt.argsJson,
      resultJson: "",
      sourceRefs: [],
    });
  } else if (evt.kind === "tool.completed" && evt.agentName && evt.callId) {
    const a = ensureAgent(entry, evt.agentName);
    const t = a.tools.get(evt.callId) || { callId: evt.callId, toolName: evt.toolName };
    t.status = evt.status || "ok";
    t.durationMs = evt.durationMs ?? 1;
    t.argsJson = evt.argsJson || t.argsJson;
    t.resultJson = evt.resultJson || "";
    t.sourceRefs = evt.sourceRefs || [];
    a.tools.set(evt.callId, t);
  } else if (evt.kind === "agent.completed" && evt.agentName) {
    const a = ensureAgent(entry, evt.agentName);
    a.thinking = false;
    a.status = "done";
    a.elapsed = `${((Date.now() - a.startedAt) / 1000).toFixed(1)}s`;
    a.finalText = evt.text || a.streamText;
  } else if (evt.kind === "overlap.updated" && evt.payload?.overlaps) {
    entry.overlaps = evt.payload.overlaps;
  } else if (evt.kind === "breakpoint.paused" && evt.payload?.pending) {
    entry.pending = evt.payload.pending;
    const a = ensureAgent(entry, "AuditorAgent");
    a.status = "paused";
    appState.showSteerBox = false;
  } else if (evt.kind === "breakpoint.resolved") {
    entry.pending = null;
    const a = ensureAgent(entry, "AuditorAgent");
    a.status = "running";
  } else if (evt.kind === "ledger.entry" && evt.text) {
    appState.ledgerEvents.unshift({ timestamp: evt.timestamp, caseId: evt.caseId, summary: evt.text, tone: evt.status || "ok" });
    if (appState.ledgerEvents.length > 80) appState.ledgerEvents.length = 80;
  } else if (evt.kind === "audit.verdict" && evt.payload?.verdict) {
    entry.verdict = evt.payload.verdict;
    entry.pending = null;
    const idx = appState.verdicts.findIndex((v) => v.caseId === entry.verdict.caseId);
    if (idx >= 0) appState.verdicts[idx] = entry.verdict;
    else appState.verdicts.unshift(entry.verdict);
    void refreshHistory();
  }
  scheduleRender();
}

function renderHeader() {
  const q = appState.queueStats;
  $("queueText").textContent = `Batch: ${q.waiting} wait · ${q.active} active · ${q.done} done`;

  const p = appState.provider;
  const label = p.mode === "demo" ? "Demo · Offline Safe" : `${p.provider.toUpperCase()} · ${p.modelName}`;
  $("providerChipText").textContent = label;
  $("providerChipBtn").title = `${p.label} (${p.modelName})`;
  $("providerChipBtn").className = `provider-chip ${p.mode === "demo" ? "demo" : ""}`;
  $("providerDot").className = `dot ${p.mode === "demo" ? "amber" : ""}`;
  $("gateModeSelect").value = appState.breakpointMode;
}

function renderStreamView() {
  const tabsEl = $("caseTabs");
  const caseList = [...appState.cases.values()];
  tabsEl.innerHTML = caseList
    .map(
      (c) =>
        `<button class="case-tab mono ${c.caseId === appState.activeCaseId ? "active" : ""}" data-case-pick="${escapeHtml(c.caseId)}">${escapeHtml(c.caseId)}${c.pending ? " ⏸" : c.verdict ? " ✓" : ""}</button>`,
    )
    .join("");

  const entry = appState.activeCaseId ? appState.cases.get(appState.activeCaseId) : null;
  if (!entry) {
    $("trailEmpty").classList.remove("hidden");
    $("trailList").classList.add("hidden");
    $("fleetGrid").innerHTML = "";
    $("overlapBar").classList.add("hidden");
    $("approvalMount").innerHTML = "";
    return;
  }

  $("activeCaseTitle").textContent = `${entry.caseId} · ${entry.info.title || "Autonomous Audit"}`;
  if (entry.info.corridor) {
    $("activeCorridorPill").textContent = entry.info.corridor;
    $("activeCorridorPill").classList.remove("hidden");
  }
  const stPill = $("activeStatusPill");
  stPill.classList.remove("hidden");
  if (entry.pending) {
    stPill.className = "pill warn";
    stPill.textContent = "⏸ Paused at Human Gate";
  } else if (entry.verdict) {
    stPill.className = `pill ${badgeClass(entry.verdict.status)}`;
    stPill.textContent = entry.verdict.status.replace(/_/g, " ");
  } else {
    stPill.className = "pill";
    stPill.textContent = entry.phase;
  }

  // Fleet cards
  const orderedNames = ["TermsAgent", "FxBenchmarkAgent", "WireDetectiveAgent", "DuplicateAnomalyAgent", "AuditorAgent"];
  const roleClass = {
    TermsAgent: "role-terms",
    FxBenchmarkAgent: "role-fx",
    WireDetectiveAgent: "role-wire",
    DuplicateAnomalyAgent: "role-anomaly",
    AuditorAgent: "role-auditor",
  };
  const visibleAgents = orderedNames.map((n) => entry.agents.get(n)).filter(Boolean);
  $("fleetGrid").innerHTML = visibleAgents
    .map((a) => {
      const badge =
        a.status === "paused"
          ? `<span class="pill warn">NEEDS YOU</span>`
          : a.status === "done"
            ? `<span class="pill ok">DONE</span>`
            : `<span class="pill">RUNNING</span>`;
      return `<div class="fleet-card ${roleClass[a.name] || ""} ${a.status === "paused" ? "paused" : ""}">
        <div class="fleet-top"><span>${escapeHtml(a.name)}</span>${badge}</div>
        <div class="fleet-meta">${a.tools.size} tool(s) · ${a.status === "done" ? a.elapsed : "active"}</div>
      </div>`;
    })
    .join("");

  // Overlap bar
  if (entry.overlaps.length > 0) {
    $("overlapBar").classList.remove("hidden");
    $("overlapBar").innerHTML =
      `<strong style="font-size:11px;color:var(--text-muted);">CROSS-CHECK:</strong>` +
      entry.overlaps
        .map(
          (o) => `<span class="overlap-pair">
            <span class="overlap-chip">${escapeHtml(o.left)}</span>
            <span class="pill ${o.tone}">${o.relation === "contradicts" ? "⚡ Contradicts" : "✓ In Sync"}</span>
            <span class="overlap-chip">${escapeHtml(o.right)}</span>
          </span>`,
        )
        .join("");
  } else {
    $("overlapBar").classList.add("hidden");
  }

  // Vertical Agent Trail
  $("trailEmpty").classList.add("hidden");
  $("trailList").classList.remove("hidden");
  $("trailList").innerHTML = visibleAgents
    .map((a) => {
      const dotCls = a.status === "paused" ? "paused" : a.status === "done" ? "done" : "running";
      const toolsArr = [...a.tools.values()];
      const toolHtml = toolsArr
        .map((t) => {
          const isOpen = appState.expandedTools.has(t.callId);
          return `<div>
            <button type="button" class="tool-pill ${t.status === "ok" ? "ok" : t.status === "error" ? "error" : ""}" data-toggle-tool="${escapeHtml(t.callId)}">
              ${isOpen ? "▼" : "▸"} ${escapeHtml(t.toolName)} · ${t.durationMs !== null ? `${t.durationMs}ms` : "..."}
            </button>
            ${
              isOpen
                ? `<div class="tool-detail">ARGS:   ${escapeHtml(t.argsJson || "{}")}\nRESULT: ${escapeHtml(t.resultJson || "running...")}</div>`
                : ""
            }
          </div>`;
        })
        .join("");

      const reasoningOpen = appState.showReasoning.has(`${entry.caseId}:${a.name}`);
      const reasoningBtn = a.reasoning
        ? `<button type="button" class="tool-pill" data-toggle-reason="${escapeHtml(entry.caseId)}:${escapeHtml(a.name)}">${reasoningOpen ? "▼" : "▸"} Model Reasoning</button>`
        : "";
      const reasoningBox = a.reasoning && reasoningOpen ? `<div class="reasoning-box">${escapeHtml(a.reasoning)}</div>` : "";
      const text = a.finalText || a.streamText;

      return `<div class="trail-node">
        <span class="trail-dot ${dotCls}"></span>
        <div class="node-head">
          <span class="node-name">${escapeHtml(a.name)}</span>
          ${a.thinking ? `<span class="thinking-pill">◌ Thinking...</span>` : ""}
          ${reasoningBtn}
          <span class="mono" style="margin-left:auto;font-size:11px;color:var(--text-muted);">${a.status === "done" ? a.elapsed : a.status}</span>
        </div>
        ${reasoningBox}
        <div class="tool-pills">${toolHtml}</div>
        ${text ? `<div class="agent-answer">${escapeHtml(text)}</div>` : ""}
      </div>`;
    })
    .join("");

  // Approval Card
  if (entry.pending) {
    const p = entry.pending;
    $("approvalMount").innerHTML = `<div class="approval-card">
      <div class="approval-head">
        <strong style="font-size:14.5px;">⏸ Breakpoint Paused · Human Approval Required</strong>
        <span class="pill warn">${escapeHtml(p.riskLabel)}</span>
      </div>
      <p class="approval-q">"${escapeHtml(p.question)}"</p>
      <div class="approval-proof">${escapeHtml(p.proofLine)}</div>
      <div class="approval-actions">
        <button type="button" class="btn btn-emerald" id="approveGateBtn">✓ Approve Claim [Ctrl+↵]</button>
        <button type="button" class="btn" id="toggleSteerBtn">✕ Reject &amp; Steer [Esc]</button>
        <button type="button" class="btn btn-danger" id="stopGateBtn">■ Stop Case</button>
      </div>
      ${
        appState.showSteerBox
          ? `<div class="steer-row">
              <input id="steerReasonInput" class="input" type="text" placeholder="Type instruction for AuditorAgent (e.g. Client agreed to split fee — treat as SHA)" />
              <button type="button" class="btn btn-primary" id="submitSteerBtn">Send Override</button>
            </div>`
          : ""
      }
    </div>`;
  } else {
    $("approvalMount").innerHTML = "";
  }
}

function renderRightPanel() {
  $("casesCount").textContent = String(appState.verdicts.length);
  const el = $("rightScroll");

  if (appState.rightTab === "cases") {
    if (appState.verdicts.length === 0) {
      el.innerHTML = `<div style="color:var(--text-muted);font-size:12.5px;padding:12px 4px;">Completed case verdicts and dispute artifacts will appear here.</div>`;
      return;
    }
    el.innerHTML = appState.verdicts
      .map((v) => {
        const ccy = v.numbers.settledCurrency;
        const delta =
          v.numbers.recoverableFeeMinor > 0
            ? `Recover: ${fmtMoney(v.numbers.recoverableFeeMinor, ccy)} · FX: -${fmtMoney(v.numbers.fxSpreadLossMinor, ccy)}`
            : v.numbers.unexplainedVarianceMinor !== 0
              ? `Variance: ${fmtMoney(v.numbers.unexplainedVarianceMinor, ccy)}`
              : `Variance: ${fmtMoney(0, ccy)} · FX: ${fmtMoney(v.numbers.fxSpreadLossMinor, ccy)}`;
        return `<div class="history-card ${v.caseId === appState.activeCaseId ? "active" : ""}" data-open-modal="${escapeHtml(v.caseId)}" data-mtab="ledger">
          <div class="history-top">
            <strong class="mono" style="font-size:12.5px;">${escapeHtml(v.caseId)} · ${escapeHtml(v.invoiceId)}</strong>
            <span class="pill ${badgeClass(v.status)}">${escapeHtml(v.status.replace(/_/g, " "))}</span>
          </div>
          <div class="mono" style="font-size:11.5px;color:var(--text-secondary);">${escapeHtml(delta)}</div>
          <div class="history-actions">
            <button type="button" class="btn btn-sm" data-open-modal="${escapeHtml(v.caseId)}" data-mtab="technical">Full Fields</button>
            ${v.disputeNotice ? `<button type="button" class="btn btn-sm" data-open-modal="${escapeHtml(v.caseId)}" data-mtab="letter">Dispute.txt</button>` : ""}
            <a class="btn btn-sm" href="/api/report/${encodeURIComponent(v.caseId)}?format=json" download>JSON</a>
          </div>
        </div>`;
      })
      .join("");
  } else if (appState.rightTab === "artifacts") {
    if (appState.verdicts.length === 0) {
      el.innerHTML = `<div style="color:var(--text-muted);font-size:12.5px;padding:12px 4px;">No downloadable artifacts yet.</div>`;
      return;
    }
    el.innerHTML = appState.verdicts
      .map(
        (v) => `<div class="history-card">
          <strong class="mono">${escapeHtml(v.caseId)}</strong>
          <div class="history-actions">
            <a class="btn btn-sm" href="/api/report/${encodeURIComponent(v.caseId)}?format=txt" download>⬇ Dispute / Cert (.txt)</a>
            <a class="btn btn-sm" href="/api/report/${encodeURIComponent(v.caseId)}?format=json" download>⬇ Full Audit (.json)</a>
          </div>
        </div>`,
      )
      .join("");
  } else {
    if (appState.ledgerEvents.length === 0) {
      el.innerHTML = `<div style="color:var(--text-muted);font-size:12.5px;padding:12px 4px;">Ledger events stream here as agents finalize audits.</div>`;
      return;
    }
    el.innerHTML = appState.ledgerEvents
      .map(
        (l) => `<div style="padding:8px 6px;border-bottom:1px solid var(--bg-subtle);font-size:12px;">
          <div class="mono" style="font-size:10.5px;color:var(--text-dim);">${escapeHtml(l.timestamp.slice(11, 19))} · ${escapeHtml(l.caseId)}</div>
          <div>${escapeHtml(l.summary)}</div>
        </div>`,
      )
      .join("");
  }
}

function formatCurrencyBreakdown(verdicts, selector) {
  const byCcy = new Map();
  for (const v of verdicts) {
    const val = Number(selector(v) || 0);
    if (val === 0) continue;
    const ccy = v.numbers.settledCurrency || "USD";
    byCcy.set(ccy, (byCcy.get(ccy) || 0) + val);
  }
  if (byCcy.size === 0) return "$0.00";
  return [...byCcy.entries()].map(([ccy, amt]) => fmtMoney(amt, ccy)).join(" + ");
}

function renderSummaryView() {
  const vList = appState.verdicts;
  const recoverText = formatCurrencyBreakdown(vList, (v) => v.numbers.recoverableFeeMinor);
  const fxText = formatCurrencyBreakdown(vList, (v) => v.numbers.fxSpreadLossMinor);
  const varCount = vList.filter((v) => v.numbers.unexplainedVarianceMinor !== 0).length;

  $("summaryKpis").innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">Cases Audited</div>
      <div class="kpi-val">${vList.length}</div>
      <div class="kpi-sub">${vList.length === 0 ? "Awaiting batch or upload" : "Cent-proof complete"}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Recoverable Fees</div>
      <div class="kpi-val" style="color:var(--accent-emerald);">${escapeHtml(recoverText)}</div>
      <div class="kpi-sub">Wrongful :71A:OUR deductions</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Hidden FX Spread</div>
      <div class="kpi-val" style="color:var(--status-amber);">${escapeHtml(fxText)}</div>
      <div class="kpi-sub">vs. official ECB mid-market</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Open Variances</div>
      <div class="kpi-val" style="color:${varCount ? "var(--status-red)" : "var(--accent-emerald)"};">${varCount}</div>
      <div class="kpi-sub">${varCount ? "Unexplained short-pay flagged" : "Zero unexplained drift"}</div>
    </div>
  `;

  const tbody = $("summaryTable").querySelector("tbody");
  if (vList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">No completed audits yet — click <strong>Stream 6-Case Batch</strong> in the left sidebar or upload a file in <strong>Inbound Sources</strong>.</td></tr>`;
    return;
  }

  tbody.innerHTML = vList
    .map((v) => {
      const ccy = v.numbers.settledCurrency;
      return `<tr>
        <td class="mono"><strong>${escapeHtml(v.caseId)}</strong><br><span style="color:var(--text-muted)">${escapeHtml(v.invoiceId)}</span></td>
        <td>${escapeHtml(v.wireId)}</td>
        <td class="num">${fmtMoney(v.numbers.fxSpreadLossMinor, ccy)} (${(v.numbers.fxSpreadBps / 100).toFixed(2)}%)</td>
        <td class="num">${fmtMoney(v.numbers.liftingAndRepairFeesMinor + v.numbers.platformFeeMinor, ccy)} / <strong>${fmtMoney(v.numbers.recoverableFeeMinor, ccy)}</strong></td>
        <td class="num">${fmtMoney(v.numbers.unexplainedVarianceMinor, ccy)}</td>
        <td><span class="pill ${badgeClass(v.status)}">${escapeHtml(v.status.replace(/_/g, " "))}</span></td>
      </tr>`;
    })
    .join("");
}

function openCaseModal(caseId, tab = "ledger") {
  appState.modalCaseId = caseId;
  appState.modalTab = tab;
  renderCaseModal();
  $("caseModal").classList.remove("hidden");
}

function renderCaseModal() {
  const entry = appState.cases.get(appState.modalCaseId);
  const v = entry?.verdict || appState.verdicts.find((x) => x.caseId === appState.modalCaseId);
  if (!v) return;

  const ccy = v.numbers.settledCurrency;
  $("modalTitle").textContent = `${v.caseId} · Audit Artifact & Full Technical Inspector`;
  const varPill = $("modalVarianceBadge");
  varPill.textContent = `Variance: ${fmtMoney(v.numbers.unexplainedVarianceMinor, ccy)}`;
  varPill.className = `pill mono ${v.numbers.unexplainedVarianceMinor === 0 ? "ok" : "bad"}`;

  document.querySelectorAll("[data-mtab]").forEach((b) => {
    b.classList.toggle("active", b.dataset.mtab === appState.modalTab);
  });

  if (appState.modalTab === "ledger") {
    $("modalBody").innerHTML = `
      <div class="summary-callout">
        <div style="font-size:11px;font-weight:700;color:var(--accent-emerald);letter-spacing:0.06em;margin-bottom:4px;">PLAIN-ENGLISH VERDICT</div>
        <div>${escapeHtml(v.plainEnglishSummary)}</div>
      </div>
      <div class="card table-wrap">
        <table class="ledger">
          <thead><tr><th>Reconciliation Line Item</th><th class="num">Amount</th><th>Verified SourceRef</th></tr></thead>
          <tbody>
            <tr><td>Invoice Expected (${escapeHtml(v.numbers.invoicedCurrency)})</td><td class="num">${fmtMoney(v.numbers.invoicedMinor, v.numbers.invoicedCurrency)}</td><td class="mono">[INV:${escapeHtml(v.invoiceId)}]</td></tr>
            <tr><td>ECB Mid-Market Equivalent</td><td class="num">${fmtMoney(v.numbers.midMarketEquivalentMinor, ccy)}</td><td class="mono">[ECB:${escapeHtml(entry?.technical?.fx?.rateRecord?.ecbRateDate || "reference")}]</td></tr>
            <tr><td>Bank / Platform Hidden FX Spread (${(v.numbers.fxSpreadBps / 100).toFixed(2)}%)</td><td class="num" style="color:var(--status-amber)">${v.numbers.fxSpreadLossMinor < 0 ? `+${fmtMoney(-v.numbers.fxSpreadLossMinor, ccy)}` : fmtMoney(-v.numbers.fxSpreadLossMinor, ccy)}</td><td class="mono">[FX_SPREAD:${v.numbers.fxSpreadBps}bps]</td></tr>
            <tr><td>Lifting / Repair / Platform Fees</td><td class="num" style="color:var(--status-red)">${fmtMoney(-(v.numbers.liftingAndRepairFeesMinor + v.numbers.platformFeeMinor), ccy)}</td><td class="mono">[WIRE:${escapeHtml(v.wireId)}]</td></tr>
            ${v.numbers.withholdingTaxMinor ? `<tr><td>Withholding Tax (Converted to ${escapeHtml(ccy)})</td><td class="num">${fmtMoney(-v.numbers.withholdingTaxMinor, ccy)}</td><td class="mono">[TAX:${escapeHtml(v.invoiceId)}]</td></tr>` : ""}
            <tr><td>Net Cash Landed</td><td class="num" style="color:var(--accent-emerald)"><strong>${fmtMoney(v.numbers.settledMinor, ccy)}</strong></td><td class="mono">[:32A:/SETTLED]</td></tr>
            <tr><td><strong>Unexplained Variance</strong></td><td class="num"><strong>${fmtMoney(v.numbers.unexplainedVarianceMinor, ccy)}</strong></td><td class="mono">${v.sourceRefs.length} SourceRefs</td></tr>
          </tbody>
        </table>
      </div>
      <div class="grid-2">
        <div class="card">
          <strong style="font-size:12px;color:var(--text-muted);">RAW SOURCE PROOF EXCERPTS</strong>
          <div class="raw-pre" style="margin-top:8px;">${escapeHtml(v.sourceRefs.map((r) => `[${r.sourceType}:${r.recordId}:${r.field}] ${r.rawExcerpt}`).join("\n"))}</div>
        </div>
        <div class="card">
          <strong style="font-size:12px;color:var(--text-muted);">CORRIDOR LEAK REPLAY &amp; EXPORTS</strong>
          <p style="margin:10px 0;">Actual landed: <strong class="mono">${fmtMoney(v.replay.actualNetMinor, ccy)}</strong> vs. Transparent ECB route: <strong class="mono" style="color:var(--accent-emerald)">${fmtMoney(v.replay.optimalTransparentNetMinor, ccy)}</strong></p>
          <div class="pill ok mono" style="margin-bottom:14px;">Total Preventable + Recoverable Leak: ${fmtMoney(v.replay.totalLeakMinor, ccy)} (${(v.replay.totalLeakBps / 100).toFixed(2)}%)</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <a class="btn btn-primary" href="/api/report/${encodeURIComponent(v.caseId)}?format=txt" download>⬇ Dispute Letter (.txt)</a>
            <a class="btn" href="/api/report/${encodeURIComponent(v.caseId)}?format=json" download>⬇ Export Full Audit (.json)</a>
          </div>
        </div>
      </div>`;
  } else if (appState.modalTab === "technical") {
    $("modalBody").innerHTML = `<div class="raw-pre">${escapeHtml(JSON.stringify(entry?.technical || v, null, 2))}</div>`;
  } else {
    const letter = v.disputeNotice || "No recoverable OUR fee breach on this case — clean audit certificate generated in JSON export.";
    $("modalBody").innerHTML = `
      <div class="raw-pre">${escapeHtml(letter)}</div>
      <div style="margin-top:12px;display:flex;gap:8px;">
        <a class="btn btn-primary" href="/api/report/${encodeURIComponent(v.caseId)}?format=txt" download>⬇ Download .txt</a>
      </div>`;
  }
}

async function refreshHistory() {
  const res = await fetch("/api/history");
  if (!res.ok) return;
  const data = await res.json();
  appState.verdicts = data.verdicts || [];
  appState.ledgerEvents = data.ledgerEvents || [];
  appState.queueStats = data.queueStats || appState.queueStats;
  for (const c of data.cases || []) {
    const entry = ensureCaseEntry(c.caseId);
    entry.info = { caseId: c.caseId, title: c.title, corridor: c.corridor };
    entry.verdict = c.verdict;
    entry.technical = c;
    for (const evt of c.trajectory || []) {
      if (evt.kind === "tool.completed" && evt.agentName && evt.callId) {
        const a = ensureAgent(entry, evt.agentName);
        a.tools.set(evt.callId, evt);
      } else if (evt.kind === "agent.completed" && evt.agentName) {
        const a = ensureAgent(entry, evt.agentName);
        a.status = "done";
        a.finalText = evt.text || "";
      }
    }
  }
  scheduleRender();
}

async function resolveBreakpoint(caseId, decision, reason) {
  await fetch(`/api/breakpoints/${encodeURIComponent(caseId)}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, reason }),
  });
}

async function init() {
  const health = await (await fetch("/api/health")).json();
  appState.provider = health.provider;
  appState.breakpointMode = health.breakpointMode;
  appState.queueStats = health.queueStats;
  appState.selectedProviderInModal = health.provider.provider;
  renderHeader();
  await refreshHistory();

  // SSE subscription
  const es = new EventSource("/api/events");
  es.onmessage = (msg) => {
    const parsed = JSON.parse(msg.data);
    if (parsed.queueStats) appState.queueStats = parsed.queueStats;
    if (parsed.snapshot) {
      appState.provider = parsed.snapshot.provider;
      appState.breakpointMode = parsed.snapshot.breakpointMode;
      for (const p of parsed.snapshot.pendingApprovals || []) {
        ensureCaseEntry(p.caseId).pending = p;
      }
      scheduleRender();
    } else if (parsed.event) {
      handleTrajectoryEvent(parsed.event);
    }
  };
  es.onerror = () => {
    $("sseDot").className = "dot amber";
    $("sseLabel").textContent = "SSE Reconnecting...";
  };
  es.onopen = () => {
    $("sseDot").className = "dot";
    $("sseLabel").textContent = "SSE Stream Active";
  };

  // Left navigation
  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      appState.view = btn.dataset.view;
      document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("active", b === btn));
      $("viewStream").classList.toggle("hidden", appState.view !== "stream");
      $("viewInbound").classList.toggle("hidden", appState.view !== "inbound");
      $("viewSummary").classList.toggle("hidden", appState.view !== "summary");
      scheduleRender();
    });
  });

  // Right tabs
  document.querySelectorAll("[data-rtab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      appState.rightTab = btn.dataset.rtab;
      document.querySelectorAll("[data-rtab]").forEach((b) => b.classList.toggle("active", b === btn));
      renderRightPanel();
    });
  });

  // Top triggers
  $("streamBatchBtn").addEventListener("click", async () => {
    appState.view = "stream";
    document.querySelector('[data-view="stream"]').click();
    await fetch("/api/scenarios/stream", { method: "POST" });
  });
  $("jumpUploadBtn").addEventListener("click", () => {
    document.querySelector('[data-view="inbound"]').click();
  });
  const fireWebhook = async () => {
    const sample = await (await fetch("/api/scenarios/sample")).json();
    const case2 = sample.cases?.[1] || sample.cases?.[0];
    if (!case2) return;
    const copy = { ...case2, caseId: `WH-${Date.now().toString().slice(-4)}`, title: `Webhook Live Event (${case2.invoice?.invoiceId})` };
    await fetch("/api/webhooks/inbound", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(copy) });
    document.querySelector('[data-view="stream"]').click();
  };
  $("fireWebhookBtn").addEventListener("click", fireWebhook);
  $("fireSampleWebhookBtn").addEventListener("click", fireWebhook);

  // Expand / collapse tools
  $("expandAllBtn").addEventListener("click", () => {
    const entry = appState.cases.get(appState.activeCaseId);
    if (!entry) return;
    for (const a of entry.agents.values()) for (const id of a.tools.keys()) appState.expandedTools.add(id);
    scheduleRender();
  });
  $("collapseAllBtn").addEventListener("click", () => {
    appState.expandedTools.clear();
    scheduleRender();
  });

  // Gate mode selector
  $("gateModeSelect").addEventListener("change", async (e) => {
    appState.breakpointMode = e.target.value;
    await fetch("/api/settings/provider", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ breakpointMode: appState.breakpointMode }),
    });
  });

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function postJsonSafe(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      if (errJson.error) msg = errJson.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return res.json();
}

  // File & raw paste upload
  $("browseFileBtn").addEventListener("click", () => $("fileInput").click());
  $("fileInput").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      if (file.name.toLowerCase().endsWith(".pdf")) {
        const buf = await file.arrayBuffer();
        const b64 = arrayBufferToBase64(buf);
        await postJsonSafe("/api/audit/upload", { filename: file.name, base64: b64, format: "pdf" });
      } else {
        const text = await file.text();
        await postJsonSafe("/api/audit/upload", { filename: file.name, content: text, format: "auto" });
      }
      document.querySelector('[data-view="stream"]').click();
    } catch (err) {
      alert(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      e.target.value = "";
    }
  });

  $("loadSampleMt103Btn").addEventListener("click", () => {
    $("rawPasteInput").value = `:20:TXN20261124CUSTOM\n:32A:261124USD5190,00\n:33B:EUR5000,00\n:36:1,0470\n:50K:NORDIC GEAR GMBH\n:70:/INV/INV-CUSTOM-01\n:71A:OUR\n:71G:USD45,00`;
  });
  $("runPasteBtn").addEventListener("click", async () => {
    const content = $("rawPasteInput").value.trim();
    if (!content) return;
    try {
      await postJsonSafe("/api/audit/upload", { content, format: "auto" });
      document.querySelector('[data-view="stream"]').click();
    } catch (err) {
      alert(`Ingest failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // Delegated UI interactions
  document.addEventListener("click", async (e) => {
    const casePick = e.target.closest("[data-case-pick]");
    if (casePick) {
      appState.activeCaseId = casePick.dataset.casePick;
      scheduleRender();
      return;
    }
    const toolBtn = e.target.closest("[data-toggle-tool]");
    if (toolBtn) {
      const id = toolBtn.dataset.toggleTool;
      if (appState.expandedTools.has(id)) appState.expandedTools.delete(id);
      else appState.expandedTools.add(id);
      scheduleRender();
      return;
    }
    const reasonBtn = e.target.closest("[data-toggle-reason]");
    if (reasonBtn) {
      const id = reasonBtn.dataset.toggleReason;
      if (appState.showReasoning.has(id)) appState.showReasoning.delete(id);
      else appState.showReasoning.add(id);
      scheduleRender();
      return;
    }
    const modalBtn = e.target.closest("[data-open-modal]");
    if (modalBtn) {
      openCaseModal(modalBtn.dataset.openModal, modalBtn.dataset.mtab || "ledger");
      return;
    }
    const mtab = e.target.closest("[data-mtab]");
    if (mtab) {
      appState.modalTab = mtab.dataset.mtab;
      renderCaseModal();
      return;
    }
    if (e.target.id === "approveGateBtn") {
      const entry = appState.cases.get(appState.activeCaseId);
      if (entry?.pending) await resolveBreakpoint(entry.pending.caseId, "approve");
    } else if (e.target.id === "toggleSteerBtn") {
      appState.showSteerBox = !appState.showSteerBox;
      renderStreamView();
      $("steerReasonInput")?.focus();
    } else if (e.target.id === "submitSteerBtn") {
      const entry = appState.cases.get(appState.activeCaseId);
      const reason = $("steerReasonInput")?.value?.trim();
      if (entry?.pending) await resolveBreakpoint(entry.pending.caseId, "reject", reason || "Treat as approved SHA fee.");
    } else if (e.target.id === "stopGateBtn") {
      const entry = appState.cases.get(appState.activeCaseId);
      if (entry?.pending) await resolveBreakpoint(entry.pending.caseId, "stop");
    }
  });

  // Keyboard shortcuts for Mozaik Approval Card
  document.addEventListener("keydown", async (e) => {
    if (e.key === "Escape") {
      if (!$("caseModal").classList.contains("hidden")) $("caseModal").classList.add("hidden");
      else if (!$("providerModal").classList.contains("hidden")) $("providerModal").classList.add("hidden");
      else if (appState.cases.get(appState.activeCaseId)?.pending) {
        appState.showSteerBox = true;
        renderStreamView();
        $("steerReasonInput")?.focus();
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      const pending = appState.cases.get(appState.activeCaseId)?.pending;
      if (pending) await resolveBreakpoint(pending.caseId, "approve");
    }
  });

  // Modals
  $("closeCaseModalBtn").addEventListener("click", () => $("caseModal").classList.add("hidden"));
  const openProvModal = () => {
    appState.selectedProviderInModal = appState.provider.provider;
    document.querySelectorAll("[data-prov]").forEach((b) => b.classList.toggle("active", b.dataset.prov === appState.selectedProviderInModal));
    $("modalModelInput").value = appState.provider.modelName;
    $("testConnStatus").textContent = "";
    $("providerModal").classList.remove("hidden");
  };
  $("providerChipBtn").addEventListener("click", openProvModal);
  $("openProviderModalBtn").addEventListener("click", openProvModal);
  $("closeProviderModalBtn").addEventListener("click", () => $("providerModal").classList.add("hidden"));

  document.querySelectorAll("[data-prov]").forEach((btn) => {
    btn.addEventListener("click", () => {
      appState.selectedProviderInModal = btn.dataset.prov;
      document.querySelectorAll("[data-prov]").forEach((b) => b.classList.toggle("active", b === btn));
      $("modalModelInput").value = PROVIDER_MODELS[appState.selectedProviderInModal] || "";
    });
  });

  const applyProvider = async () => {
    const res = await fetch("/api/settings/provider", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: appState.selectedProviderInModal,
        modelName: $("modalModelInput").value.trim(),
        apiKey: $("modalKeyInput").value.trim() || undefined,
      }),
    });
    const data = await res.json();
    appState.provider = data.provider;
    renderHeader();
  };

  $("testConnBtn").addEventListener("click", async () => {
    $("testConnStatus").textContent = "Testing connection...";
    await applyProvider();
    const res = await (await fetch("/api/settings/test", { method: "POST" })).json();
    $("testConnStatus").style.color = res.ok ? "var(--accent-emerald-ink)" : "var(--status-red-ink)";
    $("testConnStatus").textContent = `${res.ok ? "✓" : "✕"} ${res.message} (${res.latencyMs}ms)`;
  });

  $("saveProviderBtn").addEventListener("click", async () => {
    await applyProvider();
    $("providerModal").classList.add("hidden");
  });
}

void init();
