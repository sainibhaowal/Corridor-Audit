import { parseDecimalStringToMinor } from "../money"
import type { ChargeBearerClause, InvoiceInput, SourceRef, WireOrBankInput } from "../types"

function splitCsvLine(line: string): string[] {
	const cells: string[] = []
	let current = ""
	let inQuotes = false

	for (let i = 0; i < line.length; i++) {
		const ch = line[i]
		if (ch === '"') {
			if (inQuotes && line[i + 1] === '"') {
				current += '"'
				i++
			} else {
				inQuotes = !inQuotes
			}
		} else if (ch === "," && !inQuotes) {
			cells.push(current.trim())
			current = ""
		} else {
			current += ch
		}
	}
	cells.push(current.trim())
	return cells
}

export function parseCsvRecords(rawCsv: string): Array<Record<string, string>> {
	const lines = rawCsv
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean)
	if (lines.length < 2) return []

	const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, "_"))
	const rows: Array<Record<string, string>> = []

	for (let i = 1; i < lines.length; i++) {
		const vals = splitCsvLine(lines[i])
		const row: Record<string, string> = {}
		headers.forEach((h, idx) => {
			row[h] = vals[idx] ?? ""
		})
		rows.push(row)
	}
	return rows
}

function normalizeBearer(val?: string): ChargeBearerClause {
	const upper = (val ?? "SHA").trim().toUpperCase()
	if (upper === "OUR" || upper === "SHA" || upper === "BEN") return upper
	return "SHA"
}

export function parseInvoicesCsv(rawCsv: string): InvoiceInput[] {
	const rows = parseCsvRecords(rawCsv)
	return rows.map((row, idx) => {
		const invoiceId = row.invoice_id || row.invoice || `INV-CSV-${idx + 1}`
		const currency = (row.currency || row.expected_currency || "EUR").toUpperCase()
		const settlementCurrency = (row.settlement_currency || row.expected_settlement_currency || "USD").toUpperCase()
		const amountMinor = parseDecimalStringToMinor(row.amount || row.expected_amount || "0", currency)
		const whtBps = Number(row.withholding_tax_bps || row.tax_bps || "0") || 0
		const bearer = normalizeBearer(row.charge_bearer || row.contracted_charge_bearer)

		const sourceRefs: SourceRef[] = [
			{
				sourceType: "invoice",
				recordId: invoiceId,
				field: "csv_row",
				rawExcerpt: JSON.stringify(row),
			},
		]

		return {
			invoiceId,
			vendorOrClient: row.vendor || row.client || row.vendor_or_client || "Synthetic Client",
			vendorIban: row.iban || row.vendor_iban || undefined,
			vendorBic: row.bic || row.vendor_bic || undefined,
			issueDate: row.issue_date || "2026-11-20",
			dueDate: row.due_date || "2026-11-30",
			expectedAmount: { amountMinor, currency },
			expectedSettlementCurrency: settlementCurrency,
			contractedChargeBearer: bearer,
			withholdingTaxRateBps: whtBps,
			remittanceHint: row.remittance_hint || row.reference || invoiceId,
			priorAccountRef: row.prior_account_ref || undefined,
			sourceRefs,
		}
	})
}

export function parseWiresCsv(rawCsv: string): WireOrBankInput[] {
	const rows = parseCsvRecords(rawCsv)
	return rows.map((row, idx) => {
		const wireId = row.wire_id || row.payout_id || row.id || `WIRE-CSV-${idx + 1}`
		const settledCurrency = (row.settled_currency || row.payout_currency || row.currency || "USD").toUpperCase()
		const instructedCurrency = (row.instructed_currency || row.gross_currency || settledCurrency).toUpperCase()
		const settledMinor = parseDecimalStringToMinor(
			row.settled_amount || row.net_amount || row.net_landed || "0",
			settledCurrency,
		)
		const instructedMinor = row.instructed_amount || row.gross_amount
			? parseDecimalStringToMinor(row.instructed_amount || row.gross_amount, instructedCurrency)
			: undefined

		const platformRaw = (row.platform || row.platform_name || "direct_bank").toLowerCase()
		const isPlatform = ["upwork", "stripe", "wise", "paypal", "payoneer"].includes(platformRaw)
		const platformFeeCurrency = (row.platform_fee_currency || instructedCurrency).toUpperCase()
		const platformFeeMinor = row.platform_fee
			? parseDecimalStringToMinor(row.platform_fee, platformFeeCurrency)
			: 0

		const receiverFeeCurrency = (row.receiver_fee_currency || row.fee_currency || settledCurrency).toUpperCase()
		const receiverFeeMinor = row.receiver_fee || row.lifting_fee
			? parseDecimalStringToMinor(row.receiver_fee || row.lifting_fee, receiverFeeCurrency)
			: 0

		const repairFeeMinor = row.repair_fee
			? parseDecimalStringToMinor(row.repair_fee, receiverFeeCurrency)
			: 0

		const sourceRefs: SourceRef[] = [
			{
				sourceType: isPlatform ? "platform_csv" : "bank_csv",
				recordId: wireId,
				field: "csv_row",
				rawExcerpt: JSON.stringify(row),
			},
		]

		return {
			wireId,
			transactionRef: row.transaction_ref || wireId,
			format: isPlatform ? "platform_payout" : "bank_csv",
			platformName: isPlatform ? (platformRaw as WireOrBankInput["platformName"]) : "direct_bank",
			rawText: JSON.stringify(row, null, 2),
			valueDate: row.value_date || row.date || "2026-11-24",
			instructedAmount:
				instructedMinor !== undefined
					? { amountMinor: instructedMinor, currency: instructedCurrency }
					: undefined,
			settledAmount: { amountMinor: settledMinor, currency: settledCurrency },
			chargeBearer: row.charge_bearer ? normalizeBearer(row.charge_bearer) : undefined,
			platformFee:
				platformFeeMinor > 0 ? { amountMinor: platformFeeMinor, currency: platformFeeCurrency } : undefined,
			senderCharges: [],
			receiverCharges:
				receiverFeeMinor > 0 ? [{ amountMinor: receiverFeeMinor, currency: receiverFeeCurrency }] : [],
			repairFee: repairFeeMinor > 0 ? { amountMinor: repairFeeMinor, currency: receiverFeeCurrency } : undefined,
			remittanceInfo: row.remittance_info || row.memo || row.invoice_id || undefined,
			senderName: row.sender || row.sender_name || row.client || undefined,
			beneficiaryAccountRef: row.beneficiary_iban || row.account_ref || undefined,
			sourceRefs,
		}
	})
}
