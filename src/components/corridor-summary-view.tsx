"use client"

import type { AuditVerdict } from "@/core/types"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { fmtClientMoney, verdictBadgeVariant } from "./corridor-types"

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
	onSelectCase: (caseId: string) => void
}

export function CorridorSummaryView({ verdicts, onSelectCase }: CorridorSummaryViewProps) {
	const recoverLabel = formatBreakdown(verdicts, (v) => v.numbers.recoverableFeeMinor)
	const fxLabel = formatBreakdown(verdicts, (v) => v.numbers.fxSpreadLossMinor)
	const varianceCount = verdicts.filter((v) => v.numbers.unexplainedVarianceMinor !== 0).length

	return (
		<div className="space-y-4">
			<div>
				<div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#62e1c3]">
					CORRIDOR ANALYTICS <span className="text-[#50646b]">/ CENT-PROOF LEDGER</span>
				</div>
				<h1 className="mt-1 text-xl font-semibold tracking-tight text-[#dce8e9]">
					Cross-Border Corridor Leak Summary
				</h1>
				<p className="mt-1 text-xs text-[#7e9298]">
					Aggregated cents-verified totals across all completed audits and corridor channels.
				</p>
			</div>

			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
				<Card className="flex min-h-[96px] flex-col justify-between p-4">
					<div className="font-mono text-[10px] uppercase tracking-wider text-[#7e9298]">
						Cases Audited
					</div>
					<div className="tabular font-mono text-2xl font-bold text-[#dce8e9]">{verdicts.length}</div>
					<div className="text-[11px] text-[#50646b]">
						{verdicts.length === 0 ? "Awaiting batch or upload" : "Cent-proof complete"}
					</div>
				</Card>

				<Card className="flex min-h-[96px] flex-col justify-between p-4">
					<div className="font-mono text-[10px] uppercase tracking-wider text-[#7e9298]">
						Recoverable Fees
					</div>
					<div className="tabular font-mono text-2xl font-bold text-[#62e1c3]">{recoverLabel}</div>
					<div className="text-[11px] text-[#50646b]">Wrongful :71A:OUR deductions</div>
				</Card>

				<Card className="flex min-h-[96px] flex-col justify-between p-4">
					<div className="font-mono text-[10px] uppercase tracking-wider text-[#7e9298]">
						Hidden FX Spread
					</div>
					<div className="tabular font-mono text-2xl font-bold text-[#e7b56a]">{fxLabel}</div>
					<div className="text-[11px] text-[#50646b]">vs. official ECB mid-market</div>
				</Card>

				<Card className="flex min-h-[96px] flex-col justify-between p-4">
					<div className="font-mono text-[10px] uppercase tracking-wider text-[#7e9298]">
						Open Variances
					</div>
					<div
						className={`tabular font-mono text-2xl font-bold ${
							varianceCount > 0 ? "text-[#f17678]" : "text-[#62e1c3]"
						}`}
					>
						{varianceCount}
					</div>
					<div className="text-[11px] text-[#50646b]">
						{varianceCount > 0 ? "Unexplained short-pay flagged" : "Zero unexplained drift"}
					</div>
				</Card>
			</div>

			<Card className="overflow-hidden">
				<div className="overflow-x-auto">
					<table className="w-full border-collapse text-xs">
						<thead>
							<tr className="border-b border-[#1b2a34] bg-[#090e14] font-mono text-[10px] uppercase tracking-wider text-[#7e9298]">
								<th className="px-4 py-3 text-left">Case</th>
								<th className="px-4 py-3 text-left">Wire / Channel</th>
								<th className="px-4 py-3 text-right">FX Spread Leak</th>
								<th className="px-4 py-3 text-right">Fees / Recoverable</th>
								<th className="px-4 py-3 text-right">Variance</th>
								<th className="px-4 py-3 text-left">Verdict</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-[#1b2a34]/70">
							{verdicts.length === 0 ? (
								<tr>
									<td colSpan={6} className="px-4 py-8 text-center text-xs text-[#7e9298]">
										No completed audits yet — click{" "}
										<strong className="text-[#dce8e9]">Stream 6-Case Batch</strong> or upload a file
										in <strong className="text-[#dce8e9]">Inbound Sources</strong>.
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
											className="cursor-pointer transition-colors hover:bg-[#0e1720]"
										>
											<td className="px-4 py-3 font-mono">
												<div className="font-bold text-[#dce8e9]">{v.caseId}</div>
												<div className="text-[11px] text-[#7e9298]">{v.invoiceId}</div>
											</td>
											<td className="px-4 py-3 text-[#c5d4d6]">{v.wireId}</td>
											<td className="px-4 py-3 text-right font-mono tabular text-[#e7b56a]">
												{fmtClientMoney(v.numbers.fxSpreadLossMinor, ccy)} (
												{(v.numbers.fxSpreadBps / 100).toFixed(2)}%)
											</td>
											<td className="px-4 py-3 text-right font-mono tabular text-[#c5d4d6]">
												{fmtClientMoney(fees, ccy)} /{" "}
												<strong className="text-[#62e1c3]">
													{fmtClientMoney(v.numbers.recoverableFeeMinor, ccy)}
												</strong>
											</td>
											<td className="px-4 py-3 text-right font-mono tabular font-semibold text-[#dce8e9]">
												{fmtClientMoney(v.numbers.unexplainedVarianceMinor, ccy)}
											</td>
											<td className="px-4 py-3">
												<Badge variant={verdictBadgeVariant(v.status)}>
													{v.status.replace(/_/g, " ")}
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
