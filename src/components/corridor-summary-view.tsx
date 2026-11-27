"use client"

import { Download } from "lucide-react"
import type { AuditVerdict } from "@/core/types"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { CorridorAnalyticsPanel } from "./corridor-analytics-panel"
import { type CaseStreamEntry, fmtClientMoney, type ProviderStatus, type QueueStats, verdictBadgeVariant, verdictStatusLabel } from "./corridor-types"

function formatBreakdown(verdicts: AuditVerdict[], pick: (v: AuditVerdict) => number): string {
	const totals = new Map<string, number>()
	for (const v of verdicts) {
		const amt = Number(pick(v) || 0)
		if (amt === 0) continue
		const ccy = v.numbers.settledCurrency || "USD"
		totals.set(ccy, (totals.get(ccy) || 0) + amt)
	}
	if (totals.size === 0) return "$0.00"
	return [...totals.entries()].map(([ccy, amt]) => fmtClientMoney(amt, ccy)).join(" + ")
}

interface CorridorSummaryViewProps {
	verdicts: AuditVerdict[]
	casesMap?: Record<string, CaseStreamEntry>
	provider?: ProviderStatus | null
	queueStats?: QueueStats
	onSelectCase: (caseId: string) => void
}

export function CorridorSummaryView({
	verdicts,
	casesMap = {},
	provider = null,
	queueStats = { waiting: 0, active: 0, done: verdicts.length, failed: 0 },
	onSelectCase,
}: CorridorSummaryViewProps) {
	const evidenceBackedVerdicts = verdicts.filter((v) => v.status !== "EVIDENCE_INCOMPLETE")
	const recoverLabel = formatBreakdown(evidenceBackedVerdicts, (v) => v.numbers.recoverableFeeMinor)
	const fxLabel = formatBreakdown(evidenceBackedVerdicts, (v) => v.numbers.fxSpreadLossMinor)
	const varianceCount = verdicts.filter((v) => v.status === "VARIANCE_DETECTED").length
	const withinThresholdCount = verdicts.filter((v) => v.status === "VARIANCE_WITHIN_THRESHOLD").length
	const incompleteCount = verdicts.filter((v) => v.status === "EVIDENCE_INCOMPLETE").length

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h1 className="text-xl font-extrabold tracking-tight text-[#e3edef]">
						Cross-Border Settlement Summary
					</h1>
					<p className="mt-1 text-xs text-[#81949a]">
						Calculated from saved case verdicts. Estimates without payment evidence are excluded from fee and FX totals.
					</p>
				</div>
				{verdicts.length > 0 && (
					<div className="flex flex-wrap gap-2">
						<a
							href="/api/report?format=csv"
							download
							className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#2c4a43] bg-[#0e2620] px-3 text-xs font-semibold text-[#62e1c3] hover:bg-[#14352d]"
						>
							<Download className="h-3.5 w-3.5" />
							Export Sheet (.csv)
						</a>
						<a
							href="/api/report?format=json"
							download
							className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#32454d] bg-[#0d141b] px-3 text-xs font-semibold text-[#c7d3d6] hover:bg-[#121c24]"
						>
							<Download className="h-3.5 w-3.5" />
							Export All (.json)
						</a>
					</div>
				)}
			</div>

			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
				<Card className="flex min-h-[100px] flex-col justify-between p-4">
					<div className="text-[11px] font-bold uppercase tracking-wider text-[#81949a]">
						Cases Processed
					</div>
					<div className="tabular text-2xl font-extrabold tracking-tight text-[#e3edef]">
						{verdicts.length}
					</div>
					<div className="text-[11px] text-[#71858c]">
						{incompleteCount} need required evidence
					</div>
				</Card>

				<Card className="flex min-h-[100px] flex-col justify-between p-4">
					<div className="text-[11px] font-bold uppercase tracking-wider text-[#81949a]">
						Potential OUR Fee Flags
					</div>
					<div className="tabular text-2xl font-extrabold tracking-tight text-[#62e1c3]">
						{recoverLabel}
					</div>
					<div className="text-[11px] text-[#71858c]">Calculated flags, not confirmed recoveries</div>
				</Card>

				<Card className="flex min-h-[100px] flex-col justify-between p-4">
					<div className="text-[11px] font-bold uppercase tracking-wider text-[#81949a]">
						Estimated FX Spread
					</div>
					<div className="tabular text-2xl font-extrabold tracking-tight text-amber-700">
						{fxLabel}
					</div>
					<div className="text-[11px] text-[#71858c]">vs. official ECB mid-market</div>
				</Card>

				<Card className="flex min-h-[100px] flex-col justify-between p-4">
					<div className="text-[11px] font-bold uppercase tracking-wider text-[#81949a]">
						Above Threshold
					</div>
					<div
						className={`tabular text-2xl font-extrabold tracking-tight ${
							varianceCount > 0 ? "text-red-600" : "text-[#62e1c3]"
						}`}
					>
						{varianceCount}
					</div>
					<div className="text-[11px] text-[#71858c]">
						{withinThresholdCount} within threshold · {incompleteCount} incomplete
					</div>
				</Card>
			</div>

			<CorridorAnalyticsPanel
				verdicts={verdicts}
				casesMap={casesMap}
				provider={provider}
				queueStats={queueStats}
				onSelectCase={onSelectCase}
			/>

			<Card className="overflow-hidden">
				<div className="overflow-x-auto">
					<table className="w-full border-collapse text-xs">
						<thead>
							<tr className="border-b border-[#1c2a33] bg-[#080d12] text-[11px] font-bold uppercase tracking-wider text-[#81949a]">
								<th className="px-4 py-3 text-left">Case</th>
								<th className="px-4 py-3 text-left">Wire / Channel</th>
								<th className="px-4 py-3 text-right">Estimated FX Spread</th>
								<th className="px-4 py-3 text-right">Fees / Potential Flag</th>
								<th className="px-4 py-3 text-right">Variance</th>
								<th className="px-4 py-3 text-left">Verdict</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-[#1c2a33]">
							{verdicts.length === 0 ? (
								<tr>
									<td colSpan={6} className="px-4 py-8 text-center text-xs text-[#81949a]">
										No completed audits yet. Click <strong>Stream 6-Case Batch</strong> in the left
										sidebar or upload a file in <strong>Inbound Sources</strong>.
									</td>
								</tr>
							) : (
								verdicts.map((v) => {
									const ccy = v.numbers.settledCurrency
									const fees = v.numbers.liftingAndRepairFeesMinor + v.numbers.platformFeeMinor
									return (
										<tr
											key={v.caseId}
											onClick={() => onSelectCase(v.caseId)}
											className="cursor-pointer transition-colors hover:bg-[#080d12]"
										>
											<td className="px-4 py-3 font-mono">
												<div className="font-bold text-[#e3edef]">{v.caseId}</div>
												<div className="text-[11px] text-[#81949a]">{v.invoiceId}</div>
											</td>
											<td className="px-4 py-3 text-[#c7d3d6]">{v.wireId}</td>
											<td className="px-4 py-3 text-right font-mono tabular text-amber-700">
												{fmtClientMoney(v.numbers.fxSpreadLossMinor, ccy)} (
												{(v.numbers.fxSpreadBps / 100).toFixed(2)}%)
											</td>
											<td className="px-4 py-3 text-right font-mono tabular">
												{fmtClientMoney(fees, ccy)} /{" "}
												<strong className="text-[#75e4c7]">
													{fmtClientMoney(v.numbers.recoverableFeeMinor, ccy)}
												</strong>
											</td>
											<td className="px-4 py-3 text-right font-mono tabular font-semibold">
												{fmtClientMoney(v.numbers.unexplainedVarianceMinor, ccy)}
											</td>
											<td className="px-4 py-3">
												<Badge variant={verdictBadgeVariant(v.status)}>
												{verdictStatusLabel(v.status)}
												</Badge>
											</td>
										</tr>
									)
								})
							)}
						</tbody>
					</table>
				</div>
			</Card>
		</div>
	)
}
