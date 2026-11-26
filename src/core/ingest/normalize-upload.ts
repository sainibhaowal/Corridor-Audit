import { parseCamt053Xml } from "../parsers/camt053-parser"
import { parseInvoicesCsv, parseWiresCsv } from "../parsers/csv-parser"
import { parseMt103Blocks } from "../parsers/mt103-parser"
import { extractTextFromPdfBuffer, parseInvoiceFromExtractedText } from "../parsers/pdf-parser"
import type { InvoiceInput, SettlementCase, WireOrBankInput } from "../types"

export interface UploadPayload {
	filename?: string
	content?: string
	base64?: string
	format?: "auto" | "json" | "mt103" | "csv" | "xml" | "pdf" | "text"
}

export function normalizeInboundPayloadToCases(input: UploadPayload): SettlementCase[] {
	const name = (input.filename || "").toLowerCase()
	const fmt = input.format || "auto"
	let text = input.content || ""

	if ((fmt === "pdf" || name.endsWith(".pdf")) && input.base64) {
		const buf = Buffer.from(input.base64, "base64")
		text = extractTextFromPdfBuffer(buf)
	}

	const trimmed = text.trim()
	if (!trimmed) {
		throw new Error("Empty upload/webhook payload.")
	}

	// 1. JSON payload (single SettlementCase, { cases: [...] }, or webhook { invoice, wire })
	if (fmt === "json" || name.endsWith(".json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
		const parsed = JSON.parse(trimmed) as unknown
		if (Array.isArray(parsed)) {
			return parsed as SettlementCase[]
		}
		const obj = parsed as Record<string, unknown>
		if (Array.isArray(obj.cases)) {
			return obj.cases as SettlementCase[]
		}
		if (obj.caseId && obj.wire) {
			return [obj as unknown as SettlementCase]
		}
		if (obj.wire || obj.invoice) {
			const id = String(obj.caseId || `WH-${Date.now().toString().slice(-5)}`)
			return [
				{
					caseId: id,
					title: String(obj.title || `Inbound Webhook (${id})`),
					channelLabel: String(obj.channelLabel || "Inbound Webhook JSON"),
					invoice: obj.invoice as InvoiceInput | undefined,
					wire: (obj.wire as WireOrBankInput) ?? {
						wireId: `WIRE-${id}`,
						format: "bank_csv",
						valueDate: "2026-11-24",
						settledAmount: (obj.invoice as InvoiceInput).expectedAmount,
						senderCharges: [],
						receiverCharges: [],
					},
					createdAt: new Date().toISOString(),
				},
			]
		}
	}

	// 2. ISO 20022 XML (camt.053 / pacs.008)
	if (fmt === "xml" || name.endsWith(".xml") || (trimmed.startsWith("<") && /Ntry|CdtTrfTxInf|Amt/.test(trimmed))) {
		const wires = parseCamt053Xml(trimmed)
		return wires.map((w, idx) => {
			const id = `XML-${Date.now().toString().slice(-4)}-${idx + 1}`
			return {
				caseId: id,
				title: `ISO 20022 Entry (${w.transactionRef || w.wireId})`,
				channelLabel: "ISO 20022 camt.053 XML",
				wire: w,
				invoice: w.instructedAmount
					? {
							invoiceId: w.remittanceInfo || `INV-${id}`,
							vendorOrClient: w.senderName || "XML Counterparty",
							issueDate: w.valueDate,
							dueDate: w.valueDate,
							expectedAmount: w.instructedAmount,
							expectedSettlementCurrency: w.settledAmount.currency,
							contractedChargeBearer: w.chargeBearer ?? "SHA",
							withholdingTaxRateBps: 0,
							remittanceHint: w.remittanceInfo,
						}
					: undefined,
				createdAt: new Date().toISOString(),
			}
		})
	}

	// 3. SWIFT MT103 blocks
	if (fmt === "mt103" || trimmed.includes(":32A:") || trimmed.includes(":20:")) {
		const wires = parseMt103Blocks(trimmed)
		return wires.map((w, idx) => {
			const id = `MT103-${Date.now().toString().slice(-4)}-${idx + 1}`
			const invRef = w.remittanceInfo?.replace(/^\/INV\//i, "").trim()
			return {
				caseId: id,
				title: `SWIFT MT103 Wire (${w.transactionRef || w.wireId})`,
				channelLabel: "SWIFT MT103 Upload",
				wire: w,
				invoice: w.instructedAmount
					? {
							invoiceId: invRef || `INV-${id}`,
							vendorOrClient: w.senderName || "SWIFT Ordering Customer",
							issueDate: w.valueDate,
							dueDate: w.valueDate,
							expectedAmount: w.instructedAmount,
							expectedSettlementCurrency: w.settledAmount.currency,
							contractedChargeBearer: w.chargeBearer ?? "OUR",
							withholdingTaxRateBps: 0,
							remittanceHint: invRef,
						}
					: undefined,
				createdAt: new Date().toISOString(),
			}
		})
	}

	// 4. CSV (Invoices or Bank/Platform Payouts)
	if (fmt === "csv" || name.endsWith(".csv") || (trimmed.includes(",") && trimmed.split(/\r?\n/).length >= 2)) {
		const header = trimmed.split(/\r?\n/)[0].toLowerCase()
		if (header.includes("settled_amount") || header.includes("net_amount") || header.includes("platform")) {
			const wires = parseWiresCsv(trimmed)
			return wires.map((w, idx) => {
				const id = `CSV-${Date.now().toString().slice(-4)}-${idx + 1}`
				return {
					caseId: id,
					title: `${w.platformName?.toUpperCase() || "CSV"} Payout (${w.wireId})`,
					channelLabel: w.platformName && w.platformName !== "direct_bank" ? `Platform CSV (${w.platformName})` : "Bank CSV Upload",
					wire: w,
					invoice: w.instructedAmount
						? {
								invoiceId: w.remittanceInfo?.replace(/^\/INV\//i, "") || `INV-${id}`,
								vendorOrClient: w.senderName || "CSV Counterparty",
								issueDate: w.valueDate,
								dueDate: w.valueDate,
								expectedAmount: w.instructedAmount,
								expectedSettlementCurrency: w.settledAmount.currency,
								contractedChargeBearer: w.chargeBearer ?? "SHA",
								withholdingTaxRateBps: 0,
								remittanceHint: w.remittanceInfo,
							}
						: undefined,
					createdAt: new Date().toISOString(),
				}
			})
		}

		const invoices = parseInvoicesCsv(trimmed)
		return invoices.map((inv, idx) => {
			const id = `INVCASE-${Date.now().toString().slice(-4)}-${idx + 1}`
			return {
				caseId: id,
				title: `Uploaded Invoice (${inv.invoiceId})`,
				channelLabel: "Invoice CSV Upload",
				invoice: inv,
				wire: {
					wireId: `WIRE-${inv.invoiceId}`,
					format: "bank_csv",
					valueDate: "2026-11-24",
					instructedAmount: inv.expectedAmount,
					settledAmount: inv.expectedAmount,
					chargeBearer: inv.contractedChargeBearer,
					senderCharges: [],
					receiverCharges: [],
					remittanceInfo: inv.remittanceHint,
					senderName: inv.vendorOrClient,
				},
				createdAt: new Date().toISOString(),
			}
		})
	}

	// 5. Fallback: PDF extracted text or raw pasted email snippet
	const id = `TEXT-${Date.now().toString().slice(-4)}`
	const inv = parseInvoiceFromExtractedText(trimmed, id)
	return [
		{
			caseId: id,
			title: `Extracted Notice (${inv.invoiceId})`,
			channelLabel: name.endsWith(".pdf") ? "PDF Document Extract" : "Raw Text / Email Advice",
			invoice: inv,
			wire: {
				wireId: `WIRE-${inv.invoiceId}`,
				format: "bank_csv",
				rawText: trimmed,
				valueDate: "2026-11-24",
				instructedAmount: inv.expectedAmount,
				settledAmount: inv.expectedAmount,
				chargeBearer: inv.contractedChargeBearer,
				senderCharges: [],
				receiverCharges: [],
				remittanceInfo: inv.invoiceId,
				senderName: inv.vendorOrClient,
				sourceRefs: inv.sourceRefs,
			},
			createdAt: new Date().toISOString(),
		},
	]
}
