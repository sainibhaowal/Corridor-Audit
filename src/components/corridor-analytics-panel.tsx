"use client"

import { useMemo, useState } from "react"
import { Activity, Cpu, Lock, PieChart, ShieldCheck, TrendingUp } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { AuditVerdict } from "@/core/types"
import { type CaseStreamEntry, fmtClientMoney, type ProviderStatus, type QueueStats } from "./corridor-types"

interface CorridorAnalyticsPanelProps {
	verdicts: AuditVerdict[]
	casesMap: Record<string, CaseStreamEntry>
	provider: ProviderStatus | null
	queueStats: QueueStats
	onSelectCase: (caseId: string) => void
}

type TrendMetric = "leakBps" | "settled" | "fxBps"
type TrendMode = "area" | "line" | "bar"
type BreakdownMode = "bar" | "donut"

const AGENT_COLORS: Record<string, string> = {
	TermsAgent: "#38bdf8",
	FxBenchmarkAgent: "#f59e0b",
	WireDetectiveAgent: "#62e1c3",
	DuplicateAnomalyAgent: "#f43f5e",
	AuditorAgent: "#a78bfa",
}

function minorToUnits(minor: number, currency: string): number {
	const exp = currency === "JPY" ? 0 : currency === "KWD" || currency === "BHD" ? 3 : 2
	return minor / Math.pow(10, exp)
}

