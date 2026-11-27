"use client"

import { useState } from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AgentRunState, CaseStreamEntry } from "./corridor-types"

interface AgentTraceTreeProps {
	entry: CaseStreamEntry
	visibleAgents: AgentRunState[]
	timelineNow: number
	agentLabels: Record<string, string>
}

export function AgentTraceTree({
	entry,
	visibleAgents,
	timelineNow,
	agentLabels,
}: AgentTraceTreeProps) {
	const [rootOpen, setRootOpen] = useState(true)
	const [openNodes, setOpenNodes] = useState<Record<string, boolean>>({})
	const [openPayloads, setOpenPayloads] = useState<Record<string, boolean>>({})
	const [expandAll, setExpandAll] = useState(false)

	const specialists = visibleAgents.filter((a) => a.name !== "AuditorAgent")
	const auditor = visibleAgents.find((a) => a.name === "AuditorAgent")
	const expectedCount = Math.max(entry.expectedRoles.length, specialists.length)
	const completedSpecialists = specialists.filter((a) => a.status === "done").length
	const totalTools = visibleAgents.reduce((sum, a) => sum + Object.keys(a.tools).length, 0)
	const totalThoughts = visibleAgents.filter((a) => Boolean(a.reasoning) || a.thinking).length
	const isRunning = visibleAgents.some((a) => a.status === "running")
	const endMs = entry.verdict ? Date.parse(entry.verdict.completedAt) : timelineNow
	const elapsedSec = Math.max(0.1, (endMs - entry.startedAt) / 1000).toFixed(1)

	const isNodeOpen = (key: string, defaultOpen = false) =>
		openNodes[key] !== undefined ? openNodes[key] : expandAll || defaultOpen

	const toggleNode = (key: string, current: boolean) =>
		setOpenNodes((prev) => ({ ...prev, [key]: !current }))

	const togglePayload = (key: string) =>
		setOpenPayloads((prev) => ({ ...prev, [key]: !prev[key] }))

	const handleToggleAll = () => {
		const next = !expandAll
		setExpandAll(next)
		setRootOpen(true)
		const nextNodes: Record<string, boolean> = {}
		const nextPayloads: Record<string, boolean> = {}
		for (const a of visibleAgents) {
			nextNodes[a.name] = next
			if (a.reasoning) nextPayloads[`reason:${a.name}`] = next
			for (const t of Object.values(a.tools)) {
				nextPayloads[`tool:${t.callId}`] = next
			}
		}
		setOpenNodes(nextNodes)
		setOpenPayloads(nextPayloads)
	}

	const renderAgentBranch = (a: AgentRunState, defaultOpen: boolean) => {
		const toolsArr = Object.values(a.tools)
		const nodeKey = a.name
		const open = isNodeOpen(nodeKey, defaultOpen)
		const isLead = a.name === "AuditorAgent"
		const liveDur = a.status === "running" ? `${((timelineNow - a.startedAt) / 1000).toFixed(1)}s` : a.elapsed
		const finalMsg = a.finalText || a.streamText
		const reasonKey = `reason:${a.name}`
		const reasonOpen = Boolean(openPayloads[reasonKey])

		return (
			<div key={a.name} className="flex flex-col">
				<button
					type="button"
					onClick={() => toggleNode(nodeKey, open)}
					className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-white/[0.03]"
				>
					<div className="flex min-w-0 items-center gap-2">
						<ChevronRight
							className={cn(
								"h-3 w-3 shrink-0 text-[#71858c] transition-transform duration-150",
								open && "rotate-90",
							)}
						/>
						<span
							className={cn(
								"h-2 w-2 shrink-0 rounded-full",
								a.status === "paused"
									? "bg-amber-400 shadow-[0_0_6px_#fbbf24]"
									: a.status === "done"
										? "bg-emerald-400"
										: "animate-pulse bg-amber-400 shadow-[0_0_6px_#fbbf24]",
							)}
						/>
						<span
							className={cn(
								"shrink-0 rounded px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-wider",
								isLead
									? "border border-violet-700/50 bg-violet-950/60 text-violet-300"
									: "border border-sky-800/50 bg-sky-950/50 text-sky-300",
							)}
						>
							{isLead ? "Lead Agent" : "Subagent"}
						</span>
						<span className="truncate font-mono text-[12px] font-semibold text-[#e3edef]">
							{agentLabels[a.name] ?? a.name}
						</span>
						<span className="hidden truncate font-mono text-[11px] text-[#71858c] sm:inline">
							{toolsArr.length} tool{toolsArr.length === 1 ? "" : "s"}
						</span>
					</div>
					<span className="shrink-0 font-mono text-[11px] text-[#81949a]">
						{liveDur || a.status}
					</span>
				</button>

				{open && (
					<div className="ml-3 mt-1 space-y-1 border-l border-[#24323c] pl-3.5">
						{(a.thinking || a.reasoning) && (
							<div>
								<button
									type="button"
									onClick={() => a.reasoning && togglePayload(reasonKey)}
									className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left hover:bg-white/[0.03]"
								>
									<div className="flex items-center gap-2">
										<ChevronRight
											className={cn(
												"h-3 w-3 text-[#71858c] transition-transform",
												reasonOpen && "rotate-90",
												!a.reasoning && "opacity-30",
											)}
										/>
										<span className="text-[12px] text-[#c7d3d6]">
											{a.thinking || a.status === "running" ? "Thinking · Analyzing extracted fields..." : "Thinking · Reasoning captured"}
										</span>
									</div>
									{a.reasoning && (
										<span className="font-mono text-[10.5px] text-[#71858c]">
											{reasonOpen ? "hide" : "inspect"}
										</span>
									)}
								</button>
								{a.reasoning && reasonOpen && (
									<pre className="my-1 ml-5 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-[#1c2a33] bg-[#080d12] p-2.5 font-mono text-[11px] text-[#a4b4b8]">
										{a.reasoning}
									</pre>
								)}
							</div>
						)}

						{toolsArr.map((t) => {
							const pKey = `tool:${t.callId}`
							const pOpen = Boolean(openPayloads[pKey])
							return (
								<div key={t.callId}>
									<button
										type="button"
										onClick={() => togglePayload(pKey)}
										className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left hover:bg-white/[0.03]"
									>
										<div className="flex min-w-0 items-center gap-2">
											<ChevronRight
												className={cn(
													"h-3 w-3 shrink-0 text-[#71858c] transition-transform",
													pOpen && "rotate-90",
												)}
											/>
											<span
												className={cn(
													"h-1.5 w-1.5 shrink-0 rounded-full",
													t.status === "ok"
														? "bg-emerald-400"
														: t.status === "error"
															? "bg-red-400"
															: "animate-ping bg-amber-400",
												)}
											/>
											<span className="truncate font-mono text-[11.5px] text-[#75e4c7]">
												{t.toolName}
											</span>
										</div>
										<span className="shrink-0 font-mono text-[11px] text-[#71858c]">
											{t.durationMs !== null ? `${t.durationMs}ms` : "running..."}
										</span>
									</button>
									{pOpen && (
										<pre className="my-1 ml-5 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[#1c2a33] bg-[#080d12] p-2.5 font-mono text-[11px] text-[#c7d3d6]">
											{`ARGS:   ${t.argsJson || "{}"}\nRESULT: ${t.resultJson || "running..."}`}
										</pre>
									)}
								</div>
							)
						})}

						{finalMsg && (
							<div className="ml-5 rounded-md border border-[#1c2a33]/80 bg-[#080d12]/70 px-3 py-2 text-[12.5px] leading-relaxed text-[#c7d3d6]">
								{finalMsg}
							</div>
						)}
					</div>
				)}
			</div>
		)
	}

	return (
		<div className="space-y-3">
			{/* Root Collapsible Summary Toggle */}
			<div className="flex flex-wrap items-center justify-between gap-2">
				<button
					type="button"
					onClick={() => setRootOpen((v) => !v)}
					className="inline-flex items-center gap-2 text-left text-[13px] font-medium text-[#c7d3d6] hover:text-white"
				>
					<ChevronRight
						className={cn(
							"h-3.5 w-3.5 text-[#81949a] transition-transform duration-150",
							rootOpen && "rotate-90",
						)}
					/>
					<span
						className={cn(
							"h-2 w-2 rounded-full",
							isRunning
								? "animate-pulse bg-[#62e1c3]"
								: entry.pending
									? "bg-amber-400"
									: "bg-emerald-400",
						)}
					/>
					<span className={cn(isRunning && "animate-pulse text-[#e3edef]")}>
						{isRunning
							? `Working (${elapsedSec}s)...`
							: entry.pending
								? `Paused for review (${elapsedSec}s)`
								: `Worked for ${elapsedSec}s`}
					</span>
					<span className="font-mono text-[11.5px] text-[#71858c]">
						· {visibleAgents.length} agent{visibleAgents.length === 1 ? "" : "s"}, {totalTools} tool{totalTools === 1 ? "" : "s"}, {totalThoughts} thought{totalThoughts === 1 ? "" : "s"}
					</span>
				</button>

				<button
					type="button"
					onClick={handleToggleAll}
					className="rounded-md border border-[#1c2a33] bg-[#080d12] px-2.5 py-1 font-mono text-[11px] text-[#81949a] hover:border-[#32454d] hover:text-[#e3edef]"
				>
					{expandAll ? "Collapse all" : "Expand all"}
				</button>
			</div>

			{rootOpen && (
				<div className="ml-1.5 space-y-1.5 border-l border-[#24323c] pl-3.5">
					{/* Parallel Barrier Span */}
					<div className="flex items-center justify-between gap-2 rounded-md px-2 py-1 font-mono text-[11.5px]">
						<div className="flex items-center gap-2">
							<span
								className={cn(
									"h-2 w-2 rounded-full",
									completedSpecialists >= expectedCount
										? "bg-emerald-400"
										: "animate-pulse bg-amber-400 shadow-[0_0_6px_#fbbf24]",
								)}
							/>
							<span className="text-[#c7d3d6]">
								{completedSpecialists >= expectedCount
									? `Barrier resolved · ${completedSpecialists}/${expectedCount} subagents merged`
									: `Waiting on ${expectedCount} subagents (${completedSpecialists}/${expectedCount} joined)...`}
							</span>
						</div>
						<span className="text-[#71858c]">{entry.phase}</span>
					</div>

					{/* Parallel Subagent Branches */}
					{specialists.map((a) => renderAgentBranch(a, a.status === "running"))}

					{/* Lead Auditor Branch */}
					{auditor && renderAgentBranch(auditor, true)}
				</div>
			)}
		</div>
	)
}
