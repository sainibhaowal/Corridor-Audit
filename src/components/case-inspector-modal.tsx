"use client"

import { useEffect, useRef, useState } from "react"
import { Download, Eye, FileSpreadsheet, FileText, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { AccountingPaymentApplication, SettlementCase } from "@/core/types"
import { type CaseStreamEntry, fmtClientMoney } from "./corridor-types"
import { TraceWaterfall } from "./trace-waterfall"

type PreviewFormat = "pdf" | "csv" | "txt" | "json"

function parseCsvRows(csvText: string): string[][] {
	const rows: string[][] = []
	let currentRow: string[] = []
	let currentField = ""
	let inQuotes = false
	for (let i = 0; i < csvText.length; i++) {
		const ch = csvText[i]
		if (inQuotes) {
			if (ch === '"' && csvText[i + 1] === '"') {
				currentField += '"'
				i++
			} else if (ch === '"') {
				inQuotes = false
			} else {
				currentField += ch
			}
		} else if (ch === '"') {
			inQuotes = true
		} else if (ch === ",") {
			currentRow.push(currentField)
			currentField = ""
		} else if (ch === "\n") {
			currentRow.push(currentField.replace(/\r$/, ""))
			if (currentRow.some((c) => c.length > 0)) rows.push(currentRow)
			currentRow = []
			currentField = ""
		} else {
			currentField += ch
		}
	}
	if (currentField.length > 0 || currentRow.length > 0) {
		currentRow.push(currentField.replace(/\r$/, ""))
		rows.push(currentRow)
	}
	return rows
}

interface CaseInspectorModalProps {
	entry: CaseStreamEntry | null
	activeTab: "ledger" | "technical" | "letter" | "preview" | "trace"
	onTabChange: (tab: "ledger" | "technical" | "letter" | "preview" | "trace") => void
	onClose: () => void
}

export function CaseInspectorModal({
	entry,
	activeTab,
	onTabChange,
	onClose,
}: CaseInspectorModalProps) {
	const [previewFormat, setPreviewFormat] = useState<PreviewFormat>("pdf")
	const [previewText, setPreviewText] = useState<string>("")
	const [previewLoading, setPreviewLoading] = useState<boolean>(false)
	const [previewError, setPreviewError] = useState<string | null>(null)
	const caseId = entry?.verdict?.caseId

	useEffect(() => {
		if (activeTab !== "preview" || !caseId || previewFormat === "pdf") return
		let cancelled = false
		setPreviewLoading(true)
		setPreviewError(null)
		fetch(`/api/report/${encodeURIComponent(caseId)}?format=${previewFormat}&preview=1`)
			.then(async (res) => {
				if (!res.ok) throw new Error(`Failed to load ${previewFormat.toUpperCase()} preview (${res.status})`)
				return res.text()
			})
			.then((txt) => {
				if (!cancelled) setPreviewText(txt)
			})
			.catch((err) => {
				if (!cancelled) setPreviewError(err instanceof Error ? err.message : String(err))
			})
			.finally(() => {
				if (!cancelled) setPreviewLoading(false)
			})
		return () => {
			cancelled = true
		}
	}, [activeTab, caseId, previewFormat])

	const previewEffect = useRef(0)
	useEffect(() => {
		if (activeTab !== "preview" || !caseId) return
		const thisRun = ++previewEffect.current
		setPreviewLoading(previewFormat !== "pdf")
		setPreviewError(null)
		if (previewFormat === "pdf") {
			setPreviewText("")
			return
		}
		let cancelled = false
		fetch(`/api/report/${encodeURIComponent(caseId)}?format=${previewFormat}&preview=1`)
			.then(async (res) => {
				if (!res.ok) throw new Error(`Failed to load ${previewFormat.toUpperCase()} preview (${res.status})`)
				return res.text()
			})
			.then((txt) => {
				if (!cancelled && thisRun === previewEffect.current) setPreviewText(txt)
			})
			.catch((err) => {
				if (!cancelled && thisRun === previewEffect.current) setPreviewError(err instanceof Error ? err.message : String(err))
			})
			.finally(() => {
				if (!cancelled && thisRun === previewEffect.current) setPreviewLoading(false)
			})
		return () => {
			cancelled = true
		}
	}, [activeTab, caseId, previewFormat])

	if (!entry?.verdict) return null
	const v = entry.verdict
	const ccy = v.numbers.settledCurrency
	const tech = entry.technical as { fx?: { rateRecord?: { ecbRateDate?: string } } } | null
	const rawCase = (entry.technical as { rawCase?: SettlementCase } | null)?.rawCase
	const accountingPayments = rawCase?.accountingPayments ?? []
	const hasIndependentSettlementEvidence = v.status !== "EVIDENCE_INCOMPLETE"
	const ecbDate = tech?.fx?.rateRecord?.ecbRateDate || "reference"
	const feesTotal = v.numbers.liftingAndRepairFeesMinor + v.numbers.platformFeeMinor

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-[#121c24]/40 p-4 backdrop-blur-[1px]"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose()
			}}
		>
			<div
				role="dialog"
				aria-modal="true"
				className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-[#32454d] bg-[#0d141b] shadow-2xl"
			>
				<div className="flex items-center justify-between gap-3 border-b border-[#1c2a33] px-5 py-3.5">
					<div className="flex flex-wrap items-center gap-2.5">
						<h2 className="text-base font-extrabold tracking-tight text-[#e3edef]">
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

				<div className="flex flex-wrap gap-1.5 border-b border-[#1c2a33] bg-[#080d12] px-5 pt-2.5">
					{[
						{ id: "ledger" as const, label: "Summary & Cent Ledger" },
						{ id: "trace" as const, label: "Trace Waterfall (Gantt)" },
						{ id: "preview" as const, label: "In-Built File Preview (.pdf / .csv / .txt / .json)" },
						{ id: "technical" as const, label: "All Technical Fields (JSON)" },
						{ id: "letter" as const, label: "Review Request Draft (.txt)" },
					].map((tab) => (
						<button
							key={tab.id}
							type="button"
							onClick={() => onTabChange(tab.id)}
							className={cn(
								"rounded-t-md border border-b-0 px-3.5 py-2 text-xs font-semibold transition-colors",
								activeTab === tab.id
									? "border-[#1c2a33] bg-[#0d141b] text-[#e3edef]"
									: "border-transparent text-[#81949a] hover:text-[#e3edef]",
							)}
						>
							{tab.label}
						</button>
					))}
				</div>

				<div className="overflow-y-auto p-5">
					{activeTab === "ledger" && (
						<div className="space-y-4">
							<div className="rounded-lg border border-[#1c2a33] border-l-4 border-l-emerald-600 bg-[#080d12] p-3.5">
								<div className="mb-1 text-[11px] font-bold tracking-wider text-[#75e4c7] uppercase">
									Plain-English Verdict
								</div>
								<p className="text-sm text-[#c7d3d6]">{v.plainEnglishSummary}</p>
							</div>
							{accountingPayments.length > 0 && (
								<Card className="space-y-2.5 p-4">
									<div className="text-[11px] font-bold uppercase tracking-wider text-[#81949a]">
										Accounting Payment Applications
									</div>
									<p className="text-xs text-amber-300">
										These provider ledger entries do not independently confirm bank settlement or bank fees.
									</p>
									<div className="overflow-x-auto">
										<table className="w-full border-collapse text-xs">
											<thead>
												<tr className="border-b border-[#1c2a33] text-left text-[11px] uppercase tracking-wider text-[#81949a]">
													<th className="py-2 pr-3">Provider / Payment</th>
													<th className="py-2 pr-3">Date</th>
													<th className="py-2 pr-3 text-right">Applied amount</th>
													<th className="py-2">Mapping</th>
												</tr>
											</thead>
											<tbody className="divide-y divide-[#1c2a33]">
												{accountingPayments.map((application: AccountingPaymentApplication) => (
													<tr key={application.applicationId}>
														<td className="py-2 pr-3 font-mono">{application.provider} / {application.paymentId}</td>
														<td className="py-2 pr-3">{application.date || "Not supplied"}</td>
														<td className="py-2 pr-3 text-right font-mono">
															{application.amount ? fmtClientMoney(application.amount.amountMinor, application.amount.currency) : "Not allocated"}
														</td>
														<td className="py-2 text-[#a4b4b8]">{application.mappingIssue || application.status || "Mapped"}{application.reconciled === undefined ? "" : application.reconciled ? " · reconciled in provider" : " · unreconciled in provider"}</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								</Card>
							)}

							<Card className="overflow-hidden">
								<div className="overflow-x-auto">
									<table className="w-full border-collapse text-xs">
										<thead>
											<tr className="border-b border-[#1c2a33] bg-[#080d12] text-[11px] font-bold uppercase tracking-wider text-[#81949a]">
												<th className="px-4 py-2.5 text-left">Reconciliation Line Item</th>
												<th className="px-4 py-2.5 text-right">Amount</th>
											<th className="px-4 py-2.5 text-left">Source Reference</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-[#1c2a33]">
											<tr>
												<td className="px-4 py-2.5 text-[#c7d3d6]">
													Invoice Expected ({v.numbers.invoicedCurrency})
												</td>
												<td className="px-4 py-2.5 text-right font-mono tabular">
													{fmtClientMoney(v.numbers.invoicedMinor, v.numbers.invoicedCurrency)}
												</td>
												<td className="px-4 py-2.5 font-mono text-[#81949a]">[INV:{v.invoiceId}]</td>
											</tr>
											<tr>
												<td className="px-4 py-2.5 text-[#c7d3d6]">ECB Mid-Market Equivalent</td>
												<td className="px-4 py-2.5 text-right font-mono tabular">
													{fmtClientMoney(v.numbers.midMarketEquivalentMinor, ccy)}
												</td>
												<td className="px-4 py-2.5 font-mono text-[#81949a]">[ECB:{ecbDate}]</td>
											</tr>
											<tr>
												<td className="px-4 py-2.5 text-[#c7d3d6]">
													Bank / Platform Hidden FX Spread ({(v.numbers.fxSpreadBps / 100).toFixed(2)}%)
												</td>
												<td className="px-4 py-2.5 text-right font-mono tabular text-amber-700">
													{v.numbers.fxSpreadLossMinor < 0
														? `+${fmtClientMoney(-v.numbers.fxSpreadLossMinor, ccy)}`
														: fmtClientMoney(-v.numbers.fxSpreadLossMinor, ccy)}
												</td>
												<td className="px-4 py-2.5 font-mono text-[#81949a]">
													[FX_SPREAD:{v.numbers.fxSpreadBps}bps]
												</td>
											</tr>
											<tr>
												<td className="px-4 py-2.5 text-[#c7d3d6]">Lifting / Repair / Platform Fees</td>
												<td className="px-4 py-2.5 text-right font-mono tabular text-red-600">
													{fmtClientMoney(-feesTotal, ccy)}
												</td>
												<td className="px-4 py-2.5 font-mono text-[#81949a]">[WIRE:{v.wireId}]</td>
											</tr>
											{v.numbers.withholdingTaxMinor !== 0 && (
												<tr>
													<td className="px-4 py-2.5 text-[#c7d3d6]">Withholding Tax ({ccy})</td>
													<td className="px-4 py-2.5 text-right font-mono tabular text-[#c7d3d6]">
														{fmtClientMoney(-v.numbers.withholdingTaxMinor, ccy)}
													</td>
													<td className="px-4 py-2.5 font-mono text-[#81949a]">[TAX:{v.invoiceId}]</td>
												</tr>
											)}
											<tr className="bg-[#0d2725]/40">
												<td className="px-4 py-2.5 font-semibold text-[#e3edef]">
													{hasIndependentSettlementEvidence ? "Recorded Settlement Amount" : "Independent Settlement Evidence"}
												</td>
												<td className="px-4 py-2.5 text-right font-mono font-bold tabular text-[#75e4c7]">
													{hasIndependentSettlementEvidence ? fmtClientMoney(v.numbers.settledMinor, ccy) : "Not evidenced"}
												</td>
												<td className="px-4 py-2.5 font-mono text-[#81949a]">
													{hasIndependentSettlementEvidence ? "[:32A:/SETTLED]" : "A bank statement or settlement record is required"}
												</td>
											</tr>
											<tr className="bg-[#080d12] font-bold">
												<td className="px-4 py-2.5 text-[#e3edef]">Unexplained Variance</td>
												<td className="px-4 py-2.5 text-right font-mono tabular text-[#e3edef]">
													{fmtClientMoney(v.numbers.unexplainedVarianceMinor, ccy)}
												</td>
												<td className="px-4 py-2.5 font-mono text-[#a4b4b8]">
													{v.sourceRefs.length} SourceRefs
												</td>
											</tr>
										</tbody>
									</table>
								</div>
							</Card>

							<div className="grid gap-4 md:grid-cols-2">
								<Card className="p-4">
									<div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#81949a]">
										Raw Source Proof Excerpts
									</div>
									<pre className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-[#1c2a33] bg-[#080d12] p-3 font-mono text-[11px] text-[#c7d3d6]">
										{v.sourceRefs
											.map((r) => `[${r.sourceType}:${r.recordId}:${r.field}] ${r.rawExcerpt}`)
											.join("\n")}
									</pre>
								</Card>

								<Card className="flex flex-col justify-between p-4">
									<div>
										<div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#81949a]">
											Calculated Reference Comparison &amp; Exports
										</div>
										<p className="mb-3 text-xs text-[#c7d3d6]">
											Submitted settlement:{" "}
											<strong className="font-mono text-[#e3edef]">
												{fmtClientMoney(v.replay.actualNetMinor, ccy)}
											</strong>{" "}
											vs. Calculated ECB mid-market reference:{" "}
											<strong className="font-mono text-[#75e4c7]">
												{fmtClientMoney(v.replay.optimalTransparentNetMinor, ccy)}
											</strong>
										</p>
										<Badge variant="ok" className="mb-4 font-mono">
											Estimated difference: {fmtClientMoney(v.replay.totalLeakMinor, ccy)} (
											{(v.replay.totalLeakBps / 100).toFixed(2)}%)
										</Badge>
									</div>

									<div className="flex flex-wrap gap-2">
										<Button
											variant="outline"
											size="sm"
											onClick={() => onTabChange("preview")}
										>
											<Eye className="h-3.5 w-3.5" />
											Preview Files
										</Button>
										<a
											href={`/api/report/${encodeURIComponent(v.caseId)}?format=pdf`}
											download
											className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#2c4a43] bg-[#0e2620] px-3 text-xs font-semibold text-[#62e1c3] hover:bg-[#14352d]"
										>
											<Download className="h-3.5 w-3.5" />
											Report (.pdf)
										</a>
										<a
											href={`/api/report/${encodeURIComponent(v.caseId)}?format=csv`}
											download
											className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#32454d] bg-[#0d141b] px-3 text-xs font-semibold text-[#c7d3d6] hover:bg-[#080d12]"
										>
											<FileSpreadsheet className="h-3.5 w-3.5" />
											Sheet (.csv)
										</a>
										<a
											href={`/api/report/${encodeURIComponent(v.caseId)}?format=txt`}
											download
											className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#121c24] px-3 text-xs font-semibold text-white hover:bg-[#17232b]"
										>
											<Download className="h-3.5 w-3.5" />
											Draft (.txt)
										</a>
										<a
											href={`/api/report/${encodeURIComponent(v.caseId)}?format=json`}
											download
											className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#32454d] bg-[#0d141b] px-3 text-xs font-semibold text-[#c7d3d6] hover:bg-[#080d12]"
										>
											<FileText className="h-3.5 w-3.5" />
											Full (.json)
										</a>
									</div>
								</Card>
							</div>
						</div>
					)}

					{activeTab === "trace" && (
						<TraceWaterfall entry={entry} />
					)}

					{activeTab === "preview" && (
						<div className="space-y-3">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<div className="flex flex-wrap gap-1.5">
									{(
										[
											{ id: "pdf", label: "PDF Report (.pdf)" },
											{ id: "csv", label: "Spreadsheet (.csv)" },
											{ id: "txt", label: "Text Draft (.txt)" },
											{ id: "json", label: "JSON Payload (.json)" },
										] as const
									).map((fmt) => (
										<button
											key={fmt.id}
											type="button"
											onClick={() => setPreviewFormat(fmt.id)}
											className={cn(
												"rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors",
												previewFormat === fmt.id
													? "border-[#2c4a43] bg-[#0e2620] text-[#62e1c3]"
													: "border-[#1c2a33] bg-[#080d12] text-[#81949a] hover:text-[#e3edef]",
											)}
										>
											{fmt.label}
										</button>
									))}
								</div>
								<a
									href={`/api/report/${encodeURIComponent(v.caseId)}?format=${previewFormat}`}
									download
									className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#2c4a43] bg-[#0e2620] px-3 text-xs font-semibold text-[#62e1c3] hover:bg-[#14352d]"
								>
									<Download className="h-3.5 w-3.5" />
									Download .{previewFormat}
								</a>
							</div>

							{previewFormat === "pdf" ? (
								<div className="overflow-hidden rounded-lg border border-[#1c2a33] bg-[#080d12]">
									<iframe
										title={`${v.caseId} PDF Preview`}
										src={`/api/report/${encodeURIComponent(v.caseId)}?format=pdf&preview=1`}
										className="h-[62vh] w-full bg-white"
									/>
								</div>
							) : previewLoading ? (
								<div className="rounded-lg border border-[#1c2a33] bg-[#080d12] p-6 text-xs text-[#81949a]">
									Loading .{previewFormat} preview...
								</div>
							) : previewError ? (
								<div className="rounded-lg border border-red-900/60 bg-red-950/30 p-4 text-xs text-red-300">
									{previewError}
								</div>
							) : previewFormat === "csv" ? (
								(() => {
									const rows = parseCsvRows(previewText)
									const headers = rows[0] ?? []
									const bodyRows = rows.slice(1)
									return (
										<div className="space-y-2">
											<div className="max-h-[42vh] overflow-auto rounded-lg border border-[#1c2a33] bg-[#080d12]">
												<table className="w-full border-collapse text-[11px]">
													<thead>
														<tr className="border-b border-[#1c2a33] bg-[#0d141b] text-left font-bold text-[#62e1c3]">
															{headers.map((h, i) => (
																<th key={i} className="whitespace-nowrap px-3 py-2 font-mono">
																	{h}
																</th>
															))}
														</tr>
													</thead>
													<tbody className="divide-y divide-[#1c2a33]">
														{bodyRows.map((row, rIdx) => (
															<tr key={rIdx} className="text-[#c7d3d6]">
																{row.map((cell, cIdx) => (
																	<td key={cIdx} className="whitespace-nowrap px-3 py-2 font-mono">
																		{cell}
																	</td>
																))}
															</tr>
														))}
													</tbody>
												</table>
											</div>
											<pre className="max-h-[18vh] overflow-auto whitespace-pre rounded-lg border border-[#1c2a33] bg-[#080d12] p-3 font-mono text-[11px] text-[#81949a]">
												{previewText}
											</pre>
										</div>
									)
								})()
							) : (
								<pre className="max-h-[62vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[#1c2a33] bg-[#080d12] p-4 font-mono text-xs text-[#c7d3d6]">
									{previewText}
								</pre>
							)}
						</div>
					)}

					{activeTab === "technical" && (
						<pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[#1c2a33] bg-[#080d12] p-4 font-mono text-[11.5px] text-[#c7d3d6]">
							{JSON.stringify(entry.technical || v, null, 2)}
						</pre>
					)}

					{activeTab === "letter" && (
						<div className="space-y-3">
							<pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[#1c2a33] bg-[#080d12] p-4 font-mono text-xs text-[#c7d3d6]">
								{v.disputeNotice ||
									"No potential OUR fee discrepancy was calculated from the supplied values. This is not an independent bank confirmation or audit certificate."}
							</pre>
							<a
								href={`/api/report/${encodeURIComponent(v.caseId)}?format=txt`}
								download
								className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#121c24] px-3 text-xs font-semibold text-white hover:bg-[#17232b]"
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