export function CorridorAnalyticsPanel({
	verdicts,
	casesMap,
	provider,
	queueStats,
	onSelectCase,
}: CorridorAnalyticsPanelProps) {
	const [trendMetric, setTrendMetric] = useState<TrendMetric>("leakBps")
	const [trendMode, setTrendMode] = useState<TrendMode>("area")
	const [hoveredTrendIdx, setHoveredTrendIdx] = useState<number | null>(null)
	const [breakdownMode, setBreakdownMode] = useState<BreakdownMode>("bar")
	const [hoveredSegment, setHoveredSegment] = useState<string | null>(null)
	const [hoveredHeatId, setHoveredHeatId] = useState<string | null>(null)

	const evidenceBacked = useMemo(
		() => verdicts.filter((v) => v.status !== "EVIDENCE_INCOMPLETE"),
		[verdicts],
	)

	// 1. Leak Breakdown Segments (real minor sums across evidence-backed verdicts)
	const leakSegments = useMemo(() => {
		let fx = 0
		let lifting = 0
		let platform = 0
		let tax = 0
		let recoverable = 0
		const primaryCcy = evidenceBacked[0]?.numbers.settledCurrency || "USD"
		for (const v of evidenceBacked) {
			fx += v.numbers.fxSpreadLossMinor
			lifting += v.numbers.liftingAndRepairFeesMinor
			platform += v.numbers.platformFeeMinor
			tax += v.numbers.withholdingTaxMinor
			recoverable += v.numbers.recoverableFeeMinor
		}
		const items = [
			{ key: "fx", label: "FX Spread", minor: fx, color: "#f59e0b" },
			{ key: "lifting", label: "Lifting / Repair", minor: lifting, color: "#38bdf8" },
			{ key: "platform", label: "Platform Fees", minor: platform, color: "#a78bfa" },
			{ key: "tax", label: "Withholding Tax", minor: tax, color: "#64748b" },
			{ key: "recoverable", label: "Recoverable OUR", minor: recoverable, color: "#62e1c3" },
		]
		const total = items.reduce((acc, s) => acc + s.minor, 0)
		return {
			primaryCcy,
			total,
			items: items.map((s) => ({
				...s,
				pct: total > 0 ? Math.round((s.minor / total) * 100) : 0,
			})),
		}
	}, [evidenceBacked])

	// 2. Trend Series sorted chronologically
	const trendSeries = useMemo(() => {
		const sorted = [...verdicts].sort((a, b) => a.completedAt.localeCompare(b.completedAt)).slice(-16)
		return sorted.map((v) => {
			const ccy = v.numbers.settledCurrency || "USD"
			const value =
				trendMetric === "leakBps"
					? v.replay.totalLeakBps
					: trendMetric === "fxBps"
						? v.numbers.fxSpreadBps
						: minorToUnits(v.numbers.settledMinor, ccy)
			return {
				caseId: v.caseId,
				dateLabel: v.completedAt.slice(5, 10),
				value,
				formattedValue:
					trendMetric === "settled"
						? fmtClientMoney(v.numbers.settledMinor, ccy)
						: `${(value / 100).toFixed(2)}% (${value} bps)`,
				status: v.status,
			}
		})
	}, [verdicts, trendMetric])

	const maxTrend = useMemo(
		() => Math.max(1, ...trendSeries.map((d) => d.value)),
		[trendSeries],
	)

	// 3. Real Agent & Tool Telemetry computed from live trajectory events
	const agentStats = useMemo(() => {
		const counts: Record<string, { calls: number; totalMs: number }> = {
			TermsAgent: { calls: 0, totalMs: 0 },
			FxBenchmarkAgent: { calls: 0, totalMs: 0 },
			WireDetectiveAgent: { calls: 0, totalMs: 0 },
			DuplicateAnomalyAgent: { calls: 0, totalMs: 0 },
			AuditorAgent: { calls: 0, totalMs: 0 },
		}
		let totalCalls = 0
		for (const entry of Object.values(casesMap)) {
			for (const agent of Object.values(entry.agents || {})) {
				const bucket = counts[agent.name]
				if (!bucket) continue
				for (const tool of Object.values(agent.tools || {})) {
					bucket.calls += 1
					bucket.totalMs += tool.durationMs ?? 0
					totalCalls += 1
				}
			}
		}
		const rows = Object.entries(counts).map(([name, stat]) => ({
			name,
			calls: stat.calls,
			avgMs: stat.calls > 0 ? Math.round(stat.totalMs / stat.calls) : 0,
			pct: totalCalls > 0 ? Math.round((stat.calls / totalCalls) * 100) : 0,
			color: AGENT_COLORS[name] || "#62e1c3",
		}))
		return { totalCalls, rows }
	}, [casesMap])

	// 4. Trust & Verification Metrics (100% derived from real verdicts)
	const trustMetrics = useMemo(() => {
		const total = verdicts.length
		const backed = evidenceBacked.length
		const zeroDrift = evidenceBacked.filter((v) => v.numbers.unexplainedVarianceMinor === 0).length
		const cited = verdicts.filter((v) => v.sourceRefs.length > 0).length
		return {
			zeroDriftPct: backed > 0 ? Math.round((zeroDrift / backed) * 100) : 100,
			evidenceBackedPct: total > 0 ? Math.round((backed / total) * 100) : 0,
			citedPct: total > 0 ? Math.round((cited / total) * 100) : 100,
			total,
			backed,
			zeroDrift,
		}
	}, [verdicts, evidenceBacked])

	// Donut SVG geometry
	const donutPaths = useMemo(() => {
		const nonZero = leakSegments.items.filter((i) => i.minor > 0)
		if (nonZero.length === 0) return []
		const radius = 38
		const circumference = 2 * Math.PI * radius
		let offset = 0
		return nonZero.map((item) => {
			const len = (item.minor / leakSegments.total) * circumference
			const seg = { ...item, len, offset }
			offset += len
			return seg
		})
	}, [leakSegments])

	return (
		<div className="space-y-4">
			{/* Row 1: Real-Time Trend Chart + Leak Breakdown */}
			<div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
				{/* Real-Time Trend Chart (Line / Area / Bar) */}
				<Card className="p-4 xl:col-span-7">
					<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
						<div>
							<div className="flex items-center gap-2">
								<TrendingUp className="h-4 w-4 text-[#62e1c3]" />
								<span className="text-xs font-bold uppercase tracking-wider text-[#e3edef]">
									Corridor Leak &amp; Volume Trend
								</span>
								<Badge variant="ok" className="font-mono text-[10px]">
									Real-Time
								</Badge>
							</div>
							<div className="mt-0.5 text-[11px] text-[#81949a]">
								{trendSeries.length} completed case{trendSeries.length === 1 ? "" : "s"} · Integer minor-unit verified
							</div>
						</div>

						<div className="flex flex-wrap items-center gap-1.5">
							<div className="flex rounded-lg border border-[#1c2a33] bg-[#080d12] p-0.5 text-[11px]">
								{(
									[
										{ id: "leakBps", label: "Leak bps" },
										{ id: "fxBps", label: "FX bps" },
										{ id: "settled", label: "Volume" },
									] as const
								).map((m) => (
									<button
										key={m.id}
										type="button"
										onClick={() => setTrendMetric(m.id)}
										className={cn(
											"rounded-md px-2 py-1 font-semibold transition-colors",
											trendMetric === m.id ? "bg-[#12222c] text-[#62e1c3]" : "text-[#81949a] hover:text-[#e3edef]",
										)}
									>
										{m.label}
									</button>
								))}
							</div>
							<div className="flex rounded-lg border border-[#1c2a33] bg-[#080d12] p-0.5 text-[11px]">
								{(["area", "line", "bar"] as const).map((mode) => (
									<button
										key={mode}
										type="button"
										onClick={() => setTrendMode(mode)}
										className={cn(
											"rounded-md px-2 py-1 capitalize font-semibold transition-colors",
											trendMode === mode ? "bg-[#12222c] text-[#e3edef]" : "text-[#81949a] hover:text-[#e3edef]",
										)}
									>
										{mode}
									</button>
								))}
							</div>
						</div>
					</div>

					{trendSeries.length === 0 ? (
						<div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-[#1c2a33] bg-[#080d12] text-xs text-[#71858c]">
							Upload or stream a case to view live corridor trends.
						</div>
					) : (
						<div className="relative">
							<svg viewBox="0 0 560 170" className="h-44 w-full overflow-visible">
								<defs>
									<linearGradient id="corridorAreaGrad" x1="0" y1="0" x2="0" y2="1">
										<stop offset="0%" stopColor="#62e1c3" stopOpacity="0.32" />
										<stop offset="100%" stopColor="#62e1c3" stopOpacity="0.02" />
									</linearGradient>
									<linearGradient id="corridorBarGrad" x1="0" y1="0" x2="0" y2="1">
										<stop offset="0%" stopColor="#62e1c3" />
										<stop offset="100%" stopColor="#1b5e54" />
									</linearGradient>
								</defs>
								{/* Grid lines */}
								{[0.25, 0.5, 0.75, 1].map((g) => (
									<line
										key={g}
										x1={24}
										x2={548}
										y1={145 - g * 120}
										y2={145 - g * 120}
										stroke="#1c2a33"
										strokeDasharray="3 3"
									/>
								))}

								{trendMode === "bar" ? (
									trendSeries.map((pt, idx) => {
										const slotW = 520 / Math.max(trendSeries.length, 1)
										const barW = Math.min(26, Math.max(8, slotW * 0.62))
										const x = 28 + idx * slotW + (slotW - barW) / 2
										const h = Math.max(4, (pt.value / maxTrend) * 120)
										const y = 145 - h
										return (
											<g
												key={pt.caseId}
												className="cursor-pointer"
												onMouseEnter={() => setHoveredTrendIdx(idx)}
												onMouseLeave={() => setHoveredTrendIdx(null)}
												onClick={() => onSelectCase(pt.caseId)}
											>
												<rect
													x={x}
													y={y}
													width={barW}
													height={h}
													rx={4}
													fill={hoveredTrendIdx === idx ? "#75e4c7" : "url(#corridorBarGrad)"}
												/>
											</g>
										)
									})
								) : (
									(() => {
										const pts = trendSeries.map((pt, idx) => {
											const x =
												trendSeries.length === 1
													? 286
													: 28 + (idx / (trendSeries.length - 1)) * 516
											const y = 145 - (pt.value / maxTrend) * 120
											return { x, y, pt }
										})
										const lineD = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ")
										const areaD = `${lineD} L ${pts[pts.length - 1].x} 145 L ${pts[0].x} 145 Z`
										return (
											<>
												{trendMode === "area" && <path d={areaD} fill="url(#corridorAreaGrad)" />}
												<path d={lineD} fill="none" stroke="#62e1c3" strokeWidth={2.5} strokeLinejoin="round" />
												{pts.map((p, idx) => (
													<circle
														key={p.pt.caseId}
														cx={p.x}
														cy={p.y}
														r={hoveredTrendIdx === idx ? 5.5 : 3.5}
														fill={hoveredTrendIdx === idx ? "#ffffff" : "#62e1c3"}
														stroke="#0d141b"
														strokeWidth={1.5}
														className="cursor-pointer"
														onMouseEnter={() => setHoveredTrendIdx(idx)}
														onMouseLeave={() => setHoveredTrendIdx(null)}
														onClick={() => onSelectCase(p.pt.caseId)}
													/>
												))}
											</>
										)
									})()
								)}
							</svg>

							{hoveredTrendIdx !== null && trendSeries[hoveredTrendIdx] && (
								<div className="mt-1 flex items-center justify-between rounded-lg border border-[#2c4a43] bg-[#080d12] px-3 py-1.5 text-[11px]">
									<span className="font-mono font-bold text-[#e3edef]">
										{trendSeries[hoveredTrendIdx].caseId} · {trendSeries[hoveredTrendIdx].dateLabel}
									</span>
									<span className="font-mono font-semibold text-[#62e1c3]">
										{trendSeries[hoveredTrendIdx].formattedValue}
									</span>
								</div>
							)}
						</div>
					)}
				</Card>

				{/* Compact Leak Breakdown (Stacked Bar / Donut Pie) */}
				<Card className="flex flex-col justify-between p-4 xl:col-span-5">
					<div>
						<div className="mb-3 flex items-center justify-between gap-2">
							<div className="flex items-center gap-2">
								<PieChart className="h-4 w-4 text-amber-400" />
								<span className="text-xs font-bold uppercase tracking-wider text-[#e3edef]">
									Compact Cost &amp; Leak Breakdown
								</span>
							</div>
							<div className="flex rounded-lg border border-[#1c2a33] bg-[#080d12] p-0.5 text-[11px]">
								{(["bar", "donut"] as const).map((m) => (
									<button
										key={m}
										type="button"
										onClick={() => setBreakdownMode(m)}
										className={cn(
											"rounded-md px-2 py-0.5 capitalize font-semibold",
											breakdownMode === m ? "bg-[#12222c] text-[#e3edef]" : "text-[#81949a] hover:text-[#e3edef]",
										)}
									>
										{m === "bar" ? "Stacked" : "Pie"}
									</button>
								))}
							</div>
						</div>

						{breakdownMode === "bar" ? (
							<div className="mb-4 flex h-3 w-full overflow-hidden rounded-full bg-[#101820]">
								{leakSegments.total === 0 ? (
									<div className="h-full w-full bg-[#1c2a33]" />
								) : (
									leakSegments.items.map((seg) =>
										seg.minor > 0 ? (
											<div
												key={seg.key}
												style={{ width: `${Math.max(3, seg.pct)}%`, backgroundColor: seg.color }}
												onMouseEnter={() => setHoveredSegment(seg.key)}
												onMouseLeave={() => setHoveredSegment(null)}
												className="h-full transition-opacity hover:opacity-85"
												title={`${seg.label}: ${fmtClientMoney(seg.minor, leakSegments.primaryCcy)} (${seg.pct}%)`}
											/>
										) : null,
									)
								)}
							</div>
						) : (
							<div className="mb-3 flex items-center justify-center">
								<svg viewBox="0 0 100 100" className="h-28 w-28 -rotate-90">
									<circle cx="50" cy="50" r="38" fill="none" stroke="#101820" strokeWidth="14" />
									{donutPaths.map((seg) => (
										<circle
											key={seg.key}
											cx="50"
											cy="50"
											r="38"
											fill="none"
											stroke={seg.color}
											strokeWidth={hoveredSegment === seg.key ? 16 : 14}
											strokeDasharray={`${seg.len} ${2 * Math.PI * 38}`}
											strokeDashoffset={-seg.offset}
											onMouseEnter={() => setHoveredSegment(seg.key)}
											onMouseLeave={() => setHoveredSegment(null)}
										/>
									))}
								</svg>
							</div>
						)}

						<div className="space-y-2">
							{leakSegments.items.map((seg) => (
								<div
									key={seg.key}
									onMouseEnter={() => setHoveredSegment(seg.key)}
									onMouseLeave={() => setHoveredSegment(null)}
									className={cn(
										"flex items-center justify-between rounded-md px-2 py-1 text-xs transition-colors",
										hoveredSegment === seg.key ? "bg-[#101820]" : "",
									)}
								>
									<div className="flex items-center gap-2">
										<span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: seg.color }} />
										<span className="text-[#c7d3d6]">{seg.label}</span>
									</div>
									<div className="flex items-center gap-3 font-mono tabular">
										<span className="font-semibold text-[#e3edef]">
											{fmtClientMoney(seg.minor, leakSegments.primaryCcy)}
										</span>
										<span className="w-8 text-right text-[11px] text-[#81949a]">{seg.pct}%</span>
									</div>
								</div>
							))}
						</div>
					</div>
					<div className="mt-3 border-t border-[#1c2a33] pt-2 text-[11px] text-[#71858c]">
						Total tracked cost flags: <span className="font-mono font-semibold text-[#e3edef]">{fmtClientMoney(leakSegments.total, leakSegments.primaryCcy)}</span>
					</div>
				</Card>
			</div>

			{/* Row 2: Model & Agent Usage Meter + Activity Heat-Graph + Trust & Verification Proof */}
			<div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
				{/* Model & Agent Usage Meter */}
				<Card className="p-4">
					<div className="mb-3 flex items-center justify-between">
						<div className="flex items-center gap-2">
							<Cpu className="h-4 w-4 text-sky-400" />
							<span className="text-xs font-bold uppercase tracking-wider text-[#e3edef]">
								Model &amp; Agent Usage
							</span>
						</div>
						<Badge variant={provider?.mode === "unconfigured" ? "warn" : "ok"} className="font-mono text-[10px]">
							{provider?.mode === "unconfigured" ? "No Key" : provider?.provider || "active"}
						</Badge>
					</div>
					<div className="mb-2 truncate font-mono text-xs font-semibold text-[#e3edef]">
						{provider?.modelDisplayName || provider?.modelName || "Configure LLM in Settings"}
					</div>
					<div className="mb-3 flex h-2 w-full overflow-hidden rounded-full bg-[#101820]">
						{agentStats.totalCalls === 0 ? (
							<div className="h-full w-full bg-[#1c2a33]" />
						) : (
							agentStats.rows.map((r) =>
								r.calls > 0 ? (
									<div
										key={r.name}
										style={{ width: `${Math.max(4, r.pct)}%`, backgroundColor: r.color }}
										className="h-full"
									/>
								) : null,
							)
						)}
					</div>
					<div className="space-y-1.5 text-[11.5px]">
						{agentStats.rows.map((r) => (
							<div key={r.name} className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<span className="h-2 w-2 rounded-full" style={{ backgroundColor: r.color }} />
									<span className="text-[#c7d3d6]">{r.name}</span>
								</div>
								<span className="font-mono text-[#81949a]">
									{r.calls} calls · {r.avgMs}ms
								</span>
							</div>
						))}
					</div>
					<div className="mt-3 border-t border-[#1c2a33] pt-2 text-[11px] text-[#71858c]">
						Queue: {queueStats.waiting} wait · {queueStats.active} active · {queueStats.done} done
					</div>
				</Card>

				{/* Activity & Risk Heat-Graph */}
				<Card className="flex flex-col justify-between p-4">
					<div>
						<div className="mb-3 flex items-center justify-between">
							<div className="flex items-center gap-2">
								<Activity className="h-4 w-4 text-[#62e1c3]" />
								<span className="text-xs font-bold uppercase tracking-wider text-[#e3edef]">
									Case Risk Heat-Graph
								</span>
							</div>
							<span className="font-mono text-[11px] text-[#81949a]">{verdicts.length} cases</span>
						</div>

						{verdicts.length === 0 ? (
							<div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-[#1c2a33] bg-[#080d12] text-xs text-[#71858c]">
								No cases audited yet.
							</div>
						) : (
							<div className="grid grid-cols-8 gap-1.5 sm:grid-cols-10">
								{verdicts.slice(-40).map((v) => {
									const bg =
										v.status === "CLEAN"
											? "bg-emerald-500/80"
											: v.status === "EVIDENCE_INCOMPLETE"
												? "bg-slate-600/70"
												: v.status === "VARIANCE_DETECTED" || v.status === "DUPLICATE_WIRE"
													? "bg-red-500/85"
													: "bg-amber-500/85"
									return (
										<button
											key={v.caseId}
											type="button"
											onClick={() => onSelectCase(v.caseId)}
											onMouseEnter={() => setHoveredHeatId(v.caseId)}
											onMouseLeave={() => setHoveredHeatId(null)}
											className={cn(
												"aspect-square rounded-[4px] border border-white/5 transition-transform hover:scale-110",
												bg,
											)}
											title={`${v.caseId} · ${v.status} · ${v.replay.totalLeakBps} bps`}
										/>
									)
								})}
							</div>
						)}
					</div>
					<div className="mt-3 flex items-center justify-between border-t border-[#1c2a33] pt-2 text-[11px] text-[#81949a]">
						<span className="truncate font-mono">
							{hoveredHeatId
								? `${hoveredHeatId} · ${(verdicts.find((v) => v.caseId === hoveredHeatId)?.replay.totalLeakBps ?? 0)} bps`
								: "Click any cell to inspect"}
						</span>
						<div className="flex items-center gap-1.5 text-[10px]">
							<span className="h-2 w-2 rounded-[2px] bg-emerald-500" /> Clean
							<span className="h-2 w-2 rounded-[2px] bg-amber-500" /> Flag
							<span className="h-2 w-2 rounded-[2px] bg-red-500" /> High
						</div>
					</div>
				</Card>

				{/* Fintech Trust & Verification Scorecard */}
				<Card className="flex flex-col justify-between p-4">
					<div>
						<div className="mb-3 flex items-center justify-between">
							<div className="flex items-center gap-2">
								<ShieldCheck className="h-4 w-4 text-[#62e1c3]" />
								<span className="text-xs font-bold uppercase tracking-wider text-[#e3edef]">
									Trust &amp; Accuracy Proof
								</span>
							</div>
							<Lock className="h-3.5 w-3.5 text-[#62e1c3]" />
						</div>

						<div className="space-y-2.5 text-xs">
							<div className="flex items-center justify-between rounded-lg border border-[#1c2a33] bg-[#080d12] px-3 py-2">
								<span className="text-[#c7d3d6]">Zero-Drift Cent Conservation</span>
								<span className="font-mono font-bold text-[#62e1c3]">
									{trustMetrics.zeroDriftPct}% ({trustMetrics.zeroDrift}/{trustMetrics.backed})
								</span>
							</div>
							<div className="flex items-center justify-between rounded-lg border border-[#1c2a33] bg-[#080d12] px-3 py-2">
								<span className="text-[#c7d3d6]">Grounded SourceRef Citations</span>
								<span className="font-mono font-bold text-[#e3edef]">{trustMetrics.citedPct}%</span>
							</div>
							<div className="flex items-center justify-between rounded-lg border border-[#1c2a33] bg-[#080d12] px-3 py-2">
								<span className="text-[#c7d3d6]">Evidence-Backed Verdicts</span>
								<span className="font-mono font-bold text-sky-400">{trustMetrics.evidenceBackedPct}%</span>
							</div>
						</div>
					</div>
					<div className="mt-3 border-t border-[#1c2a33] pt-2 text-[11px] text-[#71858c]">
						Integer-cents TypeScript math · ECB rates · AES-256-GCM + SHA-256 Vault
					</div>
				</Card>
			</div>
		</div>
	)
}
