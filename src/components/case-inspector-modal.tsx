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
			className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[1px]"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose()
			}}
		>
			<div
				role="dialog"
				aria-modal="true"
				className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl"
			>
				<div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
					<div className="flex flex-wrap items-center gap-2.5">
						<h2 className="text-base font-extrabold tracking-tight text-slate-900">
							{v.caseId} · Audit Artifact &amp; Full Technical Inspector
						</h2>
						<Badge variant={v.numbers.unexplainedVarianceMinor === 0 ? "ok" : "bad"} className="font-mono">
							Variance: {fmtClientMoney(v.numbers.unexplainedVarianceMinor, ccy)}
						</Badge>
					</div>
					<Button variant="outline" size="sm" onClick={onClose}>
						<X className="h-3.5 w-3.5" />
						Esc
					</Button>
				</div>

				<div className="flex gap-1.5 border-b border-slate-200 bg-slate-50 px-5 pt-2.5">
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
								"rounded-t-md border border-b-0 px-3.5 py-2 text-xs font-semibold transition-colors",
								activeTab === tab.id
									? "border-slate-200 bg-white text-slate-900"
									: "border-transparent text-slate-500 hover:text-slate-900",
							)}
						>
							{tab.label}
						</button>
					))}
				</div>

				<div className="overflow-y-auto p-5">
					{activeTab === "ledger" && (
						<div className="space-y-4">
							<div className="rounded-lg border border-slate-200 border-l-4 border-l-emerald-600 bg-slate-50 p-3.5">
								<div className="mb-1 text-[11px] font-bold tracking-wider text-emerald-700 uppercase">
									Plain-English Verdict
								</div>
								<p className="text-sm text-slate-800">{v.plainEnglishSummary}</p>
							</div>

							<Card className="overflow-hidden">
								<div className="overflow-x-auto">
									<table className="w-full border-collapse text-xs">
										<thead>
											<tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
												<th className="px-4 py-2.5 text-left">Reconciliation Line Item</th>
												<th className="px-4 py-2.5 text-right">Amount</th>
												<th className="px-4 py-2.5 text-left">Verified SourceRef</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-slate-100">
											<tr>
												<td className="px-4 py-2.5 text-slate-700">
													Invoice Expected ({v.numbers.invoicedCurrency})
												</td>
												<td className="px-4 py-2.5 text-right font-mono tabular">
													{fmtClientMoney(v.numbers.invoicedMinor, v.numbers.invoicedCurrency)}
												</td>
												<td className="px-4 py-2.5 font-mono text-slate-500">[INV:{v.invoiceId}]</td>
											</tr>
											<tr>
												<td className="px-4 py-2.5 text-slate-700">ECB Mid-Market Equivalent</td>
												<td className="px-4 py-2.5 text-right font-mono tabular">
													{fmtClientMoney(v.numbers.midMarketEquivalentMinor, ccy)}
												</td>
												<td className="px-4 py-2.5 font-mono text-slate-500">[ECB:{ecbDate}]</td>
											</tr>
											<tr>
												<td className="px-4 py-2.5 text-slate-700">
													Bank / Platform Hidden FX Spread ({(v.numbers.fxSpreadBps / 100).toFixed(2)}%)
												</td>
												<td className="px-4 py-2.5 text-right font-mono tabular text-amber-700">
													{v.numbers.fxSpreadLossMinor < 0
														? `+${fmtClientMoney(-v.numbers.fxSpreadLossMinor, ccy)}`
														: fmtClientMoney(-v.numbers.fxSpreadLossMinor, ccy)}
												</td>
												<td className="px-4 py-2.5 font-mono text-slate-500">
													[FX_SPREAD:{v.numbers.fxSpreadBps}bps]
												</td>
											</tr>
											<tr>
												<td className="px-4 py-2.5 text-slate-700">Lifting / Repair / Platform Fees</td>
												<td className="px-4 py-2.5 text-right font-mono tabular text-red-600">
													{fmtClientMoney(-feesTotal, ccy)}
												</td>
												<td className="px-4 py-2.5 font-mono text-slate-500">[WIRE:{v.wireId}]</td>
											</tr>
											{v.numbers.withholdingTaxMinor !== 0 && (
												<tr>
													<td className="px-4 py-2.5 text-slate-700">Withholding Tax ({ccy})</td>
													<td className="px-4 py-2.5 text-right font-mono tabular text-slate-700">
														{fmtClientMoney(-v.numbers.withholdingTaxMinor, ccy)}
													</td>
													<td className="px-4 py-2.5 font-mono text-slate-500">[TAX:{v.invoiceId}]</td>
												</tr>
											)}
											<tr className="bg-emerald-50/40">
												<td className="px-4 py-2.5 font-semibold text-slate-900">Net Cash Landed</td>
												<td className="px-4 py-2.5 text-right font-mono font-bold tabular text-emerald-700">
													{fmtClientMoney(v.numbers.settledMinor, ccy)}
												</td>
												<td className="px-4 py-2.5 font-mono text-slate-500">[:32A:/SETTLED]</td>
											</tr>
											<tr className="bg-slate-50 font-bold">
												<td className="px-4 py-2.5 text-slate-900">Unexplained Variance</td>
												<td className="px-4 py-2.5 text-right font-mono tabular text-slate-900">
													{fmtClientMoney(v.numbers.unexplainedVarianceMinor, ccy)}
												</td>
												<td className="px-4 py-2.5 font-mono text-slate-600">
													{v.sourceRefs.length} SourceRefs
												</td>
											</tr>
										</tbody>
									</table>
								</div>
							</Card>

							<div className="grid gap-4 md:grid-cols-2">
								<Card className="p-4">
									<div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
										Raw Source Proof Excerpts
									</div>
									<pre className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] text-slate-700">
										{v.sourceRefs
											.map((r) => `[${r.sourceType}:${r.recordId}:${r.field}] ${r.rawExcerpt}`)
											.join("\n")}
									</pre>
								</Card>

								<Card className="flex flex-col justify-between p-4">
									<div>
										<div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
											Corridor Leak Replay &amp; Exports
										</div>
										<p className="mb-3 text-xs text-slate-700">
											Actual landed:{" "}
											<strong className="font-mono text-slate-900">
												{fmtClientMoney(v.replay.actualNetMinor, ccy)}
											</strong>{" "}
											vs. Transparent ECB route:{" "}
											<strong className="font-mono text-emerald-700">
												{fmtClientMoney(v.replay.optimalTransparentNetMinor, ccy)}
											</strong>
										</p>
										<Badge variant="ok" className="mb-4 font-mono">
											Preventable + Recoverable Leak: {fmtClientMoney(v.replay.totalLeakMinor, ccy)} (
											{(v.replay.totalLeakBps / 100).toFixed(2)}%)
										</Badge>
									</div>

									<div className="flex flex-wrap gap-2">
										<a
											href={`/api/report/${encodeURIComponent(v.caseId)}?format=txt`}
											download
											className="inline-flex h-8 items-center gap-1.5 rounded-md bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800"
										>
											<Download className="h-3.5 w-3.5" />
											Dispute Letter (.txt)
										</a>
										<a
											href={`/api/report/${encodeURIComponent(v.caseId)}?format=json`}
											download
											className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
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
						<pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-[11.5px] text-slate-800">
							{JSON.stringify(entry.technical || v, null, 2)}
						</pre>
					)}

					{activeTab === "letter" && (
						<div className="space-y-3">
							<pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-xs text-slate-800">
								{v.disputeNotice ||
									"No recoverable OUR fee breach on this case — clean audit certificate available in JSON export."}
							</pre>
							<a
								href={`/api/report/${encodeURIComponent(v.caseId)}?format=txt`}
								download
								className="inline-flex h-8 items-center gap-1.5 rounded-md bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800"
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
