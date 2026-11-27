import type { AuditVerdict } from "../types"

function csvEscape(value: string | number | undefined | null): string {
	const raw = value === undefined || value === null ? "" : String(value)
	// Keep plain numbers (including negatives) numeric in spreadsheets; only
	// neutralize text that a spreadsheet could interpret as a formula.
	const isPlainNumber = /^[+-]?\d+(?:\.\d+)?$/.test(raw)
	const safe = !isPlainNumber && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
	if (/[",\r\n]/.test(safe)) {
		return `"${safe.replace(/"/g, '""')}"`
	}
	return safe
}

function formatMinorDecimal(minor: number, currency: string): string {
	const exp = currency === "JPY" ? 0 : currency === "KWD" || currency === "BHD" ? 3 : 2
	const divisor = Math.pow(10, exp)
	return (minor / divisor).toFixed(exp)
}

export function buildVerdictTxt(verdict: AuditVerdict): string {
	if (verdict.disputeNotice) return verdict.disputeNotice
	const ccy = verdict.numbers.settledCurrency || "USD"
	return [
		`CORRIDOR AUDIT REPORT - ${verdict.caseId}`,
		`====================================================================`,
		`Status:              ${verdict.status}`,
		`Invoice ID:          ${verdict.invoiceId}`,
		`Wire ID:             ${verdict.wireId}`,
		`Completed At:        ${verdict.completedAt}`,
		``,
		`FINANCIAL BREAKDOWN (${ccy})`,
		`--------------------------------------------------------------------`,
		`Invoiced Amount:     ${formatMinorDecimal(verdict.numbers.invoicedMinor, verdict.numbers.invoicedCurrency)} ${verdict.numbers.invoicedCurrency}`,
		`ECB Mid-Market Eq.:  ${formatMinorDecimal(verdict.numbers.midMarketEquivalentMinor, ccy)} ${ccy}`,
		`Net Settled:         ${formatMinorDecimal(verdict.numbers.settledMinor, ccy)} ${ccy}`,
		`FX Spread Loss:      ${formatMinorDecimal(verdict.numbers.fxSpreadLossMinor, ccy)} ${ccy} (${verdict.numbers.fxSpreadBps} bps)`,
		`Lifting/Repair Fees: ${formatMinorDecimal(verdict.numbers.liftingAndRepairFeesMinor, ccy)} ${ccy}`,
		`Platform Fee:        ${formatMinorDecimal(verdict.numbers.platformFeeMinor, ccy)} ${ccy}`,
		`Withholding Tax:     ${formatMinorDecimal(verdict.numbers.withholdingTaxMinor, ccy)} ${ccy}`,
		`Recoverable OUR Fee: ${formatMinorDecimal(verdict.numbers.recoverableFeeMinor, ccy)} ${ccy}`,
		`Unexplained Var.:    ${formatMinorDecimal(verdict.numbers.unexplainedVarianceMinor, ccy)} ${ccy}`,
		`Total Corridor Leak: ${formatMinorDecimal(verdict.replay.totalLeakMinor, ccy)} ${ccy} (${verdict.replay.totalLeakBps} bps)`,
		``,
		`SUMMARY`,
		`--------------------------------------------------------------------`,
		verdict.plainEnglishSummary,
		``,
		`PROVENANCE & DISCLAIMER`,
		`--------------------------------------------------------------------`,
		`Build: v${verdict.provenance.appVersion} | Source ${verdict.provenance.sourceRevision} | ${verdict.provenance.workingTree} tree | Audit rules v${verdict.provenance.auditRulesVersion}`,
		verdict.disclaimer,
	].join("\n")
}

export function buildVerdictsCsv(verdicts: AuditVerdict[]): string {
	const headers = [
		"case_id",
		"invoice_id",
		"wire_id",
		"status",
		"invoiced_currency",
		"invoiced_amount",
		"settled_currency",
		"ecb_mid_market_eq",
		"net_settled",
		"fx_spread_loss",
		"fx_spread_bps",
		"lifting_and_repair_fees",
		"platform_fee",
		"withholding_tax",
		"recoverable_our_fee",
		"unexplained_variance",
		"optimal_transparent_net",
		"total_leak",
		"total_leak_bps",
		"completed_at",
		"summary",
	]
	const rows = verdicts.map((v) => {
		const invCcy = v.numbers.invoicedCurrency || "USD"
		const ccy = v.numbers.settledCurrency || "USD"
		return [
			v.caseId,
			v.invoiceId,
			v.wireId,
			v.status,
			invCcy,
			formatMinorDecimal(v.numbers.invoicedMinor, invCcy),
			ccy,
			formatMinorDecimal(v.numbers.midMarketEquivalentMinor, ccy),
			formatMinorDecimal(v.numbers.settledMinor, ccy),
			formatMinorDecimal(v.numbers.fxSpreadLossMinor, ccy),
			v.numbers.fxSpreadBps,
			formatMinorDecimal(v.numbers.liftingAndRepairFeesMinor, ccy),
			formatMinorDecimal(v.numbers.platformFeeMinor, ccy),
			formatMinorDecimal(v.numbers.withholdingTaxMinor, ccy),
			formatMinorDecimal(v.numbers.recoverableFeeMinor, ccy),
			formatMinorDecimal(v.numbers.unexplainedVarianceMinor, ccy),
			formatMinorDecimal(v.replay.optimalTransparentNetMinor, ccy),
			formatMinorDecimal(v.replay.totalLeakMinor, ccy),
			v.replay.totalLeakBps,
			v.completedAt,
			v.plainEnglishSummary,
		]
			.map(csvEscape)
			.join(",")
	})
	return [headers.join(","), ...rows].join("\r\n")
}

function escapePdfString(text: string): string {
	return text
		.replace(/[^\x20-\x7E]/g, " ")
		.replace(/\\/g, "\\\\")
		.replace(/\(/g, "\\(")
		.replace(/\)/g, "\\)")
}

function wrapLines(text: string, maxChars = 84): string[] {
	const out: string[] = []
	for (const rawLine of text.split(/\r?\n/)) {
		if (rawLine.length <= maxChars) {
			out.push(rawLine)
			continue
		}
		let rest = rawLine
		while (rest.length > maxChars) {
			let splitAt = rest.lastIndexOf(" ", maxChars)
			if (splitAt <= 0) splitAt = maxChars
			out.push(rest.slice(0, splitAt))
			rest = rest.slice(splitAt).trimStart()
		}
		if (rest.length > 0) out.push(rest)
	}
	return out
}

/**
 * Generates a valid zero-dependency PDF 1.4 document with standard Courier font
 * so every browser's native PDF viewer and PDF text extractor can render and read it.
 */
export function buildVerdictPdf(verdict: AuditVerdict): Buffer {
	const txt = buildVerdictTxt(verdict)
	const refs = verdict.sourceRefs.slice(0, 8).map((r) => `- [${r.sourceType}:${r.recordId}:${r.field}] ${r.rawExcerpt}`)
	const fullText = [
		txt,
		"",
		"GROUNDED SOURCE CITATIONS",
		"--------------------------------------------------------------------",
		...(refs.length > 0 ? refs : ["No SourceRefs attached."]),
	].join("\n")

	const lines = wrapLines(fullText, 84)
	const linesPerPage = 52
	const pages: string[][] = []
	for (let i = 0; i < lines.length; i += linesPerPage) {
		pages.push(lines.slice(i, i + linesPerPage))
	}
	if (pages.length === 0) pages.push(["CorridorAudit Empty Report"])

	// Object numbering:
	// 1 = Catalog, 2 = Pages, 3 = Font (Courier)
	// For each page idx p: pageObj = 4 + p*2, contentObj = 5 + p*2
	const objects: string[] = []
	const pageObjectIds: number[] = []
	for (let p = 0; p < pages.length; p++) {
		pageObjectIds.push(4 + p * 2)
	}

	objects.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`)
	objects.push(`2 0 obj\n<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>\nendobj\n`)
	objects.push(`3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n`)

	for (let p = 0; p < pages.length; p++) {
		const pageId = 4 + p * 2
		const contentId = 5 + p * 2
		const streamLines = ["BT", "/F1 9.5 Tf", "42 752 Td", "13.2 TL"]
		for (const line of pages[p]) {
			streamLines.push(`(${escapePdfString(line)}) Tj T*`)
		}
		streamLines.push("ET")
		const streamBody = streamLines.join("\n")
		const streamBytes = Buffer.byteLength(streamBody, "latin1")

		objects.push(
			`${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`,
		)
		objects.push(
			`${contentId} 0 obj\n<< /Length ${streamBytes} >>\nstream\n${streamBody}\nendstream\nendobj\n`,
		)
	}

	const chunks: string[] = ["%PDF-1.4\n"]
	const offsets: number[] = [0]
	let cursor = Buffer.byteLength(chunks[0], "latin1")
	for (const obj of objects) {
		offsets.push(cursor)
		chunks.push(obj)
		cursor += Buffer.byteLength(obj, "latin1")
	}

	const xrefStart = cursor
	const xrefLines = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`]
	for (let i = 1; i < offsets.length; i++) {
		xrefLines.push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`)
	}
	const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
	return Buffer.from(chunks.join("") + xrefLines.join("") + trailer, "latin1")
}
