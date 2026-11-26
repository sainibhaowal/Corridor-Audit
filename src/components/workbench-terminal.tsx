"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronDown, ChevronUp, CircleHelp, Trash2, X } from "lucide-react"
import { cn } from "@/lib/utils"

export interface RuntimeConsoleEvent {
	id: string
	timestamp: string
	kind: string
	text: string
	agentName?: string
	toolName?: string
	caseId: string
}

type ConsoleLine = { id: string; tone: "input" | "output" | "runtime" | "error"; text: string; time: string }

interface WorkbenchTerminalProps {
	open: boolean
	height: number
	events: RuntimeConsoleEvent[]
	onHeightChange: (height: number) => void
	onClose: () => void
	onGateChange: (mode: "risk_only" | "step_tool") => void
}

function stamp(date = new Date()): string {
	return date.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

export function WorkbenchTerminal({ open, height, events, onHeightChange, onClose, onGateChange }: WorkbenchTerminalProps) {
	const [lines, setLines] = useState<ConsoleLine[]>([
		{ id: "welcome", tone: "output", text: "CorridorAudit application console. Type `help` for runtime commands.", time: "--:--:--" },
	])
	const [command, setCommand] = useState("")
	const [history, setHistory] = useState<string[]>([])
	const [historyIndex, setHistoryIndex] = useState(-1)
	const [busy, setBusy] = useState(false)
	const inputRef = useRef<HTMLInputElement>(null)
	const scrollRef = useRef<HTMLDivElement>(null)
	const seenEvents = useRef(new Set<string>())

	const append = useCallback((tone: ConsoleLine["tone"], text: string) => {
		setLines((previous) => [...previous, { id: `${Date.now()}-${Math.random()}`, tone, text, time: stamp() }].slice(-250))
	}, [])

	useEffect(() => {
		const unseen = events.filter((event) => !seenEvents.current.has(event.id))
		if (unseen.length === 0) return
		for (const event of unseen) seenEvents.current.add(event.id)
		setLines((previous) => [
			...previous,
			...unseen.map((event) => ({
				id: event.id,
				tone: "runtime" as const,
				time: stamp(new Date(event.timestamp)),
				text: [event.caseId, event.agentName, event.toolName, event.text || event.kind.replaceAll(".", " ")].filter(Boolean).join("  ·  "),
			})),
		].slice(-250))
	}, [events])

	useEffect(() => {
		if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
	}, [open, lines])

	const submit = async (raw: string) => {
		const value = raw.trim()
		if (!value || busy) return
		if (value.toLowerCase() === "clear") {
			setLines([])
			setCommand("")
			setHistory((items) => [value, ...items].slice(0, 60))
			setHistoryIndex(-1)
			return
		}
		append("input", `$ ${value}`)
		setHistory((items) => [value, ...items].slice(0, 60))
		setHistoryIndex(-1)
		setCommand("")
		setBusy(true)
		try {
			const response = await fetch("/api/terminal", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ command: value }),
			})
			const result = (await response.json()) as { ok?: boolean; output?: string[]; breakpointMode?: "risk_only" | "step_tool" }
			if (result.breakpointMode) onGateChange(result.breakpointMode)
			for (const line of result.output ?? []) append(response.ok ? "output" : "error", line)
		} catch (error) {
			append("error", error instanceof Error ? error.message : "Console request failed.")
		} finally {
			setBusy(false)
			inputRef.current?.focus()
		}
	}

	return (
		<section
			aria-label="Integrated application terminal"
			className={cn("relative flex shrink-0 flex-col border-t border-[#32454d] bg-[#11151b] text-[#c7d3d6]", !open && "h-9")}
			style={open ? { height } : undefined}
		>
			{open && (
				<div
					role="separator"
					aria-orientation="horizontal"
					aria-label="Resize terminal panel"
					className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize"
					onPointerDown={(event) => {
						const startY = event.clientY
						const startHeight = height
						const move = (moveEvent: PointerEvent) => onHeightChange(Math.max(140, Math.min(520, startHeight + startY - moveEvent.clientY)))
						const up = () => {
							window.removeEventListener("pointermove", move)
							window.removeEventListener("pointerup", up)
						}
						window.addEventListener("pointermove", move)
						window.addEventListener("pointerup", up)
					}}
				/>
			)}
			<header className="flex h-9 shrink-0 items-center justify-between border-b border-white/10 px-3">
				<div className="flex h-full items-center gap-4 text-[11px] font-semibold uppercase tracking-wide">
					<button type="button" className="h-full border-b-2 border-emerald-400 text-[#bccacd]" onClick={() => inputRef.current?.focus()}>
						Terminal
					</button>
					<span className="hidden text-[#81949a] sm:inline">Mozaik runtime · local app console</span>
				</div>
				<div className="flex items-center gap-1">
					<button type="button" aria-label="Show terminal commands" title="Show command help" onClick={() => void submit("help")} className="rounded p-1.5 text-[#71858c] hover:bg-[#0d141b]/10 hover:text-white"><CircleHelp className="h-3.5 w-3.5" /></button>
					<button type="button" aria-label="Clear terminal" title="Clear terminal" onClick={() => { setLines([]); inputRef.current?.focus() }} className="rounded p-1.5 text-[#71858c] hover:bg-[#0d141b]/10 hover:text-white"><Trash2 className="h-3.5 w-3.5" /></button>
					<button type="button" aria-label={open ? "Collapse terminal" : "Expand terminal"} title={open ? "Collapse terminal" : "Expand terminal"} onClick={onClose} className="rounded p-1.5 text-[#71858c] hover:bg-[#0d141b]/10 hover:text-white">{open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}</button>
					{open && <button type="button" aria-label="Hide terminal" title="Hide terminal" onClick={onClose} className="rounded p-1.5 text-[#71858c] hover:bg-[#0d141b]/10 hover:text-white"><X className="h-3.5 w-3.5" /></button>}
				</div>
			</header>
			{open && (
				<>
					<div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-5" onClick={() => inputRef.current?.focus()}>
						{lines.map((line) => (
							<div key={line.id} className={cn("grid grid-cols-[58px_minmax(0,1fr)] gap-2 whitespace-pre-wrap break-words", line.tone === "input" ? "text-emerald-300" : line.tone === "error" ? "text-rose-300" : line.tone === "runtime" ? "text-sky-200" : "text-[#bccacd]")}>
								<span className="select-none text-[#a4b4b8]">{line.time}</span><span>{line.text}</span>
							</div>
						))}
						{busy && <div className="text-amber-300">Processing app command…</div>}
					</div>
					<form className="flex h-9 shrink-0 items-center gap-2 border-t border-white/10 px-3 font-mono text-[11px]" onSubmit={(event) => { event.preventDefault(); void submit(command) }}>
						<span className="select-none text-emerald-400">corridoraudit›</span>
						<input
							ref={inputRef}
							value={command}
							onChange={(event) => setCommand(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "ArrowUp" && history.length) { event.preventDefault(); const i = Math.min(historyIndex + 1, history.length - 1); setHistoryIndex(i); setCommand(history[i]) }
								if (event.key === "ArrowDown" && historyIndex >= 0) { event.preventDefault(); const i = historyIndex - 1; setHistoryIndex(i); setCommand(i >= 0 ? history[i] : "") }
							}}
							placeholder="help · status · cases · inspect &lt;caseId&gt;"
							aria-label="Enter an application console command"
							className="min-w-0 flex-1 bg-transparent text-[#bccacd] outline-none placeholder:text-[#a4b4b8]"
						/>
						<span className="hidden text-[#a4b4b8] md:inline">Enter to run · ↑↓ history</span>
					</form>
				</>
			)}
		</section>
	)
}
