"use client"

import { Download, FileText, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { type CaseStreamEntry, fmtClientMoney } from "./corridor-types"

interface CaseInspectorModalProps {
	entry: CaseStreamEntry | null
	activeTab: "ledger" | "technical" | "letter"
	onTabChange: (tab: "ledger" | "technical" | "letter") => void
	onClose: () => void
}

export function CaseInspectorModal({
	entry,
	activeTab,
	onTabChange,
	onClose,
}: CaseInspectorModalProps) {
	if (!entry?.verdict) return null
	const v = entry.verdict
	const ccy = v.numbers.settledCurrency
	const tech = entry.technical as { fx?: { rateRecord?: { ecbRateDate?: string } } } | null
	const ecbDate = tech?.fx?.rateRecord?.ecbRateDate || "reference"
	const feesTotal = v.numbers.liftingAndRepairFeesMinor + v.numbers.platformFeeMinor

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-[#03060a]/80 p-4 backdrop-blur-sm"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose()
			}}
		>
			<div
				role="dialog"
				aria-modal="true"
				className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded border border-[#29434c] bg-[#090e14] text-[#dce8e9] shadow-2xl"
			>
				<div className="flex items-center justify-between gap-3 border-b border-[#1b2a34] px-5 py-3.5">
					<div className="flex flex-wrap items-center gap-2.5">
						<h2 className="text-sm font-bold tracking-tight text-[#dce8e9]">
							{v.caseId} · Audit Artifact &amp; Full Technical Inspector
						</h2>
						<Badge variant={v.numbers.unexplainedVarianceMinor === 0 ? "ok" : "bad"}>
							Variance: {fmtClientMoney(v.numbers.unexplainedVarianceMinor, ccy)}
						</Badge>
					</div>
					<Button variant="outline" size="sm" onClick={onClose}>
						<X className="h-3.5 w-3.5" />
						Esc
					</Button>
				</div>

				<div className="flex gap-1.5 border-b border-[#1b2a34] bg-[#070b10] px-5 pt-2.5">
					{[
						{ id: "ledger" as const, label: "Summary & Cent Ledger" },
						{ id: "technical" as const, label: "All Technical Fields (JSON)" },
						{ id: "letter" as const, label: "Dispute Letter (.txt)" },
					].map((tab) => (
						<button
							key={tab.id}
							type="button"
							onClick={() => onTabChange(tab.id)}
							className={cn(
								"border-b-2 px-3.5 py-2 font-mono text-[11px] uppercase tracking-wider transition-colors",
								activeTab === tab.id
									? "border-[#62e1c3] text-[#dce8e9]"
									: "border-transparent text-[#50646b] hover:text-[#dce8e9]",
							)}
						>
							{tab.label}
						</button>
					))}
				</div>

				<div className="overflow-y-auto p-5">
					{activeTab === "ledger" && (
						<div className="space-y-4">
							<div className="rounded border border-[#1b2a34] border-l-2 border-l-[#62e1c3] bg-[#0b1118] p-3.5">
								<div className="mb-1 font-mono text-[10px] font-bold tracking-widest text-[#62e1c3] uppercase">
									Plain-English Verdict
								</div>
								<p className="text-xs leading-relaxed text-[#dce8e9]">{v.plainEnglishSummary}</p>
							</div>

							<Card className="overflow-hidden">
								<div className="overflow-x-auto">
									<table className="w-full border-collapse text-xs">
										<thead>
											<tr className="border-b border-[#1b2a34] bg-[#090e14] font-mono text-[10px] uppercase tracking-wider text-[#7e9298]">
												<th className="px-4 py-2.5 text-left">Reconciliation Line Item</th>
												<th className="px-4 py-2.5 text-right">Amount</th>
												<th className="px-4 py-2.5 text-left">Verified SourceRef</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-[#1b2a34]/70">
											<tr>
												<td className="px-4 py-2.5 text-[#c5d4d6]">
													Invoice Expected ({v.numbers.invoicedCurrency})
												</td>
												<td className="px-4 py-2.5 text-right font-mono tabular">
													{fmtClientMoney(v.numbers.invoicedMinor, v.numbers.invoicedCurrency)}
												</td>
												<td className="px-4 py-2.5 font-mono text-[#7e9298]">[INV:{v.invoiceId}]</td>
											</tr>
											<tr>
												<td className="px-4 py-2.5 text-[#c5d4d6]">ECB Mid-Market Equivalent</td>
												<td className="px-4 py-2.5 text-right font-mono tabular">
													{fmtClientMoney(v.numbers.midMarketEquivalentMinor, ccy)}
												</td>
												<td className="px-4 py-2.5 font-mono text-[#7e9298]">[ECB:{ecbDate}]</td>
											</tr>
											<tr>
												<td className="px-4 py-2.5 text-[#c5d4d6]">
													Bank / Platform Hidden FX Spread ({(v.numbers.fxSpreadBps / 100).toFixed(2)}%)
												</td>
												<td className="px-4 py-2.5 text-right font-mono tabular text-[#e7b56a]">
													{v.numbers.fxSpreadLossMinor < 0
														? `+${fmtClientMoney(-v.numbers.fxSpreadLossMinor, ccy)}`
														: fmtClientMoney(-v.numbers.fxSpreadLossMinor, ccy)}
												</td>
												<td className="px-4 py-2.5 font-mono text-[#7e9298]">
													[FX_SPREAD:{v.numbers.fxSpreadBps}bps]
												</td>
											</tr>
											<tr>
												<td className="px-4 py-2.5 text-[#c5d4d6]">Lifting / Repair / Platform Fees</td>
												<td className="px-4 py-2.5 text-right font-mono tabular text-[#f17678]">
													{fmtClientMoney(-feesTotal, ccy)}
												</td>
												<td className="px-4 py-2.5 font-mono text-[#7e9298]">[WIRE:{v.wireId}]</td>
											</tr>
											{v.numbers.withholdingTaxMinor !== 0 && (
												<tr>
													<td className="px-4 py-2.5 text-[#c5d4d6]">Withholding Tax ({ccy})</td>
													<td className="px-4 py-2.5 text-right font-mono tabular text-[#c5d4d6]">
														{fmtClientMoney(-v.numbers.withholdingTaxMinor, ccy)}
													</td>
													<td className="px-4 py-2.5 font-mono text-[#7e9298]">[TAX:{v.invoiceId}]</td>
												</tr>
											)}
											<tr className="bg-[#62e1c3]/5">
												<td className="px-4 py-2.5 font-semibold text-[#dce8e9]">Net Cash Landed</td>
												<td className="px-4 py-2.5 text-right font-mono font-bold tabular text-[#62e1c3]">
													{fmtClientMoney(v.numbers.settledMinor, ccy)}
												</td>
												<td className="px-4 py-2.5 font-mono text-[#7e9298]">[:32A:/SETTLED]</td>
											</tr>
											<tr className="bg-[#090e14] font-bold">
												<td className="px-4 py-2.5 text-[#dce8e9]">Unexplained Variance</td>
												<td className="px-4 py-2.5 text-right font-mono tabular text-[#dce8e9]">
													{fmtClientMoney(v.numbers.unexplainedVarianceMinor, ccy)}
												</td>
												<td className="px-4 py-2.5 font-mono text-[#7e9298]">
													{v.sourceRefs.length} SourceRefs
												</td>
											</tr>
										</tbody>
									</table>
								</div>
							</Card>

							<div className="grid gap-4 md:grid-cols-2">
								<Card className="p-4">
									<div className="mb-2 font-mono text-[10px] font-bold uppercase tracking-wider text-[#7e9298]">
										Raw Source Proof Excerpts
									</div>
									<pre className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded border border-[#1b2a34] bg-[#070b10] p-3 font-mono text-[11px] text-[#c5d4d6]">
										{v.sourceRefs
											.map((r) => `[${r.sourceType}:${r.recordId}:${r.field}] ${r.rawExcerpt}`)
											.join("\n")}
									</pre>
								</Card>

								<Card className="flex flex-col justify-between p-4">
									<div>
										<div className="mb-2 font-mono text-[10px] font-bold uppercase tracking-wider text-[#7e9298]">
											Corridor Leak Replay &amp; Exports
										</div>
										<p className="mb-3 text-xs text-[#c5d4d6]">
											Actual landed:{" "}
											<strong className="font-mono text-[#dce8e9]">
												{fmtClientMoney(v.replay.actualNetMinor, ccy)}
											</strong>{" "}
											vs. Transparent ECB route:{" "}
											<strong className="font-mono text-[#62e1c3]">
												{fmtClientMoney(v.replay.optimalTransparentNetMinor, ccy)}
											</strong>
										</p>
										<Badge variant="ok" className="mb-4">
											Preventable + Recoverable Leak: {fmtClientMoney(v.replay.totalLeakMinor, ccy)} (
											{(v.replay.totalLeakBps / 100).toFixed(2)}%)
										</Badge>
									</div>

									<div className="flex flex-wrap gap-2">
										<a
											href={`/api/report/${encodeURIComponent(v.caseId)}?format=txt`}
											download
											className="inline-flex h-8 items-center gap-1.5 rounded border border-[#62e1c3] bg-[#62e1c3] px-3 text-xs font-semibold text-[#070b10] hover:bg-[#7ae8ce]"
										>
											<Download className="h-3.5 w-3.5" />
											Dispute Letter (.txt)
										</a>
										<a
											href={`/api/report/${encodeURIComponent(v.caseId)}?format=json`}
											download
											className="inline-flex h-8 items-center gap-1.5 rounded border border-[#29434c] bg-[#0e1720] px-3 text-xs font-semibold text-[#dce8e9] hover:border-[#62e1c3]/60"
										>
											<FileText className="h-3.5 w-3.5" />
											Full Audit (.json)
										</a>
									</div>
								</Card>
							</div>
						</div>
					)}

					{activeTab === "technical" && (
						<pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap break-words rounded border border-[#1b2a34] bg-[#070b10] p-4 font-mono text-[11.5px] text-[#c5d4d6]">
							{JSON.stringify(entry.technical || v, null, 2)}
						</pre>
					)}

					{activeTab === "letter" && (
						<div className="space-y-3">
							<pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded border border-[#1b2a34] bg-[#070b10] p-4 font-mono text-xs text-[#dce8e9]">
								{v.disputeNotice ||
									"No recoverable OUR fee breach on this case — clean audit certificate available in JSON export."}
							</pre>
							<a
								href={`/api/report/${encodeURIComponent(v.caseId)}?format=txt`}
								download
								className="inline-flex h-8 items-center gap-1.5 rounded border border-[#62e1c3] bg-[#62e1c3] px-3 text-xs font-semibold text-[#070b10] hover:bg-[#7ae8ce]"
							>
								<Download className="h-3.5 w-3.5" />
								Download .txt
							</a>
						</div>
					)}
				</div>
			</div>
		</div>
	)
}
