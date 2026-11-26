"use client"

import {
	Activity,
	ArrowUpRight,
	BarChart3,
	Check,
	ChevronDown,
	ChevronRight,
	Download,
	FileUp,
	PanelLeftClose,
	PanelLeftOpen,
	Play,
	Settings,
	Webhook,
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { AuditVerdict, PendingBreakpointDecision, TrajectoryEvent } from "@/core/types"
import { cn } from "@/lib/utils"
import { CaseInspectorModal } from "./case-inspector-modal"
import { CorridorSummaryView } from "./corridor-summary-view"
import {
	type AgentRunState,
	type CaseStreamEntry,
	fmtClientMoney,
	type LedgerLogItem,
	ORDERED_AGENTS,
	type OverlapSignal,
	type ProviderStatus,
	type QueueStats,
	verdictBadgeVariant,
} from "./corridor-types"
import { InboundSourcesView } from "./inbound-sources-view"
import { ProviderSettingsModal } from "./provider-settings-modal"

type WorkspaceView = "stream" | "inbound" | "summary"
type InspectorTab = "evidence" | "findings" | "report"
type ModalTab = "ledger" | "technical" | "letter"

function createEmptyCase(caseId: string): CaseStreamEntry {
	return {
		caseId,
		title: caseId,
		corridor: "",
		phase: "PHASE 1 · SPECIALISTS IN PARALLEL",
		startedAt: Date.now(),
		agents: {},
		timeline: [],
		overlaps: [],
		pending: null,
		verdict: null,
		technical: null,
	}
}

function createEmptyAgent(name: string): AgentRunState {
	return {
		name,
		status: "idle",
		startedAt: Date.now(),
		elapsed: "0.0s",
		thinking: false,
		reasoning: "",
		streamText: "",
		finalText: "",
		tools: {},
	}
}

const LANE_META: Array<{
	agentName: string
	label: string
	role: string
	defaultLeft: number
	defaultWidth: number
	conditional?: boolean
}> = [
	{ agentName: "TermsAgent", label: "Terms Agent", role: "CONTRACT · INVOICE", defaultLeft: 3, defaultWidth: 31 },
	{ agentName: "FxBenchmarkAgent", label: "FX Agent", role: "RATE · SPREAD", defaultLeft: 2, defaultWidth: 44 },
	{ agentName: "WireDetectiveAgent", label: "Wire Detective", role: "SWIFT · MT103", defaultLeft: 5, defaultWidth: 48 },
	{
		agentName: "DuplicateAnomalyAgent",
		label: "Anomaly Agent",
		role: "CONDITIONAL",
		defaultLeft: 16,
		defaultWidth: 27,
		conditional: true,
	},
	{ agentName: "AuditorAgent", label: "Auditor Agent", role: "INDEPENDENT CHECK", defaultLeft: 54, defaultWidth: 40 },
]

export function CorridorWorkspace() {
	const [view, setView] = useState<WorkspaceView>("stream")
	const [inspectorTab, setInspectorTab] = useState<InspectorTab>("evidence")
	const [navCollapsed, setNavCollapsed] = useState(false)
	const [inspectorCollapsed, setInspectorCollapsed] = useState(false)

	const [casesMap, setCasesMap] = useState<Record<string, CaseStreamEntry>>({})
	const [caseOrder, setCaseOrder] = useState<string[]>([])
	const [activeCaseId, setActiveCaseId] = useState<string | null>(null)
	const [verdicts, setVerdicts] = useState<AuditVerdict[]>([])
	const [ledgerEvents, setLedgerEvents] = useState<LedgerLogItem[]>([])
	const [queueStats, setQueueStats] = useState<QueueStats>({
		waiting: 0,
		active: 0,
		done: 0,
		failed: 0,
	})
	const [provider, setProvider] = useState<ProviderStatus>({
		provider: "demo",
		label: "Deterministic Demo Runner (No Key)",
		modelName: "deterministic-demo",
		hasKey: false,
		mode: "demo",
	})
	const [breakpointMode, setBreakpointMode] = useState<"risk_only" | "step_tool">("risk_only")
	const [sseConnected, setSseConnected] = useState(true)

	const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({})
	const [openReasoning, setOpenReasoning] = useState<Record<string, boolean>>({})
	const [showSteerBox, setShowSteerBox] = useState(false)
	const [steerReason, setSteerReason] = useState("")

	const [modalCaseId, setModalCaseId] = useState<string | null>(null)
	const [modalTab, setModalTab] = useState<ModalTab>("ledger")
	const [providerModalOpen, setProviderModalOpen] = useState(false)

	const refreshHistory = useCallback(async () => {
		try {
			const res = await fetch("/api/history", { cache: "no-store" })
			if (!res.ok) return
			const data = (await res.json()) as {
				verdicts: AuditVerdict[]
				ledgerEvents: LedgerLogItem[]
				queueStats: QueueStats
				cases: Array<{
					caseId: string
					title: string
					corridor: string
					verdict: AuditVerdict | null
					trajectory: TrajectoryEvent[]
				}>
			}
			setVerdicts(data.verdicts || [])
			if (data.ledgerEvents) setLedgerEvents(data.ledgerEvents)
			if (data.queueStats) setQueueStats(data.queueStats)

			setCasesMap((prev) => {
				const next = { ...prev }
				for (const item of data.cases || []) {
					const existing = next[item.caseId] || createEmptyCase(item.caseId)
					const agents = { ...existing.agents }
					for (const evt of item.trajectory || []) {
						if (evt.kind === "tool.completed" && evt.agentName && evt.callId) {
							const a = { ...(agents[evt.agentName] || createEmptyAgent(evt.agentName)) }
							a.tools = {
								...a.tools,
								[evt.callId]: {
									callId: evt.callId,
									toolName: evt.toolName || "tool",
									status: evt.status || "ok",
									durationMs: evt.durationMs ?? 1,
									argsJson: evt.argsJson,
									resultJson: evt.resultJson,
								},
							}
							agents[evt.agentName] = a
						} else if (evt.kind === "agent.completed" && evt.agentName) {
							const a = { ...(agents[evt.agentName] || createEmptyAgent(evt.agentName)) }
							a.status = "done"
							a.finalText = evt.text || a.finalText
							agents[evt.agentName] = a
						}
					}
					next[item.caseId] = {
						...existing,
						title: item.title,
						corridor: item.corridor,
						verdict: item.verdict,
						technical: item,
						agents,
					}
				}
				return next
			})
			setCaseOrder((prev) => {
				const ids = new Set(prev)
				for (const item of data.cases || []) ids.add(item.caseId)
				return [...ids]
			})
		} catch {
			// ignore transient network errors
		}
	}, [])

	useEffect(() => {
		let cancelled = false
		void (async () => {
			try {
				const health = (await (await fetch("/api/health", { cache: "no-store" })).json()) as {
					provider: ProviderStatus
					breakpointMode: "risk_only" | "step_tool"
					queueStats: QueueStats
				}
				if (cancelled) return
				setProvider(health.provider)
				setBreakpointMode(health.breakpointMode)
				setQueueStats(health.queueStats)
			} catch {
				// ignore
			}
			await refreshHistory()
		})()

		const es = new EventSource("/api/events")
		es.onopen = () => setSseConnected(true)
		es.onerror = () => setSseConnected(false)
		es.onmessage = (msg) => {
			try {
				const parsed = JSON.parse(msg.data) as {
					queueStats?: QueueStats
					snapshot?: {
						queueStats: QueueStats
						provider: ProviderStatus
						breakpointMode: "risk_only" | "step_tool"
						pendingApprovals?: PendingBreakpointDecision[]
					}
					event?: TrajectoryEvent
				}
				if (parsed.queueStats) setQueueStats(parsed.queueStats)
				if (parsed.snapshot) {
					setProvider(parsed.snapshot.provider)
					setBreakpointMode(parsed.snapshot.breakpointMode)
					setQueueStats(parsed.snapshot.queueStats)
					const pendingList = parsed.snapshot.pendingApprovals || []
					if (pendingList.length > 0) {
						setCasesMap((prev) => {
							const next = { ...prev }
							for (const p of pendingList) {
								const cur = next[p.caseId] || createEmptyCase(p.caseId)
								next[p.caseId] = { ...cur, pending: p }
							}
							return next
						})
					}
					return
				}

				const evt = parsed.event
				if (!evt) return
				setCaseOrder((prev) => (prev.includes(evt.caseId) ? prev : [...prev, evt.caseId]))
				setActiveCaseId((prev) => (!prev || evt.kind === "case.queued" ? evt.caseId : prev))

				if (evt.kind === "ledger.entry" && evt.text) {
					setLedgerEvents((prev) =>
						[{ timestamp: evt.timestamp, caseId: evt.caseId, summary: evt.text!, tone: evt.status || "ok" }, ...prev].slice(0, 80),
					)
				}

				if (evt.kind === "audit.verdict" && evt.payload?.verdict) {
					const newV = evt.payload.verdict as AuditVerdict
					setVerdicts((prev) => {
						const idx = prev.findIndex((x) => x.caseId === newV.caseId)
						if (idx >= 0) {
							const copy = [...prev]
							copy[idx] = newV
							return copy
						}
						return [newV, ...prev]
					})
					void refreshHistory()
				}

				setCasesMap((prev) => {
					const cur = prev[evt.caseId] || createEmptyCase(evt.caseId)
					const updated: CaseStreamEntry = {
						...cur,
						agents: { ...cur.agents },
						timeline: [...cur.timeline],
					}

					const secOffset = `${((Date.now() - updated.startedAt) / 1000).toFixed(1).padStart(4, "0")}s`
					const logLine = (text: string) => {
						updated.timeline.push({ id: evt.id, timeOffset: secOffset, text, kind: evt.kind })
						if (updated.timeline.length > 50) updated.timeline.shift()
					}

					if (evt.kind === "case.queued") {
						updated.startedAt = Date.now()
						logLine(evt.text || `Queued ${evt.caseId}`)
					} else if (evt.kind === "phase.changed") {
						if (evt.phase) updated.phase = evt.phase
						const ci = evt.payload?.caseInfo as { title?: string; corridor?: string } | undefined
						if (ci?.title) updated.title = ci.title
						if (ci?.corridor) updated.corridor = ci.corridor
						if (evt.phase) logLine(evt.phase)
					} else if (evt.kind === "agent.started" && evt.agentName) {
						const a = { ...(updated.agents[evt.agentName] || createEmptyAgent(evt.agentName)) }
						a.status = "running"
						a.startedAt = Date.now()
						updated.agents[evt.agentName] = a
						logLine(`${evt.agentName} started concurrent review`)
					} else if (evt.kind === "agent.thinking" && evt.agentName) {
						const a = { ...(updated.agents[evt.agentName] || createEmptyAgent(evt.agentName)) }
						a.thinking = true
						a.status = "running"
						updated.agents[evt.agentName] = a
					} else if (evt.kind === "agent.reasoning" && evt.agentName) {
						const a = { ...(updated.agents[evt.agentName] || createEmptyAgent(evt.agentName)) }
						a.reasoning += evt.text || ""
						updated.agents[evt.agentName] = a
					} else if (evt.kind === "agent.stream" && evt.agentName) {
						const a = { ...(updated.agents[evt.agentName] || createEmptyAgent(evt.agentName)) }
						a.thinking = false
						a.streamText += evt.text || ""
						updated.agents[evt.agentName] = a
					} else if (evt.kind === "tool.started" && evt.agentName && evt.callId) {
						const a = { ...(updated.agents[evt.agentName] || createEmptyAgent(evt.agentName)) }
						a.tools = {
							...a.tools,
							[evt.callId]: {
								callId: evt.callId,
								toolName: evt.toolName || "tool",
								status: "running",
								durationMs: null,
								argsJson: evt.argsJson,
							},
						}
						updated.agents[evt.agentName] = a
					} else if (evt.kind === "tool.completed" && evt.agentName && evt.callId) {
						const a = { ...(updated.agents[evt.agentName] || createEmptyAgent(evt.agentName)) }
						const prevTool = a.tools[evt.callId] || {
							callId: evt.callId,
							toolName: evt.toolName || "tool",
							status: "ok",
							durationMs: null,
						}
						a.tools = {
							...a.tools,
							[evt.callId]: {
								...prevTool,
								status: evt.status || "ok",
								durationMs: evt.durationMs ?? 1,
								argsJson: evt.argsJson || prevTool.argsJson,
								resultJson: evt.resultJson || "",
							},
						}
						updated.agents[evt.agentName] = a
						logLine(`[${evt.agentName}] ${evt.toolName} (${evt.durationMs ?? 1}ms)`)
					} else if (evt.kind === "agent.completed" && evt.agentName) {
						const a = { ...(updated.agents[evt.agentName] || createEmptyAgent(evt.agentName)) }
						a.thinking = false
						a.status = "done"
						a.elapsed = `${((Date.now() - a.startedAt) / 1000).toFixed(1)}s`
						a.finalText = evt.text || a.streamText
						updated.agents[evt.agentName] = a
						logLine(`${evt.agentName} completed (${a.elapsed})`)
					} else if (evt.kind === "overlap.updated" && evt.payload?.overlaps) {
						updated.overlaps = evt.payload.overlaps as OverlapSignal[]
					} else if (evt.kind === "breakpoint.paused" && evt.payload?.pending) {
						updated.pending = evt.payload.pending as PendingBreakpointDecision
						const a = { ...(updated.agents.AuditorAgent || createEmptyAgent("AuditorAgent")) }
						a.status = "paused"
						updated.agents.AuditorAgent = a
						setShowSteerBox(false)
						logLine(`Human risk gate paused: ${updated.pending.riskLabel}`)
					} else if (evt.kind === "breakpoint.resolved") {
						updated.pending = null
						const a = { ...(updated.agents.AuditorAgent || createEmptyAgent("AuditorAgent")) }
						a.status = "running"
						updated.agents.AuditorAgent = a
						logLine(`Human gate resolved (${evt.status || "approved"})`)
					} else if (evt.kind === "audit.verdict" && evt.payload?.verdict) {
						updated.verdict = evt.payload.verdict as AuditVerdict
						updated.pending = null
						logLine(`Verdict finalized: ${updated.verdict.status}`)
					}

					return { ...prev, [evt.caseId]: updated }
				})
			} catch {
				// ignore malformed sse event
			}
		}

		return () => {
			cancelled = true
			es.close()
		}
	}, [refreshHistory])

	const resolveBreakpoint = useCallback(
		async (caseId: string, decision: "approve" | "reject" | "stop", reason?: string) => {
			await fetch(`/api/breakpoints/${encodeURIComponent(caseId)}/resolve`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ decision, reason }),
			})
		},
		[],
	)

	const activeEntry = activeCaseId ? casesMap[activeCaseId] || null : null
	const modalEntry = modalCaseId ? casesMap[modalCaseId] || null : null

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (modalCaseId) setModalCaseId(null)
				else if (providerModalOpen) setProviderModalOpen(false)
				else if (activeEntry?.pending) setShowSteerBox(true)
			} else if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && activeEntry?.pending) {
				void resolveBreakpoint(activeEntry.pending.caseId, "approve")
			}
		}
		window.addEventListener("keydown", onKeyDown)
		return () => window.removeEventListener("keydown", onKeyDown)
	}, [modalCaseId, providerModalOpen, activeEntry, resolveBreakpoint])

	const handleStreamBatch = async () => {
		setView("stream")
		await fetch("/api/scenarios/stream", { method: "POST" })
	}

	const handleTriggerWebhook = async () => {
		const sample = (await (await fetch("/api/scenarios/sample")).json()) as {
			cases?: Array<{ caseId: string; invoice?: { invoiceId?: string } }>
		}
		const base = sample.cases?.[1] || sample.cases?.[0]
		if (!base) return
		const copy = {
			...base,
			caseId: `WH-${Date.now().toString().slice(-4)}`,
			title: `Webhook Live Event (${base.invoice?.invoiceId || "INBOUND"})`,
		}
		await fetch("/api/webhooks/inbound", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(copy),
		})
		setView("stream")
	}

	const visibleAgents = activeEntry
		? ORDERED_AGENTS.map((name) => activeEntry.agents[name]).filter((a): a is AgentRunState => Boolean(a))
		: []

	// Derive 5-stage progress state dynamically
	const stageState = (() => {
		if (!activeEntry) return 1
		if (activeEntry.verdict) return 5
		if (activeEntry.pending) return 4
		if (activeEntry.agents.AuditorAgent) return 3
		return 2
	})()

	const topStatusText = activeEntry?.pending
		? "RISK GATE PAUSED"
		: activeEntry?.verdict
			? "VERDICT VERIFIED"
			: activeEntry
				? "PARALLEL TRACE"
				: provider.mode === "demo"
					? "DEMO READY"
					: "LIVE READY"

	const providerChipLabel =
		provider.mode === "demo"
			? "DEMO · OFFLINE"
			: `${provider.provider.toUpperCase()} · ${provider.modelName}`

	return (
		<div className="flex h-screen flex-col overflow-hidden bg-[#070b10] text-[#dce8e9]">
			{/* TELEMETRY TOP BAR */}
			<header className="sticky top-0 z-20 flex min-h-[47px] shrink-0 items-center gap-3 border-b border-[#1b2a34] bg-[#090e14] px-4">
				<div className="flex min-w-0 items-center gap-2.5">
					<div className="grid h-[22px] w-[22px] shrink-0 rotate-45 place-items-center border border-[#34534f] font-mono text-[10px] font-semibold text-[#62e1c3]">
						<span className="-rotate-45">CA</span>
					</div>
					<span className="text-[11px] font-bold tracking-[0.12em] text-[#dce8e9]">
						CORRIDOR<span className="text-[#62e1c3]">/</span>AUDIT
					</span>
					<span className="hidden font-mono text-[9px] tracking-wider text-[#50646b] sm:inline">
						FINANCE SYSTEMS · NEXT.JS 15
					</span>
				</div>

				<div className="ml-auto flex items-center gap-2.5">
					<div className="hidden items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-[#7e9298] lg:flex">
						<span
							className={cn(
								"h-1.5 w-1.5 rounded-full",
								activeEntry?.pending
									? "bg-[#e7b56a] shadow-[0_0_9px_rgba(231,181,106,0.55)]"
									: "bg-[#62e1c3] shadow-[0_0_9px_rgba(98,225,195,0.45)]",
							)}
						/>
						<span>MOZAIK 6.0</span>
						<span className="text-[#50646b]">/</span>
						<span className={activeEntry?.pending ? "text-[#e7b56a]" : "text-[#dce8e9]"}>
							{topStatusText}
						</span>
						<span className="text-[#50646b]">·</span>
						<span className="tabular">
							{queueStats.waiting}W {queueStats.active}A {queueStats.done}D
						</span>
					</div>

					<select
						value={breakpointMode}
						onChange={async (e) => {
							const mode = e.target.value as "risk_only" | "step_tool"
							setBreakpointMode(mode)
							await fetch("/api/settings/provider", {
								method: "POST",
								headers: { "Content-Type": "application/json" },
								body: JSON.stringify({ breakpointMode: mode }),
							})
						}}
						title="Mozaik Interruptible Harness Breakpoint Mode"
						className="h-7 cursor-pointer rounded border border-[#1b2a34] bg-[#0b1118] px-2 font-mono text-[10px] uppercase tracking-wider text-[#c5d4d6] focus:border-[#62e1c3] focus:outline-none"
					>
						<option value="risk_only">GATE: AUTO-RISK</option>
						<option value="step_tool">GATE: STEP TOOL</option>
					</select>

					<button
						type="button"
						onClick={() => setProviderModalOpen(true)}
						title={`${provider.label} (${provider.modelName})`}
						className={cn(
							"inline-flex h-7 max-w-[190px] cursor-pointer items-center gap-1.5 truncate rounded border px-2 font-mono text-[10px] uppercase tracking-wider whitespace-nowrap transition-colors",
							provider.mode === "demo"
								? "border-[#e7b56a]/40 bg-[#e7b56a]/10 text-[#e7b56a]"
								: "border-[#31544c] bg-[#62e1c3]/10 text-[#62e1c3]",
						)}
					>
						<span className="truncate">{providerChipLabel}</span>
					</button>

					<Button size="sm" onClick={() => void handleStreamBatch()}>
						<Play className="h-3 w-3" />
						<span className="hidden sm:inline">Run 6-Case Batch</span>
					</Button>
				</div>
			</header>

			{/* 3-COLUMN COLLAPSIBLE WORKSPACE SHELL */}
			<div
				className={cn(
					"grid min-h-0 flex-1 transition-[grid-template-columns] duration-150",
					"grid-cols-[44px_minmax(0,1fr)]",
					navCollapsed && inspectorCollapsed
						? "md:grid-cols-[38px_minmax(0,1fr)_38px]"
						: navCollapsed
							? "md:grid-cols-[38px_minmax(0,1fr)_280px]"
							: inspectorCollapsed
								? "md:grid-cols-[62px_minmax(0,1fr)_38px]"
								: "md:grid-cols-[62px_minmax(0,1fr)_280px]",
				)}
			>
				{/* LEFT ICON RAIL */}
				<nav
					aria-label="Primary navigation"
					className="flex flex-col items-center gap-2.5 border-r border-[#1b2a34] bg-[#090e14] px-1.5 py-3.5"
				>
					<div className="w-full text-center font-mono text-[8px] tracking-[0.12em] text-[#50646b]">
						WORK
					</div>
					{[
						{ id: "stream" as const, label: "Live execution", icon: Activity },
						{ id: "summary" as const, label: "Corridor summary", icon: BarChart3 },
						{ id: "inbound" as const, label: "Inbound sources", icon: FileUp },
					].map((item) => {
						const Icon = item.icon
						const active = view === item.id
						return (
							<button
								key={item.id}
								type="button"
								title={item.label}
								aria-label={item.label}
								onClick={() => setView(item.id)}
								className={cn(
									"grid place-items-center rounded border transition-colors",
									navCollapsed ? "h-7 w-7" : "h-9 w-9",
									active
										? "border-[#25433f] bg-[#62e1c3]/10 text-[#62e1c3] shadow-[inset_2px_0_0_#62e1c3]"
										: "border-transparent text-[#7e9298] hover:border-[#1b2a34] hover:text-[#dce8e9]",
								)}
							>
								<Icon className="h-4 w-4" />
							</button>
						)
					})}

					<button
						type="button"
						title="Fire sample webhook event"
						aria-label="Fire sample webhook event"
						onClick={() => void handleTriggerWebhook()}
						className={cn(
							"grid place-items-center rounded border border-transparent text-[#7e9298] transition-colors hover:border-[#1b2a34] hover:text-[#62e1c3]",
							navCollapsed ? "h-7 w-7" : "h-9 w-9",
						)}
					>
						<Webhook className="h-4 w-4" />
					</button>

					<div className="flex-1" />

					<div className="w-full text-center font-mono text-[8px] tracking-[0.12em] text-[#50646b]">
						SYS
					</div>
					<button
						type="button"
						title={navCollapsed ? "Expand rail" : "Collapse rail"}
						onClick={() => setNavCollapsed((c) => !c)}
						className={cn(
							"grid place-items-center rounded border border-transparent text-[#7e9298] hover:border-[#1b2a34] hover:text-[#dce8e9]",
							navCollapsed ? "h-7 w-7" : "h-9 w-9",
						)}
					>
						{navCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
					</button>
					<button
						type="button"
						title="AI Model & API Key settings"
						aria-label="AI Model & API Key settings"
						onClick={() => setProviderModalOpen(true)}
						className={cn(
							"grid place-items-center rounded border border-transparent text-[#7e9298] hover:border-[#1b2a34] hover:text-[#62e1c3]",
							navCollapsed ? "h-7 w-7" : "h-9 w-9",
						)}
					>
						<Settings className="h-4 w-4" />
					</button>
				</nav>

				{/* CENTER TELEMETRY CORE */}
				<main className="flex min-w-0 flex-col overflow-y-auto bg-[#070b10] px-5 pt-4">
					{view === "stream" && (
						<div className="flex min-h-full flex-col">
							{/* Case Header */}
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div>
									<div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[#62e1c3]">
										SETTLEMENT FORENSICS <span className="text-[#50646b]">/ LIVE WORKSPACE</span>
									</div>
									<h1 className="mt-1 text-xl font-semibold tracking-tight text-[#dce8e9]">
										{activeEntry ? activeEntry.title : "Agent execution"}
									</h1>
									<p className="mt-1 text-[11px] text-[#7e9298]">
										Specialist analysis, independent cross-check, and cent-proof cited result.
									</p>
								</div>

								<div className="flex flex-wrap items-center gap-2">
									<div className="border border-[#1b2a34] px-2.5 py-1.5 font-mono text-[10px] text-[#7e9298]">
										{activeEntry
											? `${activeEntry.caseId}${activeEntry.corridor ? ` · ${activeEntry.corridor}` : ""}`
											: "STANDBY · READY"}
									</div>
									{activeEntry && (
										<Button
											variant="outline"
											size="sm"
											onClick={() => {
												const anyOpen = Object.values(expandedTools).some(Boolean)
												if (anyOpen) {
													setExpandedTools({})
												} else {
													const next: Record<string, boolean> = {}
													for (const a of visibleAgents) {
														for (const cid of Object.keys(a.tools)) next[cid] = true
													}
													setExpandedTools(next)
												}
											}}
										>
											{Object.values(expandedTools).some(Boolean) ? "Collapse Tools" : "Inspect Tools"}
										</Button>
									)}
								</div>
							</div>

							{/* Case Switcher Strip */}
							{caseOrder.length > 0 && (
								<div className="mt-3 flex flex-wrap gap-1.5">
									{caseOrder.map((cid) => {
										const c = casesMap[cid]
										if (!c) return null
										return (
											<button
												key={cid}
												type="button"
												onClick={() => setActiveCaseId(cid)}
												className={cn(
													"rounded-[3px] border px-2 py-1 font-mono text-[9.5px] uppercase tracking-wider transition-colors",
													cid === activeCaseId
														? "border-[#31544c] bg-[#62e1c3]/10 text-[#62e1c3]"
														: "border-[#1b2a34] bg-[#0b1118] text-[#7e9298] hover:text-[#dce8e9]",
												)}
											>
												{cid}
												{c.pending ? " ⏸" : c.verdict ? " ✓" : ""}
											</button>
										)
									})}
								</div>
							)}

							{/* 5-Stage Fixed Workflow Bar */}
							<div
								aria-label="Fixed settlement audit workflow"
								className="my-4 flex items-center overflow-x-auto border-y border-[#1b2a34] bg-gradient-to-r from-[#62e1c3]/[0.04] to-transparent px-3 py-2.5"
							>
								{[
									{ n: 1, label: "Input" },
									{ n: 2, label: "Investigate" },
									{ n: 3, label: "Cross-check" },
									{ n: 4, label: "Risk gate" },
									{ n: 5, label: "Report" },
								].map((s, idx) => {
									const isDone = stageState > s.n
									const isCurrent = stageState === s.n
									return (
										<div key={s.n} className="flex shrink-0 items-center">
											<div
												className={cn(
													"flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-wider",
													isCurrent ? "text-[#62e1c3]" : isDone ? "text-[#7e9298]" : "text-[#50646b]",
												)}
											>
												<span
													className={cn(
														"grid h-4 w-4 place-items-center rounded-full border text-[8px]",
														isCurrent
															? "border-[#62e1c3] bg-[#62e1c3] font-bold text-[#070b10]"
															: isDone
																? "border-[#29434c] text-[#62e1c3]"
																: "border-[#29434c] text-[#50646b]",
													)}
												>
													{isDone ? "✓" : `0${s.n}`}
												</span>
												<span>{s.label}</span>
											</div>
											{idx < 4 && <span className="mx-3 h-px w-4 bg-[#29434c] sm:w-7" />}
										</div>
									)
								})}
							</div>

							{/* PARALLEL AGENT TRACE (LIVE GANTT TIMELINE) */}
							<section aria-label="Parallel agent timeline">
								<div className="mb-2 flex items-baseline justify-between gap-2">
									<h2 className="font-mono text-[11px] font-semibold tracking-wider text-[#dce8e9]">
										PARALLEL AGENT TRACE
									</h2>
									<span className="font-mono text-[9.5px] text-[#7e9298]">
										{activeEntry
											? activeEntry.pending
												? "GATE PAUSED"
												: activeEntry.verdict
													? "COMPLETE · CENT-VERIFIED"
													: "LIVE · CONCURRENT"
											: "READY · CLICK RUN 6-CASE BATCH"}
									</span>
								</div>

								<div className="border-t border-[#1b2a34]">
									<div className="grid h-6 grid-cols-[126px_minmax(0,1fr)] items-end pb-1 font-mono text-[8.5px] text-[#50646b]">
										<span>AGENT / ROLE</span>
										<div className="flex justify-between px-0.5">
											<span>0s</span>
											<span>2s</span>
											<span>4s</span>
											<span>6s</span>
											<span>8s</span>
										</div>
									</div>

									{LANE_META.map((lane) => {
										const a = activeEntry?.agents[lane.agentName]
										const toolCount = a ? Object.keys(a.tools).length : 0
										const spanText = a
											? a.status === "paused"
												? "Cross-check complete · awaiting decision"
												: a.status === "done"
													? `${toolCount} tool(s) verified (${a.elapsed})`
													: a.thinking
														? "Reasoning..."
														: `Running ${toolCount} tool(s)...`
											: lane.conditional
												? "Conditional duplicate / BEC scan"
												: lane.agentName === "AuditorAgent"
													? "Awaiting specialist evidence"
													: "Standby"

										const spanStyle =
											a?.status === "paused"
												? "border-l-[#e7b56a] bg-[#e7b56a]/10 text-[#e3c28f]"
												: a?.status === "done" || a?.status === "running"
													? lane.conditional
														? "border-l-[#e7b56a] bg-[#e7b56a]/10 text-[#e3c28f]"
														: "border-l-[#62e1c3] bg-[#62e1c3]/10 text-[#c5d4d6]"
													: lane.conditional
														? "border-l-[#e7b56a]/50 bg-[#e7b56a]/[0.05] text-[#7e9298]"
														: "border-l-[#52656c] bg-[#7e9298]/[0.07] text-[#7e9298]"

										return (
											<div
												key={lane.agentName}
												className="grid min-h-[44px] grid-cols-[126px_minmax(0,1fr)] items-center border-t border-[#1b2a34]/75"
											>
												<div className="min-w-0 pr-2">
													<div className="truncate text-[10.5px] font-semibold text-[#dce8e9]">
														{lane.label}
													</div>
													<div className="font-mono text-[8.5px] text-[#7e9298]">{lane.role}</div>
												</div>
												<div className="plot-grid relative h-7">
													<span
														style={{ left: `${lane.defaultLeft}%`, width: `${lane.defaultWidth}%` }}
														className={cn(
															"absolute top-1.5 flex h-4 items-center overflow-hidden border-l-2 px-2 font-mono text-[8.5px] whitespace-nowrap transition-all",
															spanStyle,
														)}
													>
														{spanText}
													</span>
												</div>
											</div>
										)
									})}
								</div>

								<div className="my-3 flex items-center gap-2.5 text-[10px] text-[#7e9298]">
									<span className="h-px w-6 bg-[#62e1c3] shadow-[0_0_6px_rgba(98,225,195,0.4)]" />
									<span>
										<strong className="font-medium text-[#62e1c3]">PARALLEL WINDOW</strong> · specialists
										execute concurrently in shared <code className="font-mono">CorridorState</code>;
										AuditorAgent verifies the assembled evidence afterward.
									</span>
								</div>
							</section>

							{/* CHRONOLOGICAL EVENT TRACE + EXPANDABLE TOOL PAYLOADS */}
							<section aria-label="Chronological execution events" className="mt-1 flex-1">
								<div className="mb-2 flex items-baseline justify-between gap-2">
									<h2 className="font-mono text-[11px] font-semibold tracking-wider text-[#dce8e9]">
										EVENT TRACE &amp; TOOL INSPECTOR
									</h2>
									<span className="font-mono text-[9.5px] text-[#7e9298]">CHRONOLOGICAL · SSE</span>
								</div>

								{!activeEntry ? (
									<div className="border-t border-[#1b2a34] py-4 text-xs text-[#7e9298]">
										Agents standing by. Click <strong className="text-[#dce8e9]">Run 6-Case Batch</strong>{" "}
										in the top bar or drop a file in <strong className="text-[#dce8e9]">Inbound Sources</strong>.
									</div>
								) : (
									<div className="space-y-3 border-t border-[#1b2a34] pt-2">
										{/* Chronological feed */}
										<div className="divide-y divide-[#1b2a34]/65">
											{activeEntry.timeline.slice(-10).map((ev) => (
												<div
													key={ev.id}
													className="grid grid-cols-[52px_1fr_auto] items-center gap-2 py-1.5 text-[10.5px]"
												>
													<span className="font-mono text-[9px] text-[#50646b] tabular">
														{ev.timeOffset}
													</span>
													<span className="truncate text-[#c5d4d6]">{ev.text}</span>
													<span className="font-mono text-[9px] text-[#50646b]">{ev.kind}</span>
												</div>
											))}
										</div>

										{/* Expandable tool pills per active agent */}
										<div className="space-y-2 border-t border-[#1b2a34] pt-2.5">
											{visibleAgents.map((a) => {
												const toolsArr = Object.values(a.tools)
												const rKey = `${activeEntry.caseId}:${a.name}`
												const rOpen = Boolean(openReasoning[rKey])
												if (toolsArr.length === 0 && !a.reasoning && !a.finalText) return null
												return (
													<div key={a.name} className="rounded border border-[#1b2a34] bg-[#0b1118] p-2.5">
														<div className="flex flex-wrap items-center gap-2">
															<span className="font-mono text-[10px] font-semibold text-[#62e1c3]">
																{a.name}
															</span>
															{a.reasoning && (
																<button
																	type="button"
																	onClick={() => setOpenReasoning((p) => ({ ...p, [rKey]: !rOpen }))}
																	className="inline-flex items-center gap-1 rounded border border-[#1b2a34] bg-[#090e14] px-1.5 py-0.5 font-mono text-[9px] text-[#7e9298] hover:text-[#dce8e9]"
																>
																	{rOpen ? (
																		<ChevronDown className="h-3 w-3" />
																	) : (
																		<ChevronRight className="h-3 w-3" />
																	)}
																	Reasoning
																</button>
															)}
															<span className="ml-auto font-mono text-[9px] text-[#50646b]">
																{a.status === "done" ? a.elapsed : a.status}
															</span>
														</div>

														{a.reasoning && rOpen && (
															<pre className="mt-2 whitespace-pre-wrap rounded border-l-2 border-[#62e1c3] bg-[#070b10] p-2 font-mono text-[10px] text-[#7e9298]">
																{a.reasoning}
															</pre>
														)}

														{toolsArr.length > 0 && (
															<div className="mt-1.5 flex flex-wrap gap-1.5">
																{toolsArr.map((t) => {
																	const isOpen = Boolean(expandedTools[t.callId])
																	return (
																		<div key={t.callId} className={cn(isOpen && "w-full")}>
																			<button
																				type="button"
																				onClick={() =>
																					setExpandedTools((p) => ({ ...p, [t.callId]: !isOpen }))
																				}
																				className={cn(
																					"inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[9.5px]",
																					t.status === "ok"
																						? "border-[#31544c] bg-[#62e1c3]/10 text-[#62e1c3]"
																						: t.status === "error"
																							? "border-[#f17678]/40 bg-[#f17678]/10 text-[#f17678]"
																							: "border-[#1b2a34] bg-[#090e14] text-[#7e9298]",
																				)}
																			>
																				{isOpen ? (
																					<ChevronDown className="h-3 w-3" />
																				) : (
																					<ChevronRight className="h-3 w-3" />
																				)}
																				{t.toolName} · {t.durationMs !== null ? `${t.durationMs}ms` : "..."}
																			</button>
																			{isOpen && (
																				<pre className="mt-1 whitespace-pre-wrap break-words rounded border border-[#1b2a34] bg-[#070b10] p-2 font-mono text-[10px] text-[#c5d4d6]">
																					{`ARGS:   ${t.argsJson || "{}"}\nRESULT: ${t.resultJson || "running..."}`}
																				</pre>
																			)}
																		</div>
																	)
																})}
															</div>
														)}

														{(a.finalText || a.streamText) && (
															<p className="mt-1.5 text-[11px] leading-relaxed text-[#c5d4d6]">
																{a.finalText || a.streamText}
															</p>
														)}
													</div>
												)
											})}
										</div>
									</div>
								)}
							</section>

							{/* RUNTIME COMMAND STRIP */}
							<div className="-mx-5 mt-4 flex min-h-[40px] items-center gap-2 border-t border-[#1b2a34] bg-[#090e14] px-4 font-mono text-[9.5px] text-[#7e9298]">
								<span className="text-[#62e1c3]">›</span>
								<span>MOZAIK RUNTIME</span>
								<span className="text-[#50646b]">/</span>
								<span className="text-[#c5d4d6]">
									run {activeEntry?.caseId || "STANDBY"} ({sseConnected ? "sse:live" : "sse:reconnecting"})
								</span>
								<span className="ml-auto hidden text-[#50646b] sm:inline">LOCAL APP COMMANDS</span>
							</div>
						</div>
					)}

					{view === "inbound" && (
						<div className="pb-6">
							<InboundSourcesView
								onTriggerWebhook={handleTriggerWebhook}
								onIngested={() => setView("stream")}
							/>
						</div>
					)}

					{view === "summary" && (
						<div className="pb-6">
							<CorridorSummaryView
								verdicts={verdicts}
								onSelectCase={(cid) => {
									setModalTab("ledger")
									setModalCaseId(cid)
								}}
							/>
						</div>
					)}
				</main>

				{/* RIGHT COLLAPSIBLE CASE INSPECTOR */}
				<aside
					aria-label="Evidence and audit inspector"
					className={cn(
						"flex min-w-0 flex-col overflow-hidden border-l border-[#1b2a34] bg-[#090e14]",
						inspectorCollapsed && "items-center px-1 py-3",
					)}
				>
					<div
						className={cn(
							"flex items-center justify-between px-3.5 pt-3.5 pb-3",
							inspectorCollapsed && "flex-col gap-3 px-0 py-0 [writing-mode:vertical-rl]",
						)}
					>
						<span
							className={cn(
								"font-mono text-[9.5px] tracking-[0.13em] text-[#62e1c3]",
								inspectorCollapsed && "rotate-180",
							)}
						>
							CASE INSPECTOR
						</span>
						<button
							type="button"
							onClick={() => setInspectorCollapsed((c) => !c)}
							className="font-mono text-[9.5px] text-[#7e9298] hover:text-[#62e1c3]"
						>
							{inspectorCollapsed ? "OPEN ›" : "HIDE ›"}
						</button>
					</div>

					{!inspectorCollapsed && (
						<>
							<div className="flex gap-4 border-b border-[#1b2a34] px-3.5" role="tablist">
								{[
									{ id: "evidence" as const, label: "Evidence" },
									{ id: "findings" as const, label: `Findings (${verdicts.length})` },
									{ id: "report" as const, label: "Report" },
								].map((tab) => (
									<button
										key={tab.id}
										type="button"
										role="tab"
										aria-selected={inspectorTab === tab.id}
										onClick={() => setInspectorTab(tab.id)}
										className={cn(
											"-mb-px border-b pb-2 font-mono text-[9.5px] uppercase tracking-wider transition-colors",
											inspectorTab === tab.id
												? "border-[#62e1c3] text-[#dce8e9]"
												: "border-transparent text-[#50646b] hover:text-[#dce8e9]",
										)}
									>
										{tab.label}
									</button>
								))}
							</div>

							<div className="flex-1 overflow-y-auto px-3.5 py-3.5">
								{inspectorTab === "evidence" && (
									<div>
										<div className="text-[11px] font-semibold text-[#dce8e9]">INPUT SOURCES</div>
										<div className="mt-0.5 text-[9.5px] text-[#7e9298]">
											Every finding resolves to its source.
										</div>

										<div className="mt-2 divide-y divide-[#1b2a34]">
											{[
												{ code: "INV", name: "Invoice / Contract", state: activeEntry ? "LINKED" : "READY" },
												{ code: "MT", name: "SWIFT MT103 / CSV", state: activeEntry ? "LINKED" : "READY" },
												{
													code: "FX",
													name: "ECB Rate Benchmark",
													state: activeEntry?.agents.FxBenchmarkAgent?.status === "done" ? "VERIFIED" : "DATED",
												},
											].map((src) => (
												<div
													key={src.code}
													className="grid grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-2 py-2.5"
												>
													<span className="grid h-6 w-6 place-items-center border border-[#29434c] font-mono text-[8.5px] text-[#62e1c3]">
														{src.code}
													</span>
													<span className="truncate text-[10px] text-[#dce8e9]">{src.name}</span>
													<span className="font-mono text-[8.5px] text-[#50646b]">{src.state}</span>
												</div>
											))}
										</div>

										{activeEntry && activeEntry.overlaps.length > 0 && (
											<div className="mt-3 space-y-1.5 border-t border-[#1b2a34] pt-3">
												<div className="font-mono text-[9px] uppercase tracking-wider text-[#7e9298]">
													Cross-Check Signals
												</div>
												{activeEntry.overlaps.map((o, idx) => (
													<div
														key={`${o.left}-${idx}`}
														className="flex items-center justify-between gap-1.5 text-[10px]"
													>
														<span className="truncate font-mono text-[#7e9298]">{o.left}</span>
														<Badge variant={o.tone}>{o.right}</Badge>
													</div>
												))}
											</div>
										)}

										<div className="mt-4 border-t border-[#29434c] pt-3">
											<div className="flex items-center justify-between gap-2">
												<span className="text-[10.5px] font-semibold text-[#dce8e9]">Audit status</span>
												<span
													className={cn(
														"font-mono text-[8.5px] uppercase",
														activeEntry?.pending
															? "text-[#e7b56a]"
															: activeEntry?.verdict
																? "text-[#62e1c3]"
																: "text-[#7e9298]",
													)}
												>
													{activeEntry?.pending
														? "REVIEW REQUIRED"
														: activeEntry?.verdict
															? activeEntry.verdict.status.replace(/_/g, " ")
															: activeEntry
																? "RUNNING"
																: "STANDBY"}
												</span>
											</div>
											<p className="mt-1.5 text-[10px] leading-relaxed text-[#7e9298]">
												{activeEntry?.verdict
													? activeEntry.verdict.plainEnglishSummary
													: activeEntry?.pending
														? activeEntry.pending.question
														: "Final finding appears after cross-check and citation validation."}
											</p>
										</div>

										{/* INLINE HUMAN GATE · RISK POLICY CARD */}
										{activeEntry?.pending && (
											<div className="mt-3.5 border border-[#e7b56a]/40 bg-[#e7b56a]/[0.04] p-3">
												<div className="font-mono text-[8.5px] uppercase tracking-[0.11em] text-[#e7b56a]">
													HUMAN GATE · {activeEntry.pending.riskLabel}
												</div>
												<h4 className="mt-1.5 mb-1 text-[11px] font-semibold text-[#dce8e9]">
													Decision required
												</h4>
												<p className="text-[10px] leading-relaxed text-[#7e9298]">
													{activeEntry.pending.proofLine}
												</p>
												<div className="mt-2.5 flex flex-wrap gap-1.5">
													<button
														type="button"
														onClick={() =>
															void resolveBreakpoint(activeEntry.pending!.caseId, "approve")
														}
														className="inline-flex items-center gap-1 rounded-[3px] border border-[#62e1c3] bg-[#62e1c3] px-2.5 py-1 text-[9.5px] font-semibold text-[#070b10] hover:bg-[#7ae8ce]"
													>
														<Check className="h-3 w-3" />
														Approve
													</button>
													<button
														type="button"
														onClick={() => setShowSteerBox((s) => !s)}
														className="rounded-[3px] border border-[#29434c] px-2 py-1 text-[9.5px] text-[#c5d4d6] hover:border-[#62e1c3]"
													>
														Reject with reason
													</button>
													<button
														type="button"
														onClick={() => void resolveBreakpoint(activeEntry.pending!.caseId, "stop")}
														className="rounded-[3px] border border-[#f17678]/40 px-2 py-1 text-[9.5px] text-[#f17678] hover:bg-[#f17678]/10"
													>
														Stop
													</button>
												</div>

												{showSteerBox && (
													<div className="mt-2.5 space-y-1.5">
														<input
															type="text"
															autoFocus
															value={steerReason}
															onChange={(e) => setSteerReason(e.target.value)}
															placeholder="Override reason (e.g. Approved as SHA)"
															className="h-7 w-full rounded border border-[#29434c] bg-[#070b10] px-2 font-mono text-[10px] text-[#dce8e9] focus:border-[#62e1c3] focus:outline-none"
														/>
														<Button
															size="sm"
															className="w-full"
															onClick={() =>
																void resolveBreakpoint(
																	activeEntry.pending!.caseId,
																	"reject",
																	steerReason.trim() || "Treat as approved SHA fee.",
																)
															}
														>
															Send Override
														</Button>
													</div>
												)}
											</div>
										)}

										<div className="mt-4 border-t border-[#1b2a34] pt-2.5 font-mono text-[8.5px] leading-relaxed text-[#50646b]">
											SYNTHETIC &amp; PUBLIC ECB DATA ONLY
											<br />
											Ctrl+Enter approves gate · Esc steers
										</div>
									</div>
								)}

								{inspectorTab === "findings" && (
									<div className="space-y-2">
										{verdicts.length === 0 ? (
											<div className="py-3 text-xs text-[#7e9298]">
												Completed case verdicts will appear here.
											</div>
										) : (
											verdicts.map((v) => {
												const ccy = v.numbers.settledCurrency
												return (
													<div
														key={v.caseId}
														onClick={() => {
															setModalTab("ledger")
															setModalCaseId(v.caseId)
														}}
														className={cn(
															"cursor-pointer rounded border p-2.5 transition-colors",
															v.caseId === activeCaseId
																? "border-[#62e1c3]/50 bg-[#62e1c3]/[0.05]"
																: "border-[#1b2a34] bg-[#0b1118] hover:border-[#29434c]",
														)}
													>
														<div className="flex items-center justify-between gap-1.5">
															<span className="font-mono text-[10px] font-bold text-[#dce8e9]">
																{v.caseId}
															</span>
															<Badge variant={verdictBadgeVariant(v.status)}>
																{v.status.replace(/_/g, " ")}
															</Badge>
														</div>
														<div className="mt-1 font-mono text-[9.5px] text-[#7e9298]">
															{v.numbers.recoverableFeeMinor > 0
																? `Recover ${fmtClientMoney(v.numbers.recoverableFeeMinor, ccy)}`
																: `Variance ${fmtClientMoney(v.numbers.unexplainedVarianceMinor, ccy)}`}
															{" · "}FX {fmtClientMoney(v.numbers.fxSpreadLossMinor, ccy)}
														</div>
														<div
															className="mt-2 flex gap-1.5"
															onClick={(e) => e.stopPropagation()}
														>
															<button
																type="button"
																onClick={() => {
																	setModalTab("ledger")
																	setModalCaseId(v.caseId)
																}}
																className="inline-flex items-center gap-0.5 rounded border border-[#29434c] px-1.5 py-0.5 font-mono text-[9px] text-[#c5d4d6] hover:border-[#62e1c3]"
															>
																Inspect
																<ArrowUpRight className="h-2.5 w-2.5" />
															</button>
															{v.disputeNotice && (
																<button
																	type="button"
																	onClick={() => {
																		setModalTab("letter")
																		setModalCaseId(v.caseId)
																	}}
																	className="rounded border border-[#29434c] px-1.5 py-0.5 font-mono text-[9px] text-[#e7b56a] hover:border-[#e7b56a]"
																>
																	Dispute.txt
																</button>
															)}
														</div>
													</div>
												)
											})
										)}
									</div>
								)}

								{inspectorTab === "report" && (
									<div className="space-y-3">
										{verdicts.length === 0 && ledgerEvents.length === 0 ? (
											<div className="py-3 text-xs text-[#7e9298]">
												Downloadable dispute letters and ledger logs appear here after completion.
											</div>
										) : (
											<>
												{verdicts.map((v) => (
													<div
														key={v.caseId}
														className="rounded border border-[#1b2a34] bg-[#0b1118] p-2.5"
													>
														<div className="mb-1.5 font-mono text-[10px] font-bold text-[#dce8e9]">
															{v.caseId} · {v.invoiceId}
														</div>
														<div className="flex flex-wrap gap-1.5">
															<a
																href={`/api/report/${encodeURIComponent(v.caseId)}?format=txt`}
																download
																className="inline-flex items-center gap-1 rounded border border-[#29434c] px-2 py-1 font-mono text-[9px] text-[#62e1c3] hover:border-[#62e1c3]"
															>
																<Download className="h-2.5 w-2.5" />
																Letter (.txt)
															</a>
															<a
																href={`/api/report/${encodeURIComponent(v.caseId)}?format=json`}
																download
																className="inline-flex items-center gap-1 rounded border border-[#29434c] px-2 py-1 font-mono text-[9px] text-[#c5d4d6] hover:border-[#62e1c3]"
															>
																<Download className="h-2.5 w-2.5" />
																Audit (.json)
															</a>
														</div>
													</div>
												))}
												{ledgerEvents.length > 0 && (
													<div className="divide-y divide-[#1b2a34] border-t border-[#1b2a34] pt-2">
														{ledgerEvents.slice(0, 12).map((l, idx) => (
															<div key={`${l.timestamp}-${idx}`} className="py-1.5 text-[10px]">
																<div className="font-mono text-[8.5px] text-[#50646b]">
																	{l.timestamp.slice(11, 19)} · {l.caseId}
																</div>
																<div className="text-[#c5d4d6]">{l.summary}</div>
															</div>
														))}
													</div>
												)}
											</>
										)}
									</div>
								)}
							</div>
						</>
					)}
				</aside>
			</div>

			<CaseInspectorModal
				entry={modalEntry}
				activeTab={modalTab}
				onTabChange={setModalTab}
				onClose={() => setModalCaseId(null)}
			/>

			<ProviderSettingsModal
				open={providerModalOpen}
				current={provider}
				onSaved={(next) => setProvider(next)}
				onClose={() => setProviderModalOpen(false)}
			/>
		</div>
	)
}
