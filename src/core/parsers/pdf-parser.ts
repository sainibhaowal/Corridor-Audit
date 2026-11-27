import { inflateSync } from "node:zlib"
import { parseDecimalStringToMinor } from "../money"
import type { ChargeBearerClause, InvoiceInput, SourceRef } from "../types"

function decodePdfLiteralStrings(chunk: string): string[] {
	const results: string[] = []
	const matches = chunk.match(/\((?:\\.|[^\\()])*\)\s*Tj|\[[^\]]*\]\s*TJ/g) ?? []
	for (const m of matches) {
		const innerMatches = m.match(/\((?:\\.|[^\\()])*\)/g) ?? []
		const joined = innerMatches
			.map((lit) =>
				lit
					.slice(1, -1)
					.replace(/\\n/g, "\n")
					.replace(/\\r/g, "")
					.replace(/\\\(/g, "(")
					.replace(/\\\)/g, ")")
					.replace(/\\\\/g, "\\"),
			)
			.join("")
		if (joined.trim()) results.push(joined.trim())
	}
	return results
}

/**
 * Extracts plain text from text-based PDFs (supports both uncompressed and FlateDecode streams)
 * without external binary/native dependencies.
 */
export function extractTextFromPdfBuffer(buffer: Buffer): string {
	const latin1 = buffer.toString("latin1")
	const collected: string[] = []

	// 1. Try inflating FlateDecode streams
	const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g
	let match: RegExpExecArray | null
	while ((match = streamRegex.exec(latin1)) !== null) {
		const rawStream = Buffer.from(match[1], "latin1")
		try {
			const inflated = inflateSync(rawStream).toString("latin1")
			collected.push(...decodePdfLiteralStrings(inflated))
		} catch {
			// Also scan uncompressed streams directly
			collected.push(...decodePdfLiteralStrings(match[1]))
		}
	}

	if (collected.length > 0) {
		return collected.join("\n")
	}

	// 2. Fallback: extract printable ASCII lines for lightweight text/pseudo-PDF inputs
	return buffer
		.toString("utf8")
		.replace(/[^\x20-\x7E\r\n]/g, " ")
		.replace(/[ \t]{2,}/g, " ")
		.trim()
}

/**
 * Extracts structured invoice/wire clues from free-form text or extracted PDF text.
 */
export function parseInvoiceFromExtractedText(rawText: string, sourceId = "PDF-UPLOAD-1"): InvoiceInput {
	const invMatch = rawText.match(/(INV[-\s]?[A-Z0-9-]{3,})/i)
	const invoiceId = invMatch ? invMatch[1].replace(/\s+/g, "-").toUpperCase() : sourceId
	const amountMatch = rawText.match(/\b(EUR|USD|GBP|CHF|JPY|CAD|AUD)\s*([0-9][0-9.,]*)/i)
	const currency = amountMatch ? amountMatch[1].toUpperCase() : "EUR"
	const amountMinor = amountMatch ? parseDecimalStringToMinor(amountMatch[2], currency) : 0
	const bearerMatch = rawText.match(/\b(OUR|SHA|BEN)\b/i)
	const contractedChargeBearer: ChargeBearerClause = bearerMatch
		? (bearerMatch[1].toUpperCase() as ChargeBearerClause)
		: "OUR"
	const ibanMatch = rawText.match(/\b([A-Z]{2}[0-9]{2}[A-Z0-9]{11,30})\b/)
	const settleMatch = rawText.match(/settle(?:ment)?\s*(?:currency|in)?\s*[:=]?\s*(USD|EUR|GBP)/i)

	const sourceRefs: SourceRef[] = [
		{
			sourceType: "pdf_extract",
			recordId: invoiceId,
			field: "extracted_text",
			rawExcerpt: rawText.slice(0, 320),
		},
	]

	return {
		invoiceId,
		vendorOrClient: "PDF Uploaded Counterparty",
		vendorIban: ibanMatch?.[1],
		issueDate: "2026-11-24",
		dueDate: "2026-11-30",
		expectedAmount: { amountMinor, currency },
		expectedSettlementCurrency: settleMatch ? settleMatch[1].toUpperCase() : "USD",
		contractedChargeBearer,
		withholdingTaxRateBps: undefined,
		remittanceHint: invoiceId,
		sourceRefs,
	}
}
