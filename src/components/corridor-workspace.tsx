"use client"

import {
	Activity,
	ArrowUpRight,
	BarChart3,
	Check,
	ChevronDown,
	ChevronRight,
	Database,
	Download,
	FileUp,
	PauseCircle,
	PanelLeftClose,
	PanelLeftOpen,
	PanelRightClose,
	PanelRightOpen,
	Play,
	Moon,
	Settings,
	Square,
	Sun,
	TerminalSquare,
	Webhook,
	X,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { SelectBox } from "@/components/ui/select-box"
import { AuthLogout } from "@/components/auth-logout"
import type { AuditVerdict, PendingBreakpointDecision, TrajectoryEvent } from "@/core/types"
import { BUILD_PROVENANCE, formatBuildLabel } from "@/core/build-info"
import { cn } from "@/lib/utils"
import { BrandLogo } from "./brand-logo"
import { CaseInspectorModal } from "./case-inspector-modal"
import { CorridorSummaryView } from "./corridor-summary-view"
import {
	type AgentRunState,
	type CaseStreamEntry,
	fmtClientMoney,
	formatModelDisplayName,
	type LedgerLogItem,
	ORDERED_AGENTS,
	type OverlapSignal,
	type ProviderStatus,
	type QueueStats,
	verdictBadgeVariant,
	verdictStatusLabel,
} from "./corridor-types"
import { InboundSourcesView } from "./inbound-sources-view"
import { RawVaultView } from "./raw-vault-view"
import { SettingsView } from "./settings-view"
import { type RuntimeConsoleEvent, WorkbenchTerminal } from "./workbench-terminal"

type WorkspaceView = "stream" | "inbound" | "vault" | "summary" | "settings"
type RightTab = "cases" | "artifacts" | "ledger"
type ModalTab = "ledger" | "technical" | "letter" | "preview" | "trace"
type ColorTheme = "dark" | "light"
type ViewTransitionDocument = Document & {
	startViewTransition?: (callback: () => void) => { finished: Promise<void> }
}

function createEmptyCase(caseId: string): CaseStreamEntry {
	return {
		caseId,
		title: caseId,
		corridor: "",
		startedAt: Date.now(),
		expectedRoles: [],
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
		segments: [],
		elapsed: "0.0s",
		thinking: false,
		reasoning: "",
		streamText: "",
		finalText: "",
		tools: {},
	}
}

const ROLE_BORDER: Record<string, string> = {
	TermsAgent: "border-t-[#62e1c3]",
	FxBenchmarkAgent: "border-t-emerald-600",
	WireDetectiveAgent: "border-t-amber-600",
	DuplicateAnomalyAgent: "border-t-violet-600",
	AuditorAgent: "border-t-emerald-700",
}

const AGENT_LANES: Array<{ name: string; label: string; scope: string; role: string; color: string; conditional?: boolean }> = [
	{ name: "TermsAgent", label: "Terms review", scope: "CONTRACT / INVOICE", role: "terms", color: "#62e1c3" },
	{ name: "FxBenchmarkAgent", label: "FX benchmark", scope: "RATE / SPREAD", role: "fx", color: "#62e1c3" },
	{ name: "WireDetectiveAgent", label: "Wire reconciliation", scope: "SWIFT / MT103", role: "wire", color: "#62e1c3" },
	{ name: "DuplicateAnomalyAgent", label: "Anomaly scan", scope: "DUPLICATE / BENEFICIARY", role: "anomaly", color: "#e8b45e", conditional: true },
	{ name: "AuditorAgent", label: "Auditor cross-check", scope: "INDEPENDENT CHECK", role: "auditor", color: "#74b9ff" },
]

export function CorridorWorkspace() {
	const [theme, setTheme] = useState<ColorTheme>("dark")
	const themeToggleRef = useRef<HTMLButtonElement>(null)
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
		provider: "nvidia",
		label: "NVIDIA NIM ($0 Free Credits)",
		modelName: "nvidia/nemotron-3.5-super-vl-120b-a12b",
		hasKey: false,
		mode: "unconfigured",
	})
	const [breakpointMode, setBreakpointMode] = useState<"risk_only" | "step_tool">("risk_only")
	const [sseConnected, setSseConnected] = useState(true)
	const [timelineNow, setTimelineNow] = useState(Date.now())
	const [leftCollapsed, setLeftCollapsed] = useState(false)
	const [rightCollapsed, setRightCollapsed] = useState(false)
	const [rightDrawerOpen, setRightDrawerOpen] = useState(false)
	const [terminalOpen, setTerminalOpen] = useState(true)
	const [terminalHeight, setTerminalHeight] = useState(164)
	const [terminalEvents, setTerminalEvents] = useState<RuntimeConsoleEvent[]>([])
	const [reviewActionError, setReviewActionError] = useState<string | null>(null)

	useEffect(() => {
		const savedTheme = localStorage.getItem("corridor-theme")
		const initialTheme: ColorTheme = savedTheme === "light" ? "light" : "dark"
		document.documentElement.dataset.theme = initialTheme
		setTheme(initialTheme)
	}, [])

	const toggleTheme = () => {
		const nextTheme: ColorTheme = theme === "dark" ? "light" : "dark"
		const root = document.documentElement
		const toggleBounds = themeToggleRef.current?.getBoundingClientRect()
		if (toggleBounds) {
			root.style.setProperty("--theme-origin-x", `${toggleBounds.left + toggleBounds.width / 2}px`)
			root.style.setProperty("--theme-origin-y", `${toggleBounds.top + toggleBounds.height / 2}px`)
		}

		const applyTheme = () => {
			root.dataset.theme = nextTheme
			localStorage.setItem("corridor-theme", nextTheme)
			setTheme(nextTheme)
		}
		const transitionDocument = document as ViewTransitionDocument

		if (transitionDocument.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			root.classList.add("theme-transition")
			const transition = transitionDocument.startViewTransition(applyTheme)
			void transition.finished.then(
				() => root.classList.remove("theme-transition"),
				() => root.classList.remove("theme-transition"),
			)
		} else {
			applyTheme()
		}
	}

	const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({})
	const [openReasoning, setOpenReasoning] = useState<Record<string, boolean>>({})
	const [showSteerBox, setShowSteerBox] = useState(false)
	const [steerReason, setSteerReason] = useState("")

	const [modalCaseId, setModalCaseId] = useState<string | null>(null)
	const [modalTab, setModalTab] = useState<ModalTab>("ledger")
	const [providerModalOpen, setProviderModalOpen] = useState(false)

	const quickFileInputRef = useRef<HTMLInputElement | null>(null)
	const [sidebarDragging, setSidebarDragging] = useState(false)
	const [quickUploadStage, setQuickUploadStage] = useState<"idle" | "uploading" | "processing" | "ingested" | "error">("idle")
	const [quickUploadLabel, setQuickUploadLabel] = useState<string>("")
	const [topToast, setTopToast] = useState<{ title: string; subtitle: string; kind: "ok" | "error" } | null>(null)

	const handleQuickUploadFile = useCallback(async (file: File) => {
		try {
			setQuickUploadStage("uploading")
			setQuickUploadLabel(`Uploading ${file.name}...`)
			let payload: Record<string, unknown>
			const lowerName = file.name.toLowerCase()
			if (lowerName.endsWith(".pdf") || /\.(png|jpe?g|webp)$/.test(lowerName)) {
				const buf = await file.arrayBuffer()
				const bytes = new Uint8Array(buf)
				let binary = ""
				for (let i = 0; i < bytes.length; i += 0x8000) {
					binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
				}
				payload = { filename: file.name, base64: btoa(binary), format: lowerName.endsWith(".pdf") ? "pdf" : "image" }
			} else {
				payload = { filename: file.name, content: await file.text(), format: "auto" }
			}
			setQuickUploadStage("processing")
			setQuickUploadLabel("Processing & indexing to Raw Vault...")
			const res = await fetch("/api/audit/upload", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			})
			const json = (await res.json().catch(() => ({}))) as { error?: string; queuedCount?: number; duplicate?: boolean; caseIds?: string[] }
			if (!res.ok) throw new Error(json.error || `Upload failed (HTTP ${res.status})`)
			if (json.duplicate) {
				const existingCount = json.caseIds?.length ?? 0
				setQuickUploadStage("ingested")
				setQuickUploadLabel(`Already ingested · ${existingCount} existing case${existingCount === 1 ? "" : "s"}`)
				setTopToast({
					title: `${file.name} already in Raw Data Vault`,
					subtitle: `Skipped duplicate processing (${existingCount} existing case${existingCount === 1 ? "" : "s"}).`,
					kind: "ok",
				})
			} else {
				const count = json.queuedCount ?? 1
				setQuickUploadStage("ingested")
				setQuickUploadLabel(`Ingested (${count}) · Live agents running`)
				setTopToast({
					title: `Ingested ${file.name} into Raw Data Vault`,
					subtitle: `Live agent stream is running now (${count} case${count === 1 ? "" : "s"}).`,
					kind: "ok",
				})
			}
			setView("stream")
			void refreshHistory()
			if (typeof BroadcastChannel !== "undefined") {
				const ch = new BroadcastChannel("corridor-audit-sync")
				ch.postMessage({ type: "sync" })
				ch.close()
			}
			setTimeout(() => setTopToast(null), 6000)
			setTimeout(() => setQuickUploadStage((s) => (s === "ingested" ? "idle" : s)), 8000)
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			setQuickUploadStage("error")
			setQuickUploadLabel(msg)
			setTopToast({ title: "Upload failed", subtitle: msg, kind: "error" })
			setTimeout(() => setTopToast(null), 6000)
		}
	}, [])

	const refreshHistory = useCallback(async () => {
		try {
			const res = await fetch("/api/history", { cache: "no-store" })
			if (!res.ok) return
			const data = (await res.json()) as {
				verdicts: AuditVerdict[]
				ledgerEvents: LedgerLogItem[]
				queueStats: QueueStats
				pendingApprovals?: PendingBreakpointDecision[]
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
					const agents: Record<string, AgentRunState> = {}
					let startedAt = existing.startedAt
					let expectedRoles = existing.expectedRoles
					for (const evt of item.trajectory || []) {
						const at = Date.parse(evt.timestamp)
						if (evt.kind === "case.queued" && Number.isFinite(at)) startedAt = at
						const caseInfo = evt.payload?.caseInfo as { expectedRoles?: string[] } | undefined
						if (caseInfo?.expectedRoles) expectedRoles = caseInfo.expectedRoles
						if (evt.agentName && ["agent.started", "agent.completed", "breakpoint.paused", "breakpoint.resolved"].includes(evt.kind)) {
							const agent = { ...(agents[evt.agentName] || createEmptyAgent(evt.agentName)) }
							if (evt.kind === "agent.started") { agent.startedAt = at; agent.status = "running"; agent.segments = [...agent.segments, { startedAt: at }] }
							if (evt.kind === "agent.completed") { agent.finishedAt = at; agent.status = "done"; agent.segments = agent.segments.map((segment, index) => index === agent.segments.length - 1 && segment.endedAt === undefined ? { ...segment, endedAt: at } : segment); agent.elapsed = `${Math.max(0, (at - agent.startedAt) / 1000).toFixed(1)}s`; agent.finalText = evt.text || agent.finalText }
							if (evt.kind === "breakpoint.paused") { agent.status = "paused"; agent.segments = agent.segments.map((segment, index) => index === agent.segments.length - 1 && segment.endedAt === undefined ? { ...segment, endedAt: at } : segment) }
							if (evt.kind === "breakpoint.resolved") { agent.status = "running"; agent.segments = [...agent.segments, { startedAt: at }] }
							agents[evt.agentName] = agent
						}
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
						}
					}
					next[item.caseId] = {
						...existing,
						title: item.title,
						corridor: item.corridor,
						startedAt,
						expectedRoles,
						verdict: item.verdict,
						technical: item,
						agents,
					}
				}
				const pendingByCase = new Map((data.pendingApprovals || []).map((approval) => [approval.caseId, approval]))
				for (const [caseId, current] of Object.entries(next)) {
					if (current.pending && !pendingByCase.has(caseId)) next[caseId] = { ...current, pending: null }
				}
				for (const approval of pendingByCase.values()) {
					const current = next[approval.caseId] || createEmptyCase(approval.caseId)
					next[approval.caseId] = { ...current, pending: approval }
				}
				return next
			})
			setCaseOrder((prev) => {
				const ids = new Set(prev)
				for (const item of data.cases || []) ids.add(item.caseId)
				return [...ids]
			})
			if (data.cases?.length) {
				setActiveCaseId((curr) => curr ?? data.cases[data.cases.length - 1].caseId)
			}
		} catch {
			// ignore transient network glitches
		}
	}, [])

	useEffect(() => {
		try {
			const saved = JSON.parse(localStorage.getItem("corridor-workbench-layout") || "{}") as {
				leftCollapsed?: boolean
				rightCollapsed?: boolean
				terminalOpen?: boolean
				terminalHeight?: number
			}
			if (window.innerWidth < 1120) {
				setLeftCollapsed(true)
				setRightCollapsed(true)
			} else {
				if (typeof saved.leftCollapsed === "boolean") setLeftCollapsed(saved.leftCollapsed)
				if (typeof saved.rightCollapsed === "boolean") setRightCollapsed(saved.rightCollapsed)
			}
			if (typeof saved.terminalOpen === "boolean") setTerminalOpen(saved.terminalOpen)
			if (typeof saved.terminalHeight === "number") setTerminalHeight(Math.max(140, Math.min(180, saved.terminalHeight)))
		} catch {
			// Use the default workspace layout when browser storage is unavailable.
		}
	}, [])

	useEffect(() => {
		const compactPanels = () => {
			if (window.innerWidth < 1120) {
				setLeftCollapsed(true)
				setRightCollapsed(true)
			}
		}
		window.addEventListener("resize", compactPanels)
		return () => window.removeEventListener("resize", compactPanels)
	}, [])

	useEffect(() => {
		try {
			localStorage.setItem("corridor-workbench-layout", JSON.stringify({ leftCollapsed, rightCollapsed, terminalOpen, terminalHeight }))
		} catch {
			// Layout preferences are optional.
		}
	}, [leftCollapsed, rightCollapsed, terminalOpen, terminalHeight])

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (!(event.ctrlKey || event.metaKey)) return
			if (event.altKey && event.key.toLowerCase() === "b") {
				event.preventDefault()
				setRightCollapsed((value) => !value)
			} else if (!event.altKey && event.key.toLowerCase() === "b") {
				event.preventDefault()
				setLeftCollapsed((value) => !value)
			} else if (!event.altKey && event.key.toLowerCase() === "j") {
				event.preventDefault()
				setTerminalOpen((value) => !value)
			}
		}
		window.addEventListener("keydown", onKeyDown)
		return () => window.removeEventListener("keydown", onKeyDown)
	}, [])

	useEffect(() => {
		let cancelled = false
		void (async () => {
			try {
				const health = (await (await fetch("/api/runtime/status", { cache: "no-store" })).json()) as {
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

		let hasConnectedOnce = false
		const es = new EventSource("/api/events")
		es.onopen = () => {
			setSseConnected(true)
			if (hasConnectedOnce && !cancelled) void refreshHistory()
			hasConnectedOnce = true
		}
		es.onerror = () => setSseConnected(false)

		const syncIfVisible = () => {
			if (!cancelled && document.visibilityState === "visible") {
				void refreshHistory()
			}
		}
		document.addEventListener("visibilitychange", syncIfVisible)
		window.addEventListener("focus", syncIfVisible)

		let syncChannel: BroadcastChannel | null = null
		if (typeof BroadcastChannel !== "undefined") {
			syncChannel = new BroadcastChannel("corridor-audit-sync")
			syncChannel.onmessage = () => {
				if (!cancelled) void refreshHistory()
			}
		}
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
				if (["case.queued", "agent.started", "agent.completed", "tool.started", "tool.completed", "breakpoint.paused", "breakpoint.resolved", "audit.verdict", "error"].includes(evt.kind)) {
					setTerminalEvents((prev) => [...prev, {
						id: evt.id,
						timestamp: evt.timestamp,
						kind: evt.kind,
						text: evt.text || (evt.kind === "audit.verdict" ? String((evt.payload?.verdict as AuditVerdict | undefined)?.status ?? "Verdict recorded") : ""),
						agentName: evt.agentName,
						toolName: evt.toolName,
						caseId: evt.caseId,
					}].slice(-160))
				}
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
					const parsedAt = Date.parse(evt.timestamp)
					const eventAt = Number.isFinite(parsedAt) ? parsedAt : Date.now()

					if (evt.kind === "case.queued") {
						updated.startedAt = eventAt
						updated.agents = {}
					} else if (evt.kind === "phase.changed") {
						if (evt.phase) updated.phase = evt.phase
						const ci = evt.payload?.caseInfo as { title?: string; corridor?: string; expectedRoles?: string[] } | undefined
						if (ci?.title) updated.title = ci.title
						if (ci?.corridor) updated.corridor = ci.corridor
						if (ci?.expectedRoles) updated.expectedRoles = ci.expectedRoles
					} else if (evt.kind === "agent.started" && evt.agentName) {
						const a = { ...(updated.agents[evt.agentName] || createEmptyAgent(evt.agentName)) }
						a.status = "running"
						a.startedAt = eventAt
						a.finishedAt = undefined
						a.segments = [...a.segments, { startedAt: eventAt }]
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
						a.finishedAt = eventAt
						a.segments = a.segments.map((segment, index) => index === a.segments.length - 1 && segment.endedAt === undefined ? { ...segment, endedAt: eventAt } : segment)
						a.elapsed = `${Math.max(0, (eventAt - a.startedAt) / 1000).toFixed(1)}s`
						a.finalText = evt.text || a.streamText
						updated.agents[evt.agentName] = a
					} else if (evt.kind === "overlap.updated" && evt.payload?.overlaps) {
						updated.overlaps = evt.payload.overlaps as OverlapSignal[]
					} else if (evt.kind === "breakpoint.paused" && evt.payload?.pending) {
						updated.pending = evt.payload.pending as PendingBreakpointDecision
						const a = { ...(updated.agents.AuditorAgent || createEmptyAgent("AuditorAgent")) }
						a.status = "paused"
						a.segments = a.segments.map((segment, index) => index === a.segments.length - 1 && segment.endedAt === undefined ? { ...segment, endedAt: eventAt } : segment)
						updated.agents.AuditorAgent = a
						setShowSteerBox(false)
					} else if (evt.kind === "breakpoint.resolved") {
						updated.pending = null
						const a = { ...(updated.agents.AuditorAgent || createEmptyAgent("AuditorAgent")) }
						a.status = "running"
						a.segments = [...a.segments, { startedAt: eventAt }]
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
			document.removeEventListener("visibilitychange", syncIfVisible)
			window.removeEventListener("focus", syncIfVisible)
			syncChannel?.close()
			es.close()
		}
	}, [refreshHistory])

	const resolveBreakpoint = useCallback(
		async (caseId: string, decision: "approve" | "reject" | "stop", reason?: string, approvalId?: string) => {
			const response = await fetch(`/api/breakpoints/${encodeURIComponent(caseId)}/resolve`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ approvalId, decision, reason }),
			})
			if (response.ok) {
				setReviewActionError(null)
				setCasesMap((prev) => {
					const current = prev[caseId]
					return current ? { ...prev, [caseId]: { ...current, pending: null } } : prev
				})
			} else {
				const payload = await response.json().catch(() => null) as { error?: string } | null
				setReviewActionError(payload?.error || `Review action failed (${response.status}).`)
			}
		},
		[],
	)

	const activeEntry = activeCaseId ? casesMap[activeCaseId] || null : null
	const modalEntry = modalCaseId ? casesMap[modalCaseId] || null : null
	const hasRunningAgent = Boolean(activeEntry && Object.values(activeEntry.agents).some((agent) => agent.status === "running"))

	useEffect(() => {
		if (!hasRunningAgent) return
		const timer = window.setInterval(() => setTimelineNow(Date.now()), 500)
		return () => window.clearInterval(timer)
	}, [hasRunningAgent])

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (modalCaseId) setModalCaseId(null)
				else if (providerModalOpen) setProviderModalOpen(false)
				else if (activeEntry?.pending) setShowSteerBox(true)
			} else if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && activeEntry?.pending) {
				void resolveBreakpoint(activeEntry.pending.caseId, "approve", undefined, activeEntry.pending.approvalId)
			}
		}
		window.addEventListener("keydown", onKeyDown)
		return () => window.removeEventListener("keydown", onKeyDown)
	}, [modalCaseId, providerModalOpen, activeEntry, resolveBreakpoint])

	const visibleAgents = activeEntry
		? ORDERED_AGENTS.map((name) => activeEntry.agents[name]).filter((a): a is AgentRunState => Boolean(a))
		: []

	const providerBadgeText =
		provider.mode === "unconfigured"
			? `${provider.provider.toUpperCase()} · No Key`
			: `${provider.provider.toUpperCase()} · ${provider.modelName}`

	return (
		<div className="workbench-shell flex h-screen flex-col gap-2 overflow-hidden bg-[#080d12] p-2">
			{/* SLIM INSTITUTIONAL TOP BAR */}
			<header className="sticky top-0 z-20 flex h-11 shrink-0 items-center justify-between gap-2 rounded-xl border border-[#1c2a33] bg-[#0d141b] px-3">
				<div className="flex shrink-0 items-center gap-2.5 whitespace-nowrap">
					<BrandLogo size={28} />
					<span className="text-base font-extrabold tracking-tight text-[#e3edef]">
						Corridor<span className="text-[#62e1c3]">Audit</span>
					</span>
					<span className="hidden rounded-lg bg-[#101820] px-2 py-0.5 font-mono text-[10px] font-semibold text-[#81949a] xl:inline-block">
						Next.js · Mozaik 6.0
					</span>
					<span
						data-tooltip={`App v${BUILD_PROVENANCE.appVersion} · Source ${BUILD_PROVENANCE.sourceRevision} · ${BUILD_PROVENANCE.workingTree} tree · Audit rules v${BUILD_PROVENANCE.auditRulesVersion}`}
						className="hidden rounded-lg bg-[#0d2725] px-2 py-0.5 font-mono text-[10px] font-semibold text-[#75e4c7] md:inline-block"
					>
						{formatBuildLabel()}
					</span>
				</div>

				<div className="flex min-w-0 items-center gap-2">
					<span className="hidden truncate rounded-lg bg-[#101820] px-2.5 py-1 text-[11.5px] font-medium text-[#a4b4b8] xl:inline-block">
						Live ECB Benchmark · Not Financial Advice
					</span>
					<span className="hidden shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-[#1c2a33] bg-[#0d141b] px-2.5 py-1 font-mono text-[11.5px] text-[#c7d3d6] tabular 2xl:inline-flex">
						<span className="h-2 w-2 rounded-[3px] bg-emerald-600" />
						Batch: {queueStats.waiting} wait · {queueStats.active} active · {queueStats.done} done
					</span>
				</div>

				{topToast && (
					<div
						role="status"
						className={cn(
							"fixed top-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border px-4 py-2.5 shadow-2xl backdrop-blur-md",
							topToast.kind === "ok"
								? "border-[#2c4a43] bg-[#0d1f1c]/95 text-[#e3edef]"
								: "border-red-800/80 bg-red-950/95 text-red-100",
						)}
					>
						<span
							className={cn(
								"h-2.5 w-2.5 shrink-0 rounded-full",
								topToast.kind === "ok" ? "animate-pulse bg-[#62e1c3]" : "bg-red-400",
							)}
						/>
						<div className="min-w-0">
							<div className="text-xs font-bold">{topToast.title}</div>
							<div className="text-[11px] text-[#9fb2b8]">{topToast.subtitle}</div>
						</div>
						{topToast.kind === "ok" && (
							<button
								type="button"
								onClick={() => {
									setView("stream")
									setTopToast(null)
								}}
								className="rounded-md border border-[#2c4a43] bg-[#14352d] px-2.5 py-1 text-[11px] font-semibold text-[#62e1c3] hover:bg-[#1a443a]"
							>
								View Live
							</button>
						)}
						<button
							type="button"
							aria-label="Dismiss notification"
							onClick={() => setTopToast(null)}
							className="text-xs text-[#81949a] hover:text-[#e3edef]"
						>
							×
						</button>
					</div>
				)}

				<div className="flex shrink-0 items-center gap-1.5">
					<button
						ref={themeToggleRef}
						type="button"
						aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
						data-tooltip={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
						onClick={toggleTheme}
						className="rounded-md p-1.5 text-[#81949a] transition-colors hover:bg-[#101820] hover:text-[#e3edef]"
					>
						{theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
					</button>
					<button type="button" aria-label="Toggle navigation panel" data-tooltip="Toggle navigation (Ctrl+B)" onClick={() => setLeftCollapsed((v) => !v)} className="hidden rounded p-1.5 text-[#81949a] hover:bg-[#101820] hover:text-[#e3edef] md:inline-flex">
						{leftCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
					</button>
					<button type="button" aria-label="Toggle terminal" data-tooltip="Toggle integrated terminal (Ctrl+J)" onClick={() => setTerminalOpen((v) => !v)} className={cn("rounded p-1.5 hover:bg-[#101820]", terminalOpen ? "text-[#75e4c7]" : "text-[#81949a] hover:text-[#e3edef]")}>
						<TerminalSquare className="h-4 w-4" />
					</button>
					<button type="button" aria-label="Toggle inspection panel" data-tooltip="Toggle inspection panel (Ctrl+Alt+B)" onClick={() => setRightCollapsed((v) => !v)} className="hidden rounded p-1.5 text-[#81949a] hover:bg-[#101820] hover:text-[#e3edef] md:inline-flex">
						{rightCollapsed ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
					</button>
					<SelectBox
						value={breakpointMode}
						onChange={async (val) => {
							const mode = val as "risk_only" | "step_tool"
							setBreakpointMode(mode)
							await fetch("/api/settings/provider", {
								method: "POST",
								headers: { "Content-Type": "application/json" },
								body: JSON.stringify({ breakpointMode: mode }),
							})
						}}
						data-tooltip="Mozaik Interruptible Harness Breakpoint Mode"
						className="w-[142px]"
						buttonClassName="h-8 rounded-lg bg-[#0d141b] text-[11px] sm:text-xs"
						options={[
							{ value: "risk_only", label: "Gate: Auto-Risk" },
							{ value: "step_tool", label: "Gate: Step Every Tool" },
						]}
					/>

					{provider.mode === "live" && (provider.discoveredModels?.length ?? 0) > 0 ? (
						<SelectBox
							value={provider.modelName}
							onChange={async (nextModel) => {
								const res = await fetch("/api/settings/provider", {
									method: "POST",
									headers: { "Content-Type": "application/json" },
									body: JSON.stringify({ provider: provider.provider, modelName: nextModel }),
								})
								const data = (await res.json()) as { provider?: ProviderStatus }
								if (data.provider) setProvider(data.provider)
							}}
							title={`${provider.label} (${provider.modelName})`}
							className="max-w-[260px]"
							buttonClassName="h-8 rounded-lg border-[#225b51] bg-[#0d2725] text-[11.5px] text-[#75e4c7]"
							options={(provider.discoveredModels ?? [provider.modelName]).map((m) => ({
								value: m,
								label: provider.modelAliases?.[m] || formatModelDisplayName(m),
								description: m,
							}))}
						/>
					) : (
						<button
							type="button"
							onClick={() => setView("settings")}
							data-tooltip={`${provider.label} (${provider.modelName})`}
							className={cn(
								"inline-flex h-8 w-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 truncate rounded-lg border px-0 text-[11.5px] font-semibold whitespace-nowrap transition-colors sm:w-auto sm:px-2.5 xl:max-w-[230px] xl:justify-start",
								provider.mode === "unconfigured"
									? "border-[#674b23] bg-[#2c2111] text-[#f0c77f] hover:bg-[#3a2a14]"
									: "border-[#225b51] bg-[#0d2725] text-[#75e4c7] hover:bg-[#12342e]",
							)}
						>
							<span
								className={cn(
									"h-2 w-2 shrink-0 rounded-[3px]",
									provider.mode === "unconfigured" ? "bg-amber-600" : "bg-emerald-600",
								)}
							/>
							<span className="hidden truncate sm:inline xl:hidden">
								{provider.mode === "unconfigured" ? "No Key" : provider.provider.toUpperCase()}
							</span>
							<span className="hidden truncate xl:inline">{providerBadgeText}</span>
						</button>
					)}
					<AuthLogout />
				</div>
			</header>

			{/* 3-PANEL FIXED DESKTOP / LAPTOP WORKSPACE */}
			<div
				className="workbench-grid grid min-h-0 flex-1 gap-2"
				style={{ "--nav-width": leftCollapsed ? "54px" : "244px", "--inspector-width": rightCollapsed ? "48px" : "320px" } as React.CSSProperties}
			>
				{/* LEFT SIDEBAR */}
				<aside className={cn("hidden min-w-0 flex-col overflow-y-auto rounded-xl border border-[#1c2a33] bg-[#0d141b] py-3 md:flex", leftCollapsed ? "items-center px-1.5" : "px-3")}>
					<div className={cn("flex items-center pb-2", leftCollapsed ? "justify-center" : "justify-between px-2")}>
						{!leftCollapsed && <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#71858c]">Workspace</span>}
						{leftCollapsed && <Activity className="h-4 w-4 text-[#71858c]" />}
					</div>
					{/* primary navigation */}
					<div className="sr-only">
						Workspace
					</div>
					<nav className={cn("w-full", leftCollapsed ? "space-y-1" : "space-y-1")} aria-label="Workspace navigation">
						{[
							{ id: "stream" as const, label: "Live Agent Stream", icon: Activity },
							{ id: "inbound" as const, label: "Data Sources", icon: FileUp },
							{ id: "vault" as const, label: "Raw Data Vault", icon: Database },
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
										"flex w-full items-center rounded-xl border py-2 text-left text-[12px] transition-colors",
										leftCollapsed ? "justify-center border-transparent px-0" : "gap-2.5 px-2.5",
										active
											? "border-[#225b51] bg-[#0d2725] font-bold text-[#75e4c7]"
											: "border-transparent font-medium text-[#81949a] hover:bg-[#080d12] hover:text-[#e3edef]",
									)}
								>
									<Icon className="h-4 w-4 shrink-0" />
									{!leftCollapsed && <span className="truncate">{item.label}</span>}
								</button>
							)
						})}
					</nav>

					<div className="my-3 h-px w-full bg-[#101820]" />

					{!leftCollapsed && <div className="px-2 pb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[#71858c]">
						Autonomous Triggers
					</div>}
					<div className={cn("w-full", leftCollapsed ? "space-y-1" : "space-y-1.5")}>
						<input
							ref={quickFileInputRef}
							type="file"
							accept=".csv,.txt,.xml,.json,.pdf,.png,.jpg,.jpeg,.webp"
							className="hidden"
							onChange={(e) => {
								const file = e.target.files?.[0]
								e.target.value = ""
								if (file) void handleQuickUploadFile(file)
							}}
						/>
						<div
							onDragOver={(e) => {
								e.preventDefault()
								setSidebarDragging(true)
							}}
							onDragLeave={() => setSidebarDragging(false)}
							onDrop={(e) => {
								e.preventDefault()
								setSidebarDragging(false)
								const file = e.dataTransfer.files?.[0]
								if (file) void handleQuickUploadFile(file)
							}}
						>
							<Button
								variant="outline"
								className={cn(
									"w-full transition-colors",
									leftCollapsed ? "justify-center px-0" : "justify-start",
									sidebarDragging && "border-[#62e1c3] bg-[#0e2620]/70 text-[#62e1c3]",
								)}
								data-tooltip="Click or drag & drop a file (.csv, .pdf, .txt, .xml, .json)"
								onClick={() => quickFileInputRef.current?.click()}
							>
								<FileUp className="h-3.5 w-3.5" />
								{!leftCollapsed && (sidebarDragging ? "Drop file to ingest..." : "Upload source")}
							</Button>
							{!leftCollapsed && (
								<div className="mt-1.5 px-1">
									{quickUploadStage === "idle" ? (
										<div className="text-[10.5px] text-[#71858c]">
											Click or drag &amp; drop (.csv, .pdf, .txt, .xml, .json)
										</div>
									) : (
										<div className="space-y-1">
											<div
												className={cn(
													"truncate text-[10.5px] font-medium",
													quickUploadStage === "error"
														? "text-red-400"
														: quickUploadStage === "ingested"
															? "text-[#62e1c3]"
															: "text-amber-300",
												)}
											>
												{quickUploadLabel}
											</div>
											<div className="h-1 w-full overflow-hidden rounded-full bg-[#132029]">
												<div
													className={cn(
														"h-full transition-all duration-300",
														quickUploadStage === "uploading" && "w-1/3 animate-pulse bg-amber-400",
														quickUploadStage === "processing" && "w-2/3 animate-pulse bg-amber-400",
														quickUploadStage === "ingested" && "w-full bg-[#62e1c3]",
														quickUploadStage === "error" && "w-full bg-red-500",
													)}
												/>
											</div>
										</div>
									)}
								</div>
							)}
						</div>
					</div>

					<div className={cn("mt-auto w-full border-t border-[#1c2a33] pt-3", leftCollapsed && "flex flex-col items-center")}>
						{!leftCollapsed && <>
						<div className="px-1 pb-2 text-[10.5px] font-bold uppercase tracking-wider text-[#71858c]">
							System Status
						</div>
						<div className="space-y-1.5 px-1 text-xs text-[#a4b4b8]">
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
										sseConnected ? "bg-emerald-600" : "bg-amber-600",
									)}
								/>
								<span>{sseConnected ? "SSE Stream Active" : "SSE Reconnecting..."}</span>
							</div>
						</div>
						<Button
							variant={view === "settings" ? "emerald" : "outline"}
							className={cn("mt-3 w-full", view !== "settings" && "bg-[#080d12]")}
							onClick={() => setView("settings")}
						>
							<Settings className="h-3.5 w-3.5" />
							System Settings
						</Button>
						</>}
						{leftCollapsed && <button type="button" onClick={() => setView("settings")} data-tooltip={`System settings: ${provider.label}`} aria-label="Open system settings" className="rounded-md p-2 text-[#81949a] hover:bg-[#101820] hover:text-[#e3edef]"><Settings className="h-4 w-4" /></button>}
					</div>
				</aside>

				{/* CENTER MAIN PANEL */}
				<main className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-[#1c2a33] bg-[#080d12]">
					<div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 md:px-5 lg:px-6">
					<div className="mb-3 flex items-center justify-between gap-2 border-b border-[#1c2a33] pb-2 md:hidden">
						<nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto" aria-label="Mobile workspace navigation">
							{[
								{ id: "stream" as const, label: "Run" },
								{ id: "inbound" as const, label: "Sources" },
								{ id: "vault" as const, label: "Vault" },
								{ id: "summary" as const, label: "Summary" },
								{ id: "settings" as const, label: "Settings" },
							].map((item) => <button key={item.id} type="button" onClick={() => setView(item.id)} className={cn("shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold", view === item.id ? "bg-[#121c24] text-white" : "text-[#81949a] hover:bg-[#101820]")}>{item.label}</button>)}
						</nav>
						<button type="button" aria-label="Open case inspector" onClick={() => { setRightCollapsed(false); setRightDrawerOpen(true) }} className="shrink-0 rounded border border-[#1c2a33] px-2.5 py-1.5 text-xs font-semibold text-[#c7d3d6]">Cases {verdicts.length}</button>
					</div>
					{view === "stream" && (
						<div className="space-y-3">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<div className="flex flex-wrap items-center gap-2">
									<h1 className="text-lg font-extrabold tracking-tight text-[#e3edef]">
										{activeEntry
											? `${activeEntry.caseId} · ${activeEntry.title}`
											: 'Settlement review workbench'}
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
									? verdictStatusLabel(activeEntry.verdict.status)
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
														? "border-[#29434c] bg-[#101820] text-[#e3edef]"
														: "border-[#1c2a33] bg-[#0d141b] text-[#81949a] hover:text-[#e3edef]",
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
												ROLE_BORDER[a.name] || "border-t-[#62e1c3]",
												a.status === "paused" && "border-amber-400 border-t-amber-600 bg-[#2c2111]",
											)}
										>
											<div className="mb-1 flex items-center justify-between gap-2">
												<span className="truncate text-xs font-bold text-[#e3edef]">
													{AGENT_LANES.find((lane) => lane.name === a.name)?.label ?? a.name}
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
											<div className="font-mono text-[11px] text-[#81949a]">
												{Object.keys(a.tools).length} tool(s) ·{" "}
												{a.status === "done" ? a.elapsed : "active"}
											</div>
										</Card>
									))}
								</div>
							)}

							{activeEntry && <section aria-label="Parallel agent execution timeline" className="rounded-lg border border-[#1c2a33] bg-[#0d141b] p-4">
								<div className="mb-3 flex flex-wrap items-start justify-between gap-3">
									<div>
										<h2 className="font-mono text-xs font-semibold tracking-[0.12em] text-[#e3edef]">AGENT EXECUTION</h2>
										<p className="mt-1 max-w-xl text-[11px] leading-5 text-[#81949a]">Specialists investigate the same settlement concurrently. The auditor starts after required evidence is ready.</p>
									</div>
									<span className="rounded border border-[#1c2a33] px-2 py-1 font-mono text-[10px] text-[#a4b4b8]">
										{activeEntry ? activeEntry.pending ? "HUMAN REVIEW" : activeEntry.verdict ? "AUDIT COMPLETE" : sseConnected ? "EVENT STREAM LIVE" : "RECONNECTING" : "AWAITING CASE"}
									</span>
								</div>
								{(() => {
									const base = activeEntry?.startedAt ?? timelineNow
									const allSegments = activeEntry ? Object.values(activeEntry.agents).flatMap((agent) => agent.segments) : []
									const hasRunning = Boolean(activeEntry && Object.values(activeEntry.agents).some((agent) => agent.status === "running"))
									const observedEnd = allSegments.reduce((latest, segment) => Math.max(latest, segment.endedAt ?? segment.startedAt), base)
									const end = hasRunning ? Math.max(timelineNow, observedEnd) : observedEnd
									const spanMs = Math.max(8000, Math.ceil((end - base) / 2000) * 2000)
									const seconds = spanMs / 1000
									const roles = new Set<string>(activeEntry?.expectedRoles ?? [])
									const specialists = ["TermsAgent", "FxBenchmarkAgent", "WireDetectiveAgent", "DuplicateAnomalyAgent"].flatMap((name) => activeEntry?.agents[name]?.segments ?? [])
									const overlap = specialists.some((a, index) => specialists.slice(index + 1).some((b) => Math.max(a.startedAt, b.startedAt) < Math.min(a.endedAt ?? end, b.endedAt ?? end)))
									const ticks = [0, 0.25, 0.5, 0.75, 1]
									return <>
										<div className="grid grid-cols-[minmax(180px,0.8fr)_minmax(220px,1.2fr)] border-y border-[#1c2a33] bg-[#080d12] py-2 font-mono text-[10px] text-[#71858c]">
											<span className="pl-2">AGENT / SCOPE</span>
											<div className="flex justify-between px-1">{ticks.map((tick) => <span key={tick}>{(seconds * tick).toFixed(0)}s</span>)}</div>
										</div>
										{AGENT_LANES.map((lane) => {
											const agent = activeEntry?.agents[lane.name]
											const triggered = !lane.conditional || roles.has(lane.role) || Boolean(agent?.segments.length)
											const stateLabel = !triggered ? "NOT TRIGGERED" : agent?.status === "paused" ? "PAUSED / REVIEW" : agent?.status === "done" ? `COMPLETE · ${agent.elapsed}` : agent?.status === "running" ? agent.thinking ? "REASONING" : "RUNNING" : lane.name === "AuditorAgent" && activeEntry?.expectedRoles.length ? "WAITING FOR EVIDENCE" : activeEntry ? "QUEUED" : "STANDBY"
											const toolList = agent ? Object.values(agent.tools) : []
											const color = lane.name === "AuditorAgent" ? lane.color : lane.conditional ? lane.color : agent?.status === "done" ? "#62e1c3" : lane.color
											return <div key={lane.name} className="grid min-h-[60px] grid-cols-[minmax(180px,0.8fr)_minmax(220px,1.2fr)] items-center border-b border-[#1c2a33]/80">
												<div className="min-w-0 px-2 py-1">
													<div className="flex items-center gap-2">
														<span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: triggered ? color : "#52656c", boxShadow: agent?.status === "running" ? `0 0 8px ${color}` : undefined }} />
														<span className="truncate text-xs font-semibold text-[#e3edef]">{lane.label}</span>
													</div>
													<div className="mt-1 flex items-center justify-between gap-1">
														<span className="truncate font-mono text-[9px] tracking-wide text-[#81949a]">{lane.scope}</span>
														<span className={cn("shrink-0 font-mono text-[9px]", agent?.status === "paused" ? "text-[#f0c77f]" : agent?.status === "done" ? "text-[#75e4c7]" : "text-[#a4b4b8]")}>{stateLabel}</span>
													</div>
													{triggered && toolList.length > 0 && <div className="mt-0.5 truncate text-[10px] text-[#81949a]">{toolList.some((tool) => tool.status === "running") ? `Using ${toolList.find((tool) => tool.status === "running")?.toolName}` : `${toolList.length} evidence tools recorded`}</div>}
												</div>
												<div className="plot-grid relative mx-1 h-9 overflow-hidden rounded-sm">
													{triggered && agent?.segments.map((segment, index) => {
														const left = Math.max(0, Math.min(100, ((segment.startedAt - base) / spanMs) * 100))
														const finish = segment.endedAt ?? (agent.status === "running" ? timelineNow : segment.startedAt)
														const width = Math.max(1, Math.min(100 - left, ((finish - segment.startedAt) / spanMs) * 100))
												return <span key={`${segment.startedAt}-${index}`} aria-label={`${lane.label}, ${((Math.max(0, finish - segment.startedAt)) / 1000).toFixed(1)}s`} data-tooltip={`${lane.label} · ${((Math.max(0, finish - segment.startedAt)) / 1000).toFixed(1)}s`} style={{ left: `${left}%`, width: `${width}%`, backgroundColor: color }} className={cn("absolute top-2.5 h-4 min-w-[3px] rounded-[2px]", lane.name === "AuditorAgent" ? "border border-dashed border-[#74b9ff] bg-[#74b9ff]/20" : "")} />
													})}
													{triggered && !agent?.segments.length && <span className="absolute left-1 top-2 text-[10px] text-[#71858c]">{lane.name === "AuditorAgent" && activeEntry ? "Starts after specialist evidence" : "Awaiting execution"}</span>}
													{!triggered && <span className="absolute left-1 top-2 text-[10px] text-[#71858c]">No anomaly trigger detected for this case</span>}
												</div>
											</div>
										})}
										<div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-[#81949a]">
											<span><strong className="text-[#c7d3d6]">{activeEntry?.expectedRoles.filter((role) => role !== "auditor").length ?? 3} specialist checks</strong> · conditional anomaly scan · independent auditor</span>
											<span className="font-mono">{specialists.filter((segment) => (segment.endedAt ?? timelineNow) > segment.startedAt).length > 0 ? (overlap ? "PARALLEL OVERLAP OBSERVED" : "ACTUAL EVENT TRACE") : "AWAITING AGENT EVENTS"}</span>
										</div>
									</>
								})()}
							</section>}
{activeEntry && activeEntry.overlaps.length > 0 && (
								<Card className="flex flex-wrap items-center gap-3 px-3.5 py-2.5 text-xs">
									<span className="text-[11px] font-bold uppercase tracking-wider text-[#81949a]">
										Cross-Check:
									</span>
									{activeEntry.overlaps.map((o, idx) => (
										<span key={`${o.left}-${idx}`} className="inline-flex items-center gap-1.5">
											<span className="rounded bg-[#101820] px-2 py-0.5 font-mono text-[11px] text-[#c7d3d6]">
												{o.left}
											</span>
											<Badge variant={o.tone}>
												{o.relation === "contradicts" ? "⚡ Contradicts" : "✓ In Sync"}
											</Badge>
											<span className="rounded bg-[#101820] px-2 py-0.5 font-mono text-[11px] text-[#c7d3d6]">
												{o.right}
											</span>
										</span>
									))}
								</Card>
							)}

							<Card className="relative overflow-hidden p-4 lg:p-5">
								{!activeEntry ? (
									<>
										<div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-32 overflow-hidden">
											<div className="absolute -bottom-14 left-[8%] h-28 w-56 animate-pulse rounded-full bg-sky-500/25 blur-3xl" />
											<div className="absolute -bottom-16 left-[38%] h-32 w-64 animate-pulse rounded-full bg-rose-500/20 blur-3xl [animation-delay:700ms]" />
											<div className="absolute -bottom-14 right-[8%] h-28 w-56 animate-pulse rounded-full bg-violet-500/25 blur-3xl [animation-delay:1400ms]" />
											<div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-sky-400/30 via-fuchsia-400/40 to-emerald-400/30" />
										</div>
										<div className="relative z-10 mx-auto flex min-h-[270px] max-w-2xl flex-col justify-center py-7">
											<div className="mb-4 flex flex-wrap items-center justify-between gap-2">
												<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#75e4c7]">
													<span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
													{provider?.mode === "live" ? "Operations workspace · LLM Live" : "Operations workspace · ready"}
												</div>
												{provider?.mode === "live" ? (
													<div className="inline-flex items-center gap-2 rounded-lg border border-[#225b51] bg-[#081312]/90 px-3 py-1 font-mono text-[11px] text-[#62e1c3]">
														<span className="h-2 w-2 animate-ping rounded-full bg-[#62e1c3] opacity-75" />
														<span>&gt; Waiting for Data</span>
														<span className="inline-flex gap-0.5">
															<span className="animate-bounce [animation-delay:0ms]">.</span>
															<span className="animate-bounce [animation-delay:150ms]">.</span>
															<span className="animate-bounce [animation-delay:300ms]">.</span>
														</span>
													</div>
												) : (
													<div className="inline-flex items-center gap-1.5 rounded-lg border border-amber-800/60 bg-amber-950/30 px-2.5 py-1 font-mono text-[11px] text-amber-300">
														<span>&gt; Waiting for LLM Key...</span>
													</div>
												)}
											</div>
											<h2 className="max-w-xl text-2xl font-semibold tracking-tight text-[#e3edef] sm:text-[28px]">Review a settlement with the agent team.</h2>
											<p className="mt-2 max-w-xl text-sm leading-6 text-[#a4b4b8]">
												{provider?.mode === "live"
													? `Listening for uploads, drag-and-drop files, webhooks, emails, and hot-folder drops on ${provider.modelDisplayName || provider.modelName}.`
													: "Follow each specialist as it checks invoice terms, FX, wire fees, and exceptions. Tool results and the final cent reconciliation appear here as the run progresses."}
											</p>
											<div className="mt-5 flex flex-wrap items-center gap-2">
												<Button className="h-9 px-3.5" onClick={() => quickFileInputRef.current?.click()}>
													<FileUp className="h-3.5 w-3.5" />
													Upload source
												</Button>
												{provider?.mode !== "live" && (
													<Button variant="outline" className="h-9 px-3.5" onClick={() => setView("settings")}>
														Configure LLM Key
													</Button>
												)}
												{provider?.mode === "live" && (
													<span className="rounded-lg border border-[#1c2a33] bg-[#080d12]/80 px-3 py-1.5 font-mono text-[11px] text-[#81949a]">
														Active: <strong className="text-[#e3edef]">{provider.modelDisplayName || provider.modelName}</strong>
													</span>
												)}
											</div>
											<div className="mt-7 grid grid-cols-1 gap-2 border-t border-[#1c2a33] pt-4 text-[11px] text-[#81949a] sm:grid-cols-3">
												<div><span className="block font-semibold text-[#c7d3d6]">01 · Investigate</span>Terms, FX, and wire specialists</div>
												<div><span className="block font-semibold text-[#c7d3d6]">02 · Verify</span>Integer-unit balance checks</div>
												<div><span className="block font-semibold text-[#c7d3d6]">03 · Review</span>Human gate on risky cases</div>
											</div>
										</div>
									</>
								) : visibleAgents.length === 0 ? (
									<div className="flex min-h-[200px] flex-col items-center justify-center gap-2 py-8 text-center">
										<div className="text-sm font-bold text-[#e3edef]">
											{activeEntry.caseId} · {activeEntry.title}
										</div>
										<p className="max-w-md text-xs text-[#81949a]">
											Case is registered in the workspace. Agent steps will appear here as specialists execute, or re-parse from Raw Data Vault if a previous run was interrupted before an LLM key was configured.
										</p>
									</div>
								) : (
									<div className="space-y-4">
										{/* Agentic IDE Live Run-Activity Header */}
										<div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#1c2a33] bg-[#080d12] px-3 py-2 font-mono text-[11px]">
											<div className="flex items-center gap-2">
												<span
													className={cn(
														"h-2 w-2 rounded-full",
														hasRunningAgent ? "animate-pulse bg-[#62e1c3]" : activeEntry.pending ? "bg-amber-500" : "bg-emerald-500",
													)}
												/>
												<span className="font-bold text-[#e3edef]">{activeEntry.phase || "RUN ACTIVE"}</span>
											</div>
											<div className="flex items-center gap-3 text-[#81949a]">
												<span>
													Agents: <strong className="text-[#e3edef]">{visibleAgents.filter((ag) => ag.status === "done").length}/{visibleAgents.length}</strong>
												</span>
												<span>
													Tools: <strong className="text-[#62e1c3]">{visibleAgents.reduce((sum, ag) => sum + Object.keys(ag.tools).length, 0)}</strong>
												</span>
												<span>
													Elapsed:{" "}
													<strong className="text-[#e3edef]">
														{(((activeEntry.verdict ? Date.parse(activeEntry.verdict.completedAt) : timelineNow) - activeEntry.startedAt) / 1000).toFixed(1)}s
													</strong>
												</span>
											</div>
										</div>

										<div className="relative space-y-4 pl-6 before:absolute before:top-2 before:bottom-2 before:left-[8.5px] before:w-[1.5px] before:bg-[#62e1c3]">
										{visibleAgents.map((a) => {
											const toolsArr = Object.values(a.tools)
											const rKey = `${activeEntry.caseId}:${a.name}`
											const rOpen = Boolean(openReasoning[rKey])
											const finalMsg = a.finalText || a.streamText
											const isLead = a.name === "AuditorAgent"
											const liveSec = a.status === "running" ? `${((timelineNow - a.startedAt) / 1000).toFixed(1)}s` : a.elapsed
											return (
												<div key={a.name} className="relative">
													<span
														className={cn(
															"absolute top-1 -left-[21px] h-3 w-3 rounded-full border-2 border-white",
															a.status === "paused"
																? "bg-amber-600"
																: a.status === "done"
																	? "bg-emerald-600"
																	: "animate-pulse bg-[#62e1c3]",
														)}
													/>
													<div className="flex flex-wrap items-center gap-2">
														<span
															className={cn(
																"rounded px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-wider",
																isLead ? "bg-violet-950/60 text-violet-300 border border-violet-700/50" : "bg-sky-950/50 text-sky-300 border border-sky-800/50",
															)}
														>
															{isLead ? "Lead Agent" : "Subagent"}
														</span>
														<span className="text-[13px] font-bold text-[#e3edef]">{AGENT_LANES.find((lane) => lane.name === a.name)?.label ?? a.name}</span>
														{(a.thinking || a.status === "running") && (
															<span className="inline-flex items-center gap-1.5 rounded-md border border-[#225b51] bg-[#081312] px-2 py-0.5 font-mono text-[11px] text-[#62e1c3]">
																<span className="h-1.5 w-1.5 animate-ping rounded-full bg-[#62e1c3]" />
																Thinking · {liveSec}
															</span>
														)}
														{a.reasoning && (
															<button
																type="button"
																onClick={() =>
																	setOpenReasoning((p) => ({ ...p, [rKey]: !rOpen }))
																}
																className="inline-flex items-center gap-1 rounded border border-[#1c2a33] bg-[#101820] px-2 py-0.5 font-mono text-[11px] text-[#a4b4b8] hover:text-[#e3edef]"
															>
																{rOpen ? (
																	<ChevronDown className="h-3 w-3" />
																) : (
																	<ChevronRight className="h-3 w-3" />
																)}
																Model Reasoning
															</button>
														)}
														<span className="ml-auto font-mono text-[11px] text-[#71858c]">
															{a.status === "done" ? a.elapsed : a.status}
														</span>
													</div>

													{a.reasoning && rOpen && (
														<pre className="mt-2 whitespace-pre-wrap rounded border-l-2 border-[#52656c] bg-[#080d12] p-2.5 font-mono text-[11px] text-[#a4b4b8]">
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
																				"inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors",
																				t.status === "ok"
																					? "border-[#225b51] bg-[#0d2725] text-[#75e4c7]"
																					: t.status === "error"
																						? "border-red-800/70 bg-red-950/40 text-red-300"
																						: "border-[#2c4a43] bg-[#0d191c] text-[#c7d3d6]",
																			)}
																		>
																			{isOpen ? (
																				<ChevronDown className="h-3 w-3" />
																			) : (
																				<ChevronRight className="h-3 w-3" />
																			)}
																			<span
																				className={cn(
																					"h-1.5 w-1.5 rounded-full",
																					t.status === "ok"
																						? "bg-emerald-400"
																						: t.status === "error"
																							? "bg-red-400"
																							: "animate-ping bg-amber-400",
																				)}
																			/>
																			{t.toolName} ·{" "}
																			{t.durationMs !== null ? `${t.durationMs}ms` : "running..."}
																		</button>
																		{isOpen && (
																			<pre className="mt-1.5 whitespace-pre-wrap break-words rounded-md border border-[#1c2a33] bg-[#080d12] p-2.5 font-mono text-[11px] text-[#c7d3d6]">
																				{`ARGS:   ${t.argsJson || "{}"}\nRESULT: ${t.resultJson || "running..."}`}
																			</pre>
																		)}
																	</div>
																)
															})}
														</div>
													)}

													{finalMsg && (
														<div className="mt-1.5 whitespace-pre-wrap text-[13px] text-[#c7d3d6]">
															{finalMsg}
														</div>
													)}
												</div>
											)
										})}
										</div>
									</div>
								)}
							</Card>

							{/* HUMAN-IN-THE-LOOP MOZAIK BREAKPOINT CARD */}
							{activeEntry?.pending && (
								<Card className="border-amber-400 border-l-[5px] border-l-amber-600 p-4">
									<div className="mb-2 flex items-center justify-between gap-2">
										<div className="flex items-center gap-2 text-sm font-bold text-[#e3edef]">
											<PauseCircle className="h-4 w-4 text-amber-600" />
											Mozaik Breakpoint Paused · Human Approval Required
										</div>
										<Badge variant="warn">{activeEntry.pending.riskLabel}</Badge>
									</div>

									<p className="mb-2.5 text-sm font-semibold text-[#c7d3d6]">
										&ldquo;{activeEntry.pending.question}&rdquo;
									</p>
									{reviewActionError && (
										<p role="alert" className="mb-3 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
											{reviewActionError}
										</p>
									)}
									<div className="mb-3 rounded-md border border-[#1c2a33] bg-[#080d12] px-3 py-2 font-mono text-[11.5px] text-[#c7d3d6]">
										{activeEntry.pending.proofLine}
									</div>

									<div className="flex flex-wrap items-center gap-2">
										<Button
											variant="emerald"
							onClick={() => void resolveBreakpoint(activeEntry.pending!.caseId, "approve", undefined, activeEntry.pending!.approvalId)}
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
							onClick={() => void resolveBreakpoint(activeEntry.pending!.caseId, "stop", undefined, activeEntry.pending!.approvalId)}
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
												placeholder="Type instruction for AuditorAgent (e.g. Client agreed to split fee; treat as SHA)"
												className="h-9 min-w-[240px] flex-1 rounded-md border border-[#32454d] bg-[#0d141b] px-3 text-xs text-[#e3edef] focus:border-emerald-600 focus:outline-none"
											/>
											<Button
												onClick={() =>
													void resolveBreakpoint(
														activeEntry.pending!.caseId,
														"reject",
														steerReason.trim() || "Treat as approved SHA fee.",
									activeEntry.pending!.approvalId,
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
							onIngested={() => setView("stream")}
						/>
					)}

					{view === "vault" && (
						<RawVaultView
							onOpenCase={(cid) => {
								setActiveCaseId(cid)
								setView("stream")
							}}
						/>
					)}

					{view === "summary" && (
						<CorridorSummaryView
							verdicts={verdicts}
							casesMap={casesMap}
							provider={provider}
							queueStats={queueStats}
							onSelectCase={(cid) => {
								setModalTab("ledger")
								setModalCaseId(cid)
							}}
						/>
					)}

					{view === "settings" && (
						<SettingsView
							currentProvider={provider}
							breakpointMode={breakpointMode}
							onBreakpointModeChange={setBreakpointMode}
							onProviderSaved={(next) => setProvider(next)}
						/>
					)}
					</div>
					<WorkbenchTerminal
						open={terminalOpen}
						height={terminalHeight}
						events={terminalEvents}
						onHeightChange={setTerminalHeight}
						onClose={() => setTerminalOpen((value) => !value)}
						onGateChange={setBreakpointMode}
					/>
				</main>

				{/* RIGHT PANEL: 3-TAB ARTIFACTS, CASES & LEDGER */}
				<aside className={cn(
					"workbench-inspector min-w-0 flex-col overflow-hidden rounded-xl border border-[#1c2a33] bg-[#0d141b]",
					rightCollapsed ? "items-center" : "",
					rightDrawerOpen ? "mobile-inspector-open" : "",
				)}>
					{rightCollapsed ? (
						<div className="flex w-full flex-col items-center gap-1 py-2">
							<button type="button" onClick={() => setRightCollapsed(false)} data-tooltip="Expand inspection panel (Ctrl+Alt+B)" aria-label="Expand inspection panel" className="mb-2 rounded p-2 text-[#81949a] hover:bg-[#101820]"><PanelRightOpen className="h-4 w-4" /></button>
							{[
								{ id: "cases" as const, label: "Cases", icon: Activity },
								{ id: "artifacts" as const, label: "Artifacts", icon: Download },
								{ id: "ledger" as const, label: "Ledger", icon: BarChart3 },
							].map((tab) => <button key={tab.id} type="button" data-tooltip={tab.label} aria-label={tab.label} onClick={() => { setRightTab(tab.id); setRightCollapsed(false) }} className={cn("rounded p-2", rightTab === tab.id ? "bg-[#101820] text-[#e3edef]" : "text-[#81949a] hover:bg-[#080d12]")}><tab.icon className="h-4 w-4" /></button>)}
						</div>
					) : <>
					<div className="m-2 flex items-center gap-1">
					<div className="grid min-w-0 flex-1 grid-cols-3 gap-1 rounded-md border border-[#1c2a33] bg-[#101820] p-1">
						{[
								{ id: "cases" as const, label: `Cases ${verdicts.length}` },
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
										? "bg-[#0d141b] text-[#e3edef] shadow-sm"
										: "text-[#81949a] hover:text-[#e3edef]",
								)}
							>
								{tab.label}
							</button>
						))}
					</div>
						<button type="button" onClick={() => { setRightCollapsed(true); setRightDrawerOpen(false) }} data-tooltip="Collapse inspection panel (Ctrl+Alt+B)" aria-label="Collapse inspection panel" className="hidden rounded p-1.5 text-[#71858c] hover:bg-[#101820] hover:text-[#c7d3d6] md:inline-flex"><PanelRightClose className="h-4 w-4" /></button>
						<button type="button" onClick={() => setRightDrawerOpen(false)} data-tooltip="Close inspector" aria-label="Close inspector" className="rounded p-1.5 text-[#71858c] hover:bg-[#101820] hover:text-[#c7d3d6] md:hidden"><X className="h-4 w-4" /></button>
					</div>

					<div className="flex-1 space-y-2 overflow-y-auto px-3 pb-4">
						{rightTab === "cases" &&
							(verdicts.length === 0 ? (
								<div className="px-1 py-3 text-xs text-[#81949a]">
									Completed case verdicts and dispute artifacts will appear here.
								</div>
							) : (
								verdicts.map((v) => {
									const ccy = v.numbers.settledCurrency
									const delta =
										v.numbers.recoverableFeeMinor > 0
											? `Potential fee flag: ${fmtClientMoney(v.numbers.recoverableFeeMinor, ccy)} · FX estimate: ${fmtClientMoney(-v.numbers.fxSpreadLossMinor, ccy)}`
											: v.numbers.unexplainedVarianceMinor !== 0
												? `Variance: ${fmtClientMoney(v.numbers.unexplainedVarianceMinor, ccy)}`
												: `Variance: ${fmtClientMoney(0, ccy)} · FX: ${fmtClientMoney(v.numbers.fxSpreadLossMinor, ccy)}`
									return (
										<Card
											key={v.caseId}
											onClick={() => {
								setActiveCaseId(v.caseId)
								setView("stream")
								setRightDrawerOpen(false)
											}}
											className={cn(
												"cursor-pointer p-3 transition-colors hover:border-[#32454d]",
												v.caseId === activeCaseId && "border-amber-400 bg-[#2c2111]/70",
											)}
										>
											<div className="mb-1 flex items-center justify-between gap-2">
												<strong className="truncate font-mono text-xs text-[#e3edef]">
													{v.caseId} · {v.invoiceId}
												</strong>
												<Badge variant={verdictBadgeVariant(v.status)}>
									{verdictStatusLabel(v.status)}
												</Badge>
											</div>
											<div className="font-mono text-[11.5px] text-[#a4b4b8]">{delta}</div>
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
														Review request.txt
													</Button>
												)}
												<a
													href={`/api/report/${encodeURIComponent(v.caseId)}?format=json`}
													download
													className="inline-flex h-7 items-center rounded border border-[#32454d] bg-[#0d141b] px-2.5 text-[11.5px] font-semibold text-[#c7d3d6] hover:bg-[#080d12]"
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
								<div className="px-1 py-3 text-xs text-[#81949a]">No downloadable artifacts yet.</div>
							) : (
								verdicts.map((v) => (
									<Card key={v.caseId} className="p-3">
										<div className="mb-2 font-mono text-xs font-bold text-[#e3edef]">{v.caseId}</div>
										<div className="flex flex-wrap gap-1.5">
											<Button
												variant="outline"
												size="sm"
												onClick={() => {
													setModalTab("preview")
													setModalCaseId(v.caseId)
												}}
											>
												Preview Files
											</Button>
											<a
												href={`/api/report/${encodeURIComponent(v.caseId)}?format=pdf`}
												download
												className="inline-flex h-7 items-center gap-1 rounded border border-[#2c4a43] bg-[#0e2620] px-2.5 text-[11.5px] font-semibold text-[#62e1c3] hover:bg-[#14352d]"
											>
												<Download className="h-3 w-3" />
												PDF
											</a>
											<a
												href={`/api/report/${encodeURIComponent(v.caseId)}?format=csv`}
												download
												className="inline-flex h-7 items-center gap-1 rounded border border-[#32454d] bg-[#0d141b] px-2.5 text-[11.5px] font-semibold text-[#c7d3d6] hover:bg-[#080d12]"
											>
												<Download className="h-3 w-3" />
												CSV
											</a>
											<a
												href={`/api/report/${encodeURIComponent(v.caseId)}?format=txt`}
												download
												className="inline-flex h-7 items-center gap-1 rounded border border-[#32454d] bg-[#0d141b] px-2.5 text-[11.5px] font-semibold text-[#c7d3d6] hover:bg-[#080d12]"
											>
												<Download className="h-3 w-3" />
												TXT
											</a>
											<a
												href={`/api/report/${encodeURIComponent(v.caseId)}?format=json`}
												download
												className="inline-flex h-7 items-center gap-1 rounded border border-[#32454d] bg-[#0d141b] px-2.5 text-[11.5px] font-semibold text-[#c7d3d6] hover:bg-[#080d12]"
											>
												<Download className="h-3 w-3" />
												JSON
											</a>
										</div>
									</Card>
								))
							))}

						{rightTab === "ledger" &&
							(ledgerEvents.length === 0 ? (
								<div className="px-1 py-3 text-xs text-[#81949a]">
									Ledger events stream here as agents finalize audits.
								</div>
							) : (
								<div className="divide-y divide-[#1c2a33]">
									{ledgerEvents.map((l, idx) => (
										<div key={`${l.timestamp}-${idx}`} className="px-1 py-2 text-xs">
											<div className="font-mono text-[10.5px] text-[#71858c]">
												{l.timestamp.slice(11, 19)} · {l.caseId}
											</div>
											<div className="text-[#c7d3d6]">{l.summary}</div>
										</div>
									))}
								</div>
							))}
					</div>
					</>}
				</aside>
			</div>
			{rightDrawerOpen && <button type="button" aria-label="Close inspection panel" onClick={() => setRightDrawerOpen(false)} className="mobile-inspector-backdrop fixed inset-0 z-30 bg-[#080d12]/30 md:hidden" />}

			<footer className="flex h-7 shrink-0 items-center justify-between rounded-xl border border-[#1c2a33] bg-[#0d141b] px-3 text-[10px] text-[#81949a]">
				<div className="flex min-w-0 items-center gap-3">
					<span className="flex items-center gap-1.5"><span className={cn("h-1.5 w-1.5 rounded-full", sseConnected ? "bg-emerald-600" : "bg-amber-600")} />{sseConnected ? "Runtime connected" : "Reconnecting"}</span>
					<span className="hidden truncate sm:inline">{provider.label}</span>
					<span className="hidden font-mono md:inline">{activeCaseId ?? "No active case"}</span>
				</div>
				<div className="flex items-center gap-3 font-mono">
					<span className="hidden sm:inline">{queueStats.waiting} waiting · {queueStats.active} active · {queueStats.done} done</span>
					<button type="button" onClick={() => setTerminalOpen((value) => !value)} className="inline-flex items-center gap-1 hover:text-[#e3edef]"><TerminalSquare className="h-3 w-3" />Terminal</button>
				</div>
			</footer>

			<CaseInspectorModal
				entry={modalEntry}
				activeTab={modalTab}
				onTabChange={setModalTab}
				onClose={() => setModalCaseId(null)}
			/>
		</div>
	)
}
