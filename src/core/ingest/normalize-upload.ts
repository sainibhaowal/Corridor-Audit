import { parseCamt053Xml } from "../parsers/camt053-parser"
import { parseInvoicesCsv, parseWiresCsv } from "../parsers/csv-parser"
import { parseMt103Blocks } from "../parsers/mt103-parser"
import { extractTextFromPdfBuffer, parseInvoiceFromExtractedText } from "../parsers/pdf-parser"
import type { InvoiceInput, SettlementCase, WireOrBankInput } from "../types"
import { parseJsonSettlementCases } from "./case-schema"

export interface UploadPayload {
	filename?: string
	content?: string
	base64?: string
	format?: "auto" | "json" | "mt103" | "csv" | "xml" | "pdf" | "text" | "image"
	force?: boolean
}

export interface NormalizeOptions {
	nextCaseId?: (prefix: string) => string
}

function markSuppliedWireEvidence(cases: SettlementCase[]): SettlementCase[] {
	return cases.map((settlementCase) => {
		if (settlementCase.settlementEvidence === "estimated" || settlementCase.settlementEvidence === "incomplete") {
			return settlementCase
		}
		if (!settlementCase.invoice) {
			return {
				...settlementCase,
				settlementEvidence: "incomplete",
				evidenceGap: "Independent invoice or contractual obligation evidence is missing.",
			}
		}
		const invoiceRefs = settlementCase.invoice.sourceRefs ?? []
		const wireRefs = settlementCase.wire.sourceRefs ?? []
		const referencesAreDistinct = invoiceRefs.some((invoiceRef) =>
			wireRefs.some((wireRef) => invoiceRef.recordId !== wireRef.recordId && invoiceRef.sourceType !== wireRef.sourceType),
		)
		if (!referencesAreDistinct) {
			return {
				...settlementCase,
				settlementEvidence: "incomplete",
				evidenceGap: "Invoice and payment evidence need distinct source references before they can be reconciled.",
			}
		}
		const wire = settlementCase.wire as unknown as { senderCharges?: unknown; receiverCharges?: unknown }
		if (!Array.isArray(wire.senderCharges) || !Array.isArray(wire.receiverCharges)) {
			return {
				...settlementCase,
				settlementEvidence: "incomplete",
				evidenceGap: "The source does not provide both sender and receiver charge fields, so a complete fee reconciliation is not possible.",
			}
		}
		return { ...settlementCase, settlementEvidence: "observed" }
	})
}

