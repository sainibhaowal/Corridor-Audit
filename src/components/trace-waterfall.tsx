"use client"

import { useMemo, useState } from "react"
import { Clock, Layers } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { CaseStreamEntry } from "./corridor-types"

interface TraceWaterfallProps {
	entry: CaseStreamEntry
}

interface WaterfallSpan {
	id: string
	label: string
	agentName: string
	kind: "agent" | "tool" | "breakpoint"
	startOffsetMs: number
	durationMs: number
	status: string
}

const LANE_COLOR: Record<string, string> = {
	TermsAgent: "#38bdf8",
	FxBenchmarkAgent: "#f59e0b",
	WireDetectiveAgent: "#62e1c3",
	DuplicateAnomalyAgent: "#f43f5e",
	AuditorAgent: "#a78bfa",
}

export function TraceWaterfall({ entry }: TraceWaterfallProps) {
	const [hoveredId, setHoveredId] = useState<string | null>(null)

	const { spans, totalDurationMs } = useMemo(() => {
		const agents = Object.values(entry.agents || {})
		if (agents.length === 0) return { spans: [] as WaterfallSpan[], totalDurationMs: 1 }
		const baseMs = entry.startedAt || Math.min(...agents.map((a) => a.startedAt || Date.now()))
		const out: WaterfallSpan[] = []

		for (const agent of agents) {
			const agentStart = Math.max(0, (agent.startedAt || baseMs) - baseMs)
			const agentEnd = agent.finishedAt ? Math.max(agentStart + 80, agent.finishedAt - baseMs) : agentStart + 300
			out.push({
				id: `agent-${agent.name}`,
				label: `${agent.name} (${agent.status})`,
				agentName: agent.name,
				kind: "agent",
				startOffsetMs: agentStart,
				durationMs: Math.max(80, agentEnd - agentStart),
				status: agent.status,
			})

			let toolCursor = agentStart
			for (const tool of Object.values(agent.tools || {})) {
				const dur = Math.max(40, tool.durationMs ?? 80)
				out.push({
					id: `tool-${agent.name}-${tool.callId}`,
					label: `${agent.name} → ${tool.toolName}`,
					agentName: agent.name,
					kind: "tool",
					startOffsetMs: toolCursor,
					durationMs: dur,
					status: tool.status,
				})
				toolCursor += dur
			}
		}

		if (entry.pending) {
			const bpOffset = Math.max(0, Date.parse(entry.pending.createdAt) - baseMs)
			out.push({
				id: `bp-${entry.pending.caseId}`,
				label: `Human Review Breakpoint (${entry.pending.riskLabel})`,
				agentName: "AuditorAgent",
				kind: "breakpoint",
				startOffsetMs: Number.isFinite(bpOffset) ? bpOffset : 0,
				durationMs: 250,
				status: "paused",
			})
		}

		const maxEnd = Math.max(500, ...out.map((s) => s.startOffsetMs + s.durationMs))
		return { spans: out, totalDurationMs: maxEnd }
	}, [entry])

	if (spans.length === 0) {
		return (
			<div className="rounded-lg border border-dashed border-[#1c2a33] bg-[#080d12] p-6 text-center text-xs text-[#81949a]">
				No live execution trace recorded for <span className="font-mono text-[#e3edef]">{entry.caseId}</span> yet.
			</div>
		)
	}

	const hovered = spans.find((s) => s.id === hoveredId)

	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<Layers className="h-4 w-4 text-[#62e1c3]" />
					<span className="text-xs font-bold uppercase tracking-wider text-[#e3edef]">
						Parallel Mozaik Execution Waterfall
					</span>
				</div>
				<Badge variant="neutral" className="font-mono text-[11px]">
					<Clock className="mr-1 h-3 w-3" />
					Total Span: {totalDurationMs} ms · {spans.length} spans
				</Badge>
			</div>

			<div className="max-h-[54vh] space-y-1.5 overflow-y-auto rounded-lg border border-[#1c2a33] bg-[#080d12] p-3">
				{spans.map((span) => {
					const leftPct = Math.min(96, (span.startOffsetMs / totalDurationMs) * 100)
					const widthPct = Math.max(2, Math.min(100 - leftPct, (span.durationMs / totalDurationMs) * 100))
					const color = span.kind === "breakpoint" ? "#f59e0b" : LANE_COLOR[span.agentName] || "#62e1c3"
					return (
						<div
							key={span.id}
							onMouseEnter={() => setHoveredId(span.id)}
							onMouseLeave={() => setHoveredId(null)}
							className={cn(
								"grid grid-cols-12 items-center gap-2 rounded px-2 py-1 text-[11px] transition-colors",
								hoveredId === span.id ? "bg-[#101820]" : "",
							)}
						>
							<div className="col-span-5 truncate font-mono text-[#c7d3d6]" title={span.label}>
								{span.kind === "tool" ? `  └ ${span.label}` : span.label}
							</div>
							<div className="col-span-5 relative h-3 rounded-full bg-[#132029]">
								<div
									style={{
										left: `${leftPct}%`,
										width: `${widthPct}%`,
										backgroundColor: color,
										opacity: span.kind === "agent" ? 0.9 : 0.65,
									}}
									className="absolute top-0 h-full rounded-full"
								/>
							</div>
							<div className="col-span-2 text-right font-mono text-[10.5px] text-[#81949a]">
								{span.durationMs} ms
							</div>
						</div>
					)
				})}
			</div>

			{hovered && (
				<div className="flex items-center justify-between rounded-lg border border-[#2c4a43] bg-[#080d12] px-3 py-1.5 text-[11px]">
					<span className="font-mono text-[#e3edef]">{hovered.label}</span>
					<span className="font-mono text-[#62e1c3]">
						+{hovered.startOffsetMs}ms start · {hovered.durationMs}ms duration · {hovered.status}
					</span>
				</div>
			)}
		</div>
	)
}
