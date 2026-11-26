import type { AuditVerdict, PendingBreakpointDecision, TrajectoryEvent } from "@/core/types"

export type ProviderId =
	| "nvidia"
	| "gemini"
	| "groq"
	| "openrouter"
	| "openai"
	| "anthropic"
	| "ollama"
	| "demo"

export interface ProviderStatus {
	provider: ProviderId
	label: string
	modelName: string
	hasKey: boolean
	mode: "live" | "demo"
}

export interface QueueStats {
	waiting: number
	active: number
	done: number
	failed: number
}

export interface ToolRunState {
	callId: string
	toolName: string
	status: string
	durationMs: number | null
	argsJson?: string
	resultJson?: string
}

export interface AgentRunState {
	name: string
	status: "idle" | "running" | "done" | "paused"
	startedAt: number
	elapsed: string
	thinking: boolean
	reasoning: string
	streamText: string
	finalText: string
	tools: Record<string, ToolRunState>
}

export interface OverlapSignal {
	left: string
	relation: "contradicts" | "in_sync"
	right: string
	tone: "bad" | "ok" | "warn"
}

export interface CaseStreamEntry {
	caseId: string
	title: string
	corridor: string
	phase: string
	agents: Record<string, AgentRunState>
	overlaps: OverlapSignal[]
	pending: PendingBreakpointDecision | null
	verdict: AuditVerdict | null
	technical: unknown
}

export interface LedgerLogItem {
	timestamp: string
	caseId: string
	summary: string
	tone: string
}

export const PROVIDER_DEFAULT_MODELS: Record<ProviderId, string> = {
	nvidia: "nvidia/nemotron-3.5-super-vl-120b-a12b",
	gemini: "gemini-2.5-flash",
	groq: "llama-3.3-70b-versatile",
	openrouter: "meta-llama/llama-3.3-70b-instruct:free",
	openai: "gpt-5.4",
	anthropic: "claude-haiku-4-5",
	ollama: "llama3.2",
	demo: "deterministic-demo",
}

export const ORDERED_AGENTS = [
	"TermsAgent",
	"FxBenchmarkAgent",
	"WireDetectiveAgent",
	"DuplicateAnomalyAgent",
	"AuditorAgent",
] as const

export function fmtClientMoney(minor: number, ccy = "USD"): string {
	const upper = (ccy || "USD").toUpperCase()
	const digits = ["JPY", "KRW", "VND"].includes(upper)
		? 0
		: ["BHD", "KWD", "OMR", "JOD", "TND"].includes(upper)
			? 3
			: 2
	const sign = minor < 0 ? "-" : ""
	const absVal = (Math.abs(Number(minor || 0)) / 10 ** digits).toLocaleString("en-US", {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits,
	})
	const sym: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", JPY: "¥" }
	return sym[upper] ? `${sign}${sym[upper]}${absVal}` : `${sign}${absVal} ${upper}`
}

export function verdictBadgeVariant(status: string): "ok" | "violet" | "bad" | "warn" {
	if (status === "CLEAN") return "ok"
	if (status === "ORPHAN_MATCHED") return "violet"
	if (status === "VARIANCE_DETECTED" || status === "ABORTED_BY_OPERATOR") return "bad"
	return "warn"
}