export function normalizeInboundPayloadToCases(input: UploadPayload, options?: NormalizeOptions): SettlementCase[] {
	const name = (input.filename || "").toLowerCase()
	const fmt = input.format || "auto"
	let text = input.content || ""
	let localSeq = 0
	const makeId = (prefix: string) => {
		if (options?.nextCaseId) return options.nextCaseId(prefix)
		localSeq += 1
		return `${prefix}-${Date.now().toString().slice(-4)}-${String(localSeq).padStart(3, "0")}`
	}

	if ((fmt === "pdf" || name.endsWith(".pdf")) && input.base64) {
		const buf = Buffer.from(input.base64, "base64")
		text = extractTextFromPdfBuffer(buf)
	}

	const trimmed = text.trim()
	if (!trimmed) {
		throw new Error("Empty upload/webhook payload.")
	}

	// 1. JSON payload (single SettlementCase, { cases: [...] }, or webhook { invoice, wire })
	// Note: SWIFT MT103 messages also start with "{1:...", so exclude MT103 block headers from JSON sniffing.
	const looksLikeMt103Header = /^\{1:[A-Z0-9]+\}/.test(trimmed)
	if (fmt === "json" || name.endsWith(".json") || (!looksLikeMt103Header && (trimmed.startsWith("{") || trimmed.startsWith("[")))) {
		const parsed = JSON.parse(trimmed) as unknown
		if (Array.isArray(parsed)) {
			return markSuppliedWireEvidence(parseJsonSettlementCases(parsed))
		}
		if (!parsed || typeof parsed !== "object") {
			throw new Error("Invalid settlement JSON: expected an object or an array of cases.")
		}
		const obj = parsed as Record<string, unknown>
		if (Array.isArray(obj.cases)) {
			return markSuppliedWireEvidence(parseJsonSettlementCases(obj.cases))
		}
		if (obj.caseId && obj.wire) {
			return markSuppliedWireEvidence(parseJsonSettlementCases(obj))
		}
		if (obj.wire || obj.invoice) {
			const id = String(obj.caseId || makeId("WH"))
			const settlementCase = {
					caseId: id,
					title: String(obj.title || `Inbound Webhook (${id})`),
					channelLabel: String(obj.channelLabel || "Inbound Webhook JSON"),
					settlementEvidence: obj.wire ? "observed" : "estimated",
					invoice: obj.invoice as InvoiceInput | undefined,
					wire: (obj.wire as WireOrBankInput) ?? {
						wireId: `WIRE-${id}`,
						format: "bank_csv",
						valueDate: String((obj.invoice as InvoiceInput | undefined)?.dueDate || new Date().toISOString().slice(0, 10)),
						settledAmount: (obj.invoice as InvoiceInput).expectedAmount,
						senderCharges: [],
						receiverCharges: [],
					},
					createdAt: new Date().toISOString(),
			}
			return markSuppliedWireEvidence(parseJsonSettlementCases(settlementCase))
		}
		throw new Error("Invalid settlement JSON: expected a case, a cases array, or invoice and wire records.")
	}

	// 2. ISO 20022 XML (camt.053 / pacs.008)
	if (fmt === "xml" || name.endsWith(".xml") || (trimmed.startsWith("<") && /Ntry|CdtTrfTxInf|Amt/.test(trimmed))) {
		const wires = parseCamt053Xml(trimmed)
		return wires.map((w) => {
			const id = makeId("XML")
			return {
				caseId: id,
				title: `ISO 20022 Entry (${w.transactionRef || w.wireId})`,
				channelLabel: "ISO 20022 camt.053 XML",
				settlementEvidence: "incomplete",
				evidenceGap: "The payment instruction does not include an independent invoice or contract record.",
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
							withholdingTaxRateBps: undefined,
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
		return wires.map((w) => {
			const id = makeId("MT103")
			const invRef = w.remittanceInfo?.replace(/^\/INV\//i, "").trim()
			return {
				caseId: id,
				title: `SWIFT MT103 Wire (${w.transactionRef || w.wireId})`,
				channelLabel: "SWIFT MT103 Upload",
				settlementEvidence: "incomplete",
				evidenceGap: "The MT103 is payment evidence, but no independent invoice or contract record was supplied.",
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
							withholdingTaxRateBps: undefined,
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
			return wires.map((w) => {
				const id = makeId("CSV")
				return {
					caseId: id,
					title: `${w.platformName?.toUpperCase() || "CSV"} Payout (${w.wireId})`,
					channelLabel: w.platformName && w.platformName !== "direct_bank" ? `Platform CSV (${w.platformName})` : "Bank CSV Upload",
					settlementEvidence: "incomplete",
					evidenceGap: "The payout row is a single source record and does not provide an independent invoice or contract record.",
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
								withholdingTaxRateBps: undefined,
								remittanceHint: w.remittanceInfo,
							}
						: undefined,
					createdAt: new Date().toISOString(),
				}
			})
		}

		const invoices = parseInvoicesCsv(trimmed)
		return invoices.map((inv) => {
			const id = makeId("INVCASE")
			return {
				caseId: id,
				title: `Uploaded Invoice (${inv.invoiceId})`,
				channelLabel: "Invoice CSV Upload",
				settlementEvidence: "estimated",
				invoice: inv,
				wire: {
					wireId: `WIRE-${inv.invoiceId}`,
					format: "bank_csv",
					valueDate: inv.dueDate,
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
	const id = makeId(name.endsWith(".pdf") ? "PDF" : "TEXT")
	const inv = parseInvoiceFromExtractedText(trimmed, id)
	return [
		{
			caseId: id,
			title: `Extracted Notice (${inv.invoiceId})`,
			channelLabel: name.endsWith(".pdf") ? "PDF Document Extract" : "Raw Text / Email Advice",
			settlementEvidence: "estimated",
			invoice: inv,
			wire: {
				wireId: `WIRE-${inv.invoiceId}`,
				format: "bank_csv",
				rawText: trimmed,
				valueDate: inv.dueDate,
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
