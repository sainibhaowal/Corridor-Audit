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
	PauseCircle,
	Play,
	Settings,
	Square,
	Webhook,
	X,
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import type { AuditVerdict, PendingBreakpointDecision, TrajectoryEvent } from "@/core/types"
import { cn } from "@/lib/utils"
import { BrandLogo } from "./brand-logo"
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
type RightTab = "cases" | "artifacts" | "ledger"
type ModalTab = "ledger" | "technical" | "letter"

function createEmptyCase(caseId: string): CaseStreamEntry {
	return {
		caseId,
		title: caseId,
		corridor: "",
		phase: "PHASE 1 · SPECIALISTS IN PARALLEL",
		agents: {},
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

const ROLE_BORDER: Record<string, string> = {
	TermsAgent: "border-t-slate-900",
	FxBenchmarkAgent: "border-t-emerald-600",
	WireDetectiveAgent: "border-t-amber-600",
	DuplicateAnomalyAgent: "border-t-violet-600",
	AuditorAgent: "border-t-emerald-700",
}

export function CorridorWorkspace() {
	const [view, setView] = useState<WorkspaceView>("stream")
	const [rightTab, setRightTab] = useState<RightTab>("cases")
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
			// ignore transient network glitches
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
					const updated: CaseStreamEntry = { ...cur, agents: { ...cur.agents } }

					if (evt.kind === "phase.changed") {
						if (evt.phase) updated.phase = evt.phase
						const ci = evt.payload?.caseInfo as { title?: string; corridor?: string } | undefined
						if (ci?.title) updated.title = ci.title
						if (ci?.corridor) updated.corridor = ci.corridor
					} else if (evt.kind === "agent.started" && evt.agentName) {
						const a = { ...(updated.agents[evt.agentName] || createEmptyAgent(evt.agentName)) }
						a.status = "running"
						a.startedAt = Date.now()
						updated.agents[evt.agentName] = a
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
					} else if (evt.kind === "agent.completed" && evt.agentName) {
						const a = { ...(updated.agents[evt.agentName] || createEmptyAgent(evt.agentName)) }
						a.thinking = false
						a.status = "done"
						a.elapsed = `${((Date.now() - a.startedAt) / 1000).toFixed(1)}s`
						a.finalText = evt.text || a.streamText
						updated.agents[evt.agentName] = a
					} else if (evt.kind === "overlap.updated" && evt.payload?.overlaps) {
						updated.overlaps = evt.payload.overlaps as OverlapSignal[]
					} else if (evt.kind === "breakpoint.paused" && evt.payload?.pending) {
						updated.pending = evt.payload.pending as PendingBreakpointDecision
						const a = { ...(updated.agents.AuditorAgent || createEmptyAgent("AuditorAgent")) }
						a.status = "paused"
						updated.agents.AuditorAgent = a
						setShowSteerBox(false)
					} else if (evt.kind === "breakpoint.resolved") {
						updated.pending = null
						const a = { ...(updated.agents.AuditorAgent || createEmptyAgent("AuditorAgent")) }
						a.status = "running"
						updated.agents.AuditorAgent = a
					} else if (evt.kind === "audit.verdict" && evt.payload?.verdict) {
						updated.verdict = evt.payload.verdict as AuditVerdict
						updated.pending = null
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

	const providerBadgeText =
		provider.mode === "demo"
			? "Demo · Offline Safe"
			: `${provider.provider.toUpperCase()} · ${provider.modelName}`

	return (
		<div className="flex h-screen flex-col overflow-hidden bg-slate-50">
			{/* SLIM INSTITUTIONAL TOP BAR */}
			<header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4">
				<div className="flex shrink-0 items-center gap-2.5 whitespace-nowrap">
					<BrandLogo size={28} />
					<span className="text-base font-extrabold tracking-tight text-slate-900">
						Corridor<span className="text-emerald-600">Audit</span>
					</span>
					<span className="hidden rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-500 sm:inline-block">
						Next.js · Mozaik 6.0
					</span>
				</div>

				<div className="flex min-w-0 items-center gap-2">
					<span className="hidden truncate rounded-md bg-slate-100 px-2.5 py-1 text-[11.5px] font-medium text-slate-600 xl:inline-block">
						Synthetic &amp; Public ECB Data Only · Not Financial Advice
					</span>
					<span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-200 bg-white px-2.5 py-1 font-mono text-[11.5px] text-slate-700 tabular">
						<span className="h-2 w-2 rounded-full bg-emerald-600" />
						Batch: {queueStats.waiting} wait · {queueStats.active} active · {queueStats.done} done
					</span>
				</div>

				<div className="flex shrink-0 items-center gap-2">
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
						className="h-8 cursor-pointer rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 focus:border-emerald-600 focus:outline-none"
					>
						<option value="risk_only">Gate: Auto-Risk</option>
						<option value="step_tool">Gate: Step Every Tool</option>
					</select>

					<button
						type="button"
						onClick={() => setProviderModalOpen(true)}
						title={`${provider.label} (${provider.modelName})`}
						className={cn(
							"inline-flex h-8 max-w-[230px] cursor-pointer items-center gap-1.5 truncate rounded-md border px-2.5 text-[11.5px] font-semibold whitespace-nowrap transition-colors",
							provider.mode === "demo"
								? "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
								: "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
						)}
					>
						<span
							className={cn(
								"h-2 w-2 shrink-0 rounded-full",
								provider.mode === "demo" ? "bg-amber-600" : "bg-emerald-600",
							)}
						/>
						<span className="truncate">{providerBadgeText}</span>
					</button>
				</div>
			</header>

			{/* 3-PANEL FIXED DESKTOP / LAPTOP WORKSPACE */}
			<div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[216px_minmax(0,1fr)_268px] xl:grid-cols-[248px_minmax(0,1fr)_324px]">
				{/* LEFT SIDEBAR */}
				<aside className="flex min-w-0 flex-col overflow-y-auto border-b border-slate-200 bg-white px-3 py-4 md:border-r md:border-b-0">
					<div className="px-2 pb-2 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
						Workspace
					</div>
					<nav className="space-y-1">
						{[
							{ id: "stream" as const, label: "Live Agent Stream", icon: Activity },
							{ id: "inbound" as const, label: "Inbound Sources", icon: FileUp },
							{ id: "summary" as const, label: "Corridor Summary", icon: BarChart3 },
						].map((item) => {
							const Icon = item.icon
							const active = view === item.id
							return (
								<button
									key={item.id}
									type="button"
									onClick={() => setView(item.id)}
									className={cn(
										"flex w-full items-center gap-2.5 rounded-md border-l-[3px] px-3 py-2 text-left text-[13px] transition-colors",
										active
											? "border-l-slate-900 bg-slate-100 font-bold text-slate-900"
											: "border-l-transparent font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-900",
									)}
								>
									<Icon className="h-4 w-4 shrink-0" />
									<span className="truncate">{item.label}</span>
								</button>
							)
						})}
					</nav>

					<div className="my-4 h-px bg-slate-100" />

					<div className="px-2 pb-2 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
						Autonomous Triggers
					</div>
					<div className="space-y-2">
						<Button className="w-full justify-start" onClick={() => void handleStreamBatch()}>
							<Play className="h-3.5 w-3.5" />
							Stream 6-Case Batch
						</Button>
						<Button
							variant="outline"
							className="w-full justify-start"
							onClick={() => setView("inbound")}
						>
							<FileUp className="h-3.5 w-3.5" />
							Drop MT103 / CSV / PDF
						</Button>
						<Button
							variant="outline"
							className="w-full justify-start"
							onClick={() => void handleTriggerWebhook()}
						>
							<Webhook className="h-3.5 w-3.5" />
							Send Webhook Event
						</Button>
					</div>

					<div className="mt-auto border-t border-slate-200 pt-4">
						<div className="px-1 pb-2 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
							System Status
						</div>
						<div className="space-y-1.5 px-1 text-xs text-slate-600">
							<div className="flex items-center gap-2">
								<span className="h-2 w-2 rounded-full bg-emerald-600" />
								<span>Mozaik @mozaik-ai/core 6.0</span>
							</div>
							<div className="flex items-center gap-2">
								<span className="h-2 w-2 rounded-full bg-emerald-600" />
								<span>ECB Frankfurter API + Cache</span>
							</div>
							<div className="flex items-center gap-2">
								<span
									className={cn(
										"h-2 w-2 rounded-full",
										sseConnected ? "bg-emerald-600" : "bg-amber-500",
									)}
								/>
								<span>{sseConnected ? "SSE Stream Active" : "SSE Reconnecting..."}</span>
							</div>
						</div>
						<Button
							variant="outline"
							className="mt-3 w-full bg-slate-50"
							onClick={() => setProviderModalOpen(true)}
						>
							<Settings className="h-3.5 w-3.5" />
							AI Model / API Key
						</Button>
					</div>
				</aside>

				{/* CENTER MAIN PANEL */}
				<main className="min-w-0 overflow-y-auto px-5 py-5 lg:px-6">
					{view === "stream" && (
						<div className="space-y-3">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<div className="flex flex-wrap items-center gap-2">
									<h1 className="text-lg font-extrabold tracking-tight text-slate-900">
										{activeEntry
											? `${activeEntry.caseId} · ${activeEntry.title}`
											: 'Ready — Click "Stream 6-Case Batch" or Send Inbound Data'}
									</h1>
									{activeEntry?.corridor && (
										<Badge className="font-mono">{activeEntry.corridor}</Badge>
									)}
									{activeEntry && (
										<Badge
											variant={
												activeEntry.pending
													? "warn"
													: activeEntry.verdict
														? verdictBadgeVariant(activeEntry.verdict.status)
														: "neutral"
											}
										>
											{activeEntry.pending
												? "⏸ Paused at Human Gate"
												: activeEntry.verdict
													? activeEntry.verdict.status.replace(/_/g, " ")
													: activeEntry.phase}
										</Badge>
									)}
								</div>

								{activeEntry && (
									<div className="flex items-center gap-1.5">
										<Button
											variant="outline"
											size="sm"
											onClick={() => {
												const next: Record<string, boolean> = {}
												for (const a of visibleAgents) {
													for (const cid of Object.keys(a.tools)) next[cid] = true
												}
												setExpandedTools((prev) => ({ ...prev, ...next }))
											}}
										>
											Expand All Tools
										</Button>
										<Button variant="outline" size="sm" onClick={() => setExpandedTools({})}>
											Collapse All
										</Button>
									</div>
								)}
							</div>

							{caseOrder.length > 0 && (
								<div className="flex flex-wrap gap-1.5">
									{caseOrder.map((cid) => {
										const c = casesMap[cid]
										if (!c) return null
										return (
											<button
												key={cid}
												type="button"
												onClick={() => setActiveCaseId(cid)}
												className={cn(
													"rounded-md border px-2.5 py-1 font-mono text-[11.5px] font-semibold transition-colors",
													cid === activeCaseId
														? "border-slate-900 bg-slate-100 text-slate-900"
														: "border-slate-200 bg-white text-slate-500 hover:text-slate-900",
												)}
											>
												{cid}
												{c.pending ? " ⏸" : c.verdict ? " ✓" : ""}
											</button>
										)
									})}
								</div>
							)}

							{visibleAgents.length > 0 && (
								<div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
									{visibleAgents.map((a) => (
										<Card
											key={a.name}
											className={cn(
												"border-t-[3px] p-3",
												ROLE_BORDER[a.name] || "border-t-slate-900",
												a.status === "paused" && "border-amber-400 border-t-amber-600 bg-amber-50",
											)}
										>
											<div className="mb-1 flex items-center justify-between gap-2">
												<span className="truncate text-xs font-bold text-slate-900">
													{a.name}
												</span>
												<Badge
													variant={
														a.status === "paused"
															? "warn"
															: a.status === "done"
																? "ok"
																: "neutral"
													}
												>
													{a.status === "paused"
														? "NEEDS YOU"
														: a.status === "done"
															? "DONE"
															: "RUNNING"}
												</Badge>
											</div>
											<div className="font-mono text-[11px] text-slate-500">
												{Object.keys(a.tools).length} tool(s) ·{" "}
												{a.status === "done" ? a.elapsed : "active"}
											</div>
										</Card>
									))}
								</div>
							)}

							{activeEntry && activeEntry.overlaps.length > 0 && (
								<Card className="flex flex-wrap items-center gap-3 px-3.5 py-2.5 text-xs">
									<span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
										Cross-Check:
									</span>
									{activeEntry.overlaps.map((o, idx) => (
										<span key={`${o.left}-${idx}`} className="inline-flex items-center gap-1.5">
											<span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-700">
												{o.left}
											</span>
											<Badge variant={o.tone}>
												{o.relation === "contradicts" ? "⚡ Contradicts" : "✓ In Sync"}
											</Badge>
											<span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-700">
												{o.right}
											</span>
										</span>
									))}
								</Card>
							)}

							<Card className="p-4 lg:p-5">
								{!activeEntry ? (
									<div className="py-5 text-sm leading-relaxed text-slate-600">
										Agents are standing by on shared <code className="font-mono text-slate-900">CorridorState</code>. Click{" "}
										<strong className="text-slate-900">Stream 6-Case Batch</strong> in the left sidebar (or upload MT103/CSV/XML/PDF in{" "}
										<strong className="text-slate-900">Inbound Sources</strong>) to watch all 4–5 Mozaik agents execute in parallel, stream tool calls, cross-check cents, and pause at human approval gates.
									</div>
								) : (
									<div className="relative space-y-4 pl-6 before:absolute before:top-2 before:bottom-2 before:left-[8.5px] before:w-[1.5px] before:bg-slate-300">
										{visibleAgents.map((a) => {
											const toolsArr = Object.values(a.tools)
											const rKey = `${activeEntry.caseId}:${a.name}`
											const rOpen = Boolean(openReasoning[rKey])
											const finalMsg = a.finalText || a.streamText
											return (
												<div key={a.name} className="relative">
													<span
														className={cn(
															"absolute top-1 -left-[21px] h-3 w-3 rounded-full border-2 border-white",
															a.status === "paused"
																? "bg-amber-600"
																: a.status === "done"
																	? "bg-emerald-600"
																	: "animate-pulse bg-slate-900",
														)}
													/>
													<div className="flex flex-wrap items-center gap-2">
														<span className="text-[13px] font-bold text-slate-900">{a.name}</span>
														{a.thinking && (
															<span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
																◌ Thinking...
															</span>
														)}
														{a.reasoning && (
															<button
																type="button"
																onClick={() =>
																	setOpenReasoning((p) => ({ ...p, [rKey]: !rOpen }))
																}
																className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600 hover:text-slate-900"
															>
																{rOpen ? (
																	<ChevronDown className="h-3 w-3" />
																) : (
																	<ChevronRight className="h-3 w-3" />
																)}
																Model Reasoning
															</button>
														)}
														<span className="ml-auto font-mono text-[11px] text-slate-400">
															{a.status === "done" ? a.elapsed : a.status}
														</span>
													</div>

													{a.reasoning && rOpen && (
														<pre className="mt-2 whitespace-pre-wrap rounded border-l-2 border-slate-400 bg-slate-50 p-2.5 font-mono text-[11px] text-slate-600">
															{a.reasoning}
														</pre>
													)}

													{toolsArr.length > 0 && (
														<div className="mt-2 flex flex-wrap gap-1.5">
															{toolsArr.map((t) => {
																const isOpen = Boolean(expandedTools[t.callId])
																return (
																	<div key={t.callId} className={cn(isOpen && "w-full")}>
																		<button
																			type="button"
																			onClick={() =>
																				setExpandedTools((p) => ({
																					...p,
																					[t.callId]: !isOpen,
																				}))
																			}
																			className={cn(
																				"inline-flex items-center gap-1 rounded border px-2 py-1 font-mono text-[11px] transition-colors",
																				t.status === "ok"
																					? "border-emerald-200 bg-emerald-50 text-emerald-800"
																					: t.status === "error"
																						? "border-red-200 bg-red-50 text-red-700"
																						: "border-slate-200 bg-slate-100 text-slate-700",
																			)}
																		>
																			{isOpen ? (
																				<ChevronDown className="h-3 w-3" />
																			) : (
																				<ChevronRight className="h-3 w-3" />
																			)}
																			{t.toolName} ·{" "}
																			{t.durationMs !== null ? `${t.durationMs}ms` : "..."}
																		</button>
																		{isOpen && (
																			<pre className="mt-1.5 whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-slate-50 p-2.5 font-mono text-[11px] text-slate-700">
																				{`ARGS:   ${t.argsJson || "{}"}\nRESULT: ${t.resultJson || "running..."}`}
																			</pre>
																		)}
																	</div>
																)
															})}
														</div>
													)}

													{finalMsg && (
														<div className="mt-1.5 whitespace-pre-wrap text-[13px] text-slate-700">
															{finalMsg}
														</div>
													)}
												</div>
											)
										})}
									</div>
								)}
							</Card>

							{/* HUMAN-IN-THE-LOOP MOZAIK BREAKPOINT CARD */}
							{activeEntry?.pending && (
								<Card className="border-amber-400 border-l-[5px] border-l-amber-600 p-4">
									<div className="mb-2 flex items-center justify-between gap-2">
										<div className="flex items-center gap-2 text-sm font-bold text-slate-900">
											<PauseCircle className="h-4 w-4 text-amber-600" />
											Mozaik Breakpoint Paused · Human Approval Required
										</div>
										<Badge variant="warn">{activeEntry.pending.riskLabel}</Badge>
									</div>

									<p className="mb-2.5 text-sm font-semibold text-slate-800">
										&ldquo;{activeEntry.pending.question}&rdquo;
									</p>
									<div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11.5px] text-slate-700">
										{activeEntry.pending.proofLine}
									</div>

									<div className="flex flex-wrap items-center gap-2">
										<Button
											variant="emerald"
											onClick={() => void resolveBreakpoint(activeEntry.pending!.caseId, "approve")}
										>
											<Check className="h-3.5 w-3.5" />
											Approve Claim [Ctrl+↵]
										</Button>
										<Button variant="outline" onClick={() => setShowSteerBox((s) => !s)}>
											<X className="h-3.5 w-3.5" />
											Reject &amp; Steer [Esc]
										</Button>
										<Button
											variant="destructive"
											onClick={() => void resolveBreakpoint(activeEntry.pending!.caseId, "stop")}
										>
											<Square className="h-3 w-3" />
											Stop Case
										</Button>
									</div>

									{showSteerBox && (
										<div className="mt-3 flex flex-wrap gap-2">
											<input
												type="text"
												autoFocus
												value={steerReason}
												onChange={(e) => setSteerReason(e.target.value)}
												placeholder="Type instruction for AuditorAgent (e.g. Client agreed to split fee — treat as SHA)"
												className="h-9 min-w-[240px] flex-1 rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-900 focus:border-emerald-600 focus:outline-none"
											/>
											<Button
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
								</Card>
							)}
						</div>
					)}

					{view === "inbound" && (
						<InboundSourcesView
							onTriggerWebhook={handleTriggerWebhook}
							onIngested={() => setView("stream")}
						/>
					)}

					{view === "summary" && (
						<CorridorSummaryView
							verdicts={verdicts}
							onSelectCase={(cid) => {
								setModalTab("ledger")
								setModalCaseId(cid)
							}}
						/>
					)}
				</main>

				{/* RIGHT PANEL: 3-TAB ARTIFACTS, CASES & LEDGER */}
				<aside className="flex min-w-0 flex-col overflow-hidden border-t border-slate-200 bg-white md:border-t-0 md:border-l">
					<div className="m-3 grid grid-cols-3 gap-1 rounded-md border border-slate-200 bg-slate-100 p-1">
						{[
							{ id: "cases" as const, label: `Cases (${verdicts.length})` },
							{ id: "artifacts" as const, label: "Artifacts" },
							{ id: "ledger" as const, label: "Ledger" },
						].map((tab) => (
							<button
								key={tab.id}
								type="button"
								onClick={() => setRightTab(tab.id)}
								className={cn(
									"rounded py-1.5 text-[11.5px] font-semibold transition-all",
									rightTab === tab.id
										? "bg-white text-slate-900 shadow-sm"
										: "text-slate-500 hover:text-slate-900",
								)}
							>
								{tab.label}
							</button>
						))}
					</div>

					<div className="flex-1 space-y-2 overflow-y-auto px-3 pb-4">
						{rightTab === "cases" &&
							(verdicts.length === 0 ? (
								<div className="px-1 py-3 text-xs text-slate-500">
									Completed case verdicts and dispute artifacts will appear here.
								</div>
							) : (
								verdicts.map((v) => {
									const ccy = v.numbers.settledCurrency
									const delta =
										v.numbers.recoverableFeeMinor > 0
											? `Recover: ${fmtClientMoney(v.numbers.recoverableFeeMinor, ccy)} · FX: ${fmtClientMoney(-v.numbers.fxSpreadLossMinor, ccy)}`
											: v.numbers.unexplainedVarianceMinor !== 0
												? `Variance: ${fmtClientMoney(v.numbers.unexplainedVarianceMinor, ccy)}`
												: `Variance: ${fmtClientMoney(0, ccy)} · FX: ${fmtClientMoney(v.numbers.fxSpreadLossMinor, ccy)}`
									return (
										<Card
											key={v.caseId}
											onClick={() => {
												setModalTab("ledger")
												setModalCaseId(v.caseId)
											}}
											className={cn(
												"cursor-pointer p-3 transition-colors hover:border-slate-300",
												v.caseId === activeCaseId && "border-amber-400 bg-amber-50/70",
											)}
										>
											<div className="mb-1 flex items-center justify-between gap-2">
												<strong className="truncate font-mono text-xs text-slate-900">
													{v.caseId} · {v.invoiceId}
												</strong>
												<Badge variant={verdictBadgeVariant(v.status)}>
													{v.status.replace(/_/g, " ")}
												</Badge>
											</div>
											<div className="font-mono text-[11.5px] text-slate-600">{delta}</div>
											<div className="mt-2.5 flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
												<Button
													variant="outline"
													size="sm"
													onClick={() => {
														setModalTab("technical")
														setModalCaseId(v.caseId)
													}}
												>
													Full Fields
													<ArrowUpRight className="h-3 w-3" />
												</Button>
												{v.disputeNotice && (
													<Button
														variant="outline"
														size="sm"
														onClick={() => {
															setModalTab("letter")
															setModalCaseId(v.caseId)
														}}
													>
														Dispute.txt
													</Button>
												)}
												<a
													href={`/api/report/${encodeURIComponent(v.caseId)}?format=json`}
													download
													className="inline-flex h-7 items-center rounded border border-slate-300 bg-white px-2.5 text-[11.5px] font-semibold text-slate-700 hover:bg-slate-50"
												>
													JSON
												</a>
											</div>
										</Card>
									)
								})
							))}

						{rightTab === "artifacts" &&
							(verdicts.length === 0 ? (
								<div className="px-1 py-3 text-xs text-slate-500">No downloadable artifacts yet.</div>
							) : (
								verdicts.map((v) => (
									<Card key={v.caseId} className="p-3">
										<div className="mb-2 font-mono text-xs font-bold text-slate-900">{v.caseId}</div>
										<div className="flex flex-wrap gap-1.5">
											<a
												href={`/api/report/${encodeURIComponent(v.caseId)}?format=txt`}
												download
												className="inline-flex h-7 items-center gap-1 rounded border border-slate-300 bg-white px-2.5 text-[11.5px] font-semibold text-slate-700 hover:bg-slate-50"
											>
												<Download className="h-3 w-3" />
												Dispute / Cert (.txt)
											</a>
											<a
												href={`/api/report/${encodeURIComponent(v.caseId)}?format=json`}
												download
												className="inline-flex h-7 items-center gap-1 rounded border border-slate-300 bg-white px-2.5 text-[11.5px] font-semibold text-slate-700 hover:bg-slate-50"
											>
												<Download className="h-3 w-3" />
												Full Audit (.json)
											</a>
										</div>
									</Card>
								))
							))}

						{rightTab === "ledger" &&
							(ledgerEvents.length === 0 ? (
								<div className="px-1 py-3 text-xs text-slate-500">
									Ledger events stream here as agents finalize audits.
								</div>
							) : (
								<div className="divide-y divide-slate-100">
									{ledgerEvents.map((l, idx) => (
										<div key={`${l.timestamp}-${idx}`} className="px-1 py-2 text-xs">
											<div className="font-mono text-[10.5px] text-slate-400">
												{l.timestamp.slice(11, 19)} · {l.caseId}
											</div>
											<div className="text-slate-700">{l.summary}</div>
										</div>
									))}
								</div>
							))}
					</div>
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
