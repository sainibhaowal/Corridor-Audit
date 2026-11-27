import { inflateSync } from "node:zlib"
import { parseDecimalStringToMinor } from "../money"
import type { ChargeBearerClause, InvoiceInput, SourceRef } from "../types"

const MAX_PDF_DECOMPRESSED_BYTES = 20 * 1024 * 1024
const MAX_PDF_STREAMS = 1000

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
	const header = buffer.subarray(0, Math.min(buffer.length, 1024)).toString("latin1")
	const trailer = buffer.subarray(Math.max(0, buffer.length - 2048)).toString("latin1")
	if (!header.includes("%PDF-") || !trailer.includes("%%EOF")) {
		throw new Error("Upload is not a complete PDF file.")
	}
	const collected: string[] = []
	let decompressedBytes = 0
	let streamCount = 0

	// 1. Try inflating FlateDecode streams
	const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g
	let match: RegExpExecArray | null
	while ((match = streamRegex.exec(latin1)) !== null) {
		streamCount += 1
		if (streamCount > MAX_PDF_STREAMS) throw new Error("PDF contains too many streams to process safely.")
		const rawStream = Buffer.from(match[1], "latin1")
		const remainingBytes = MAX_PDF_DECOMPRESSED_BYTES - decompressedBytes
		if (remainingBytes <= 0) throw new Error("PDF decompressed content exceeds the 20 MiB processing limit.")
		try {
			const inflatedBuffer = inflateSync(rawStream, { maxOutputLength: remainingBytes })
			decompressedBytes += inflatedBuffer.byteLength
			const inflated = inflatedBuffer.toString("latin1")
			collected.push(...decodePdfLiteralStrings(inflated))
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ERR_BUFFER_TOO_LARGE") {
				throw new Error("PDF decompressed content exceeds the 20 MiB processing limit.")
			}
			// Also scan uncompressed streams directly
			collected.push(...decodePdfLiteralStrings(match[1]))
		}
	}

	if (collected.length > 0) {
		const result = collected.join("\n")
		if (Buffer.byteLength(result, "utf8") > MAX_PDF_DECOMPRESSED_BYTES) {
			throw new Error("PDF extracted text exceeds the 20 MiB processing limit.")
		}
		return result
	}
	throw new Error("PDF contains no extractable text. Scanned PDFs require OCR before upload.")
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
