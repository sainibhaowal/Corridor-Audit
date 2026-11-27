import { z } from "zod"
import type { AccountingPaymentApplication, InvoiceInput, SettlementCase, WireOrBankInput } from "../types"
import { IngestionLimitError, MAX_CASES_PER_INGESTION, MAX_CANDIDATE_WIRES_PER_CASE } from "./limits"

const currency = z.string().regex(/^[A-Za-z]{3}$/, "Currency must be a three-letter ISO code.").transform((value) => value.toUpperCase())
const money = z.object({
	amountMinor: z.number().int().safe(),
	currency,
}).passthrough()

const sourceRef = z.object({
	sourceType: z.enum(["invoice", "mt103", "camt053", "bank_csv", "platform_csv", "pdf_extract", "workspace_policy", "ecb_fx"]),
	recordId: z.string().min(1).max(500),
	field: z.string().min(1).max(500),
	rawExcerpt: z.string().max(20_000),
	url: z.string().url().optional(),
}).passthrough()

const accountingPayment = z.object({
	provider: z.enum(["quickbooks", "xero"]),
	applicationId: z.string().min(1).max(500),
	paymentId: z.string().min(1).max(500),
	invoiceRecordId: z.string().min(1).max(500),
	date: z.iso.date().optional(),
	amount: money.optional(),
	status: z.string().max(100).optional(),
	reconciled: z.boolean().optional(),
	mappingIssue: z.string().max(1000).optional(),
	sourceRef,
}).passthrough()

const invoice = z.object({
	invoiceId: z.string().trim().min(1).max(500),
	vendorOrClient: z.string().trim().min(1).max(500),
	vendorIban: z.string().max(100).optional(),
	vendorBic: z.string().max(50).optional(),
	issueDate: z.iso.date(),
	dueDate: z.iso.date(),
	expectedAmount: money,
	expectedSettlementCurrency: currency,
	contractedChargeBearer: z.enum(["OUR", "SHA", "BEN"]),
	withholdingTaxRateBps: z.number().int().min(0).max(10_000).optional(),
	taxMinor: z.number().int().safe().optional(),
	discountMinor: z.number().int().safe().optional(),
	lineItems: z.array(z.object({
		description: z.string().max(1000),
		quantity: z.number().finite(),
		unitPriceMinor: z.number().int().safe(),
		lineTotalMinor: z.number().int().safe(),
	}).passthrough()).max(500).optional(),
	remittanceHint: z.string().max(2000).optional(),
	priorAccountRef: z.string().max(500).optional(),
	sourceRefs: z.array(sourceRef).max(1000).optional(),
}).passthrough()

const wire = z.object({
	wireId: z.string().trim().min(1).max(500),
	transactionRef: z.string().max(500).optional(),
	format: z.enum(["mt103", "bank_csv", "camt053", "platform_payout"]),
	platformName: z.enum(["upwork", "stripe", "wise", "paypal", "payoneer", "direct_bank"]).optional(),
	rawText: z.string().max(500_000).optional(),
	valueDate: z.iso.date(),
	instructedAmount: money.optional(),
	settledAmount: money,
	bankAppliedRate: z.number().finite().positive().optional(),
	chargeBearer: z.enum(["OUR", "SHA", "BEN"]).optional(),
	platformFee: money.optional(),
	senderCharges: z.array(money).max(1000).optional(),
	receiverCharges: z.array(money).max(1000).optional(),
	repairFee: money.optional(),
	remittanceInfo: z.string().max(5000).optional(),
	senderName: z.string().max(500).optional(),
	beneficiaryName: z.string().max(500).optional(),
	beneficiaryAccountRef: z.string().max(500).optional(),
	offHours: z.boolean().optional(),
	watchlistTag: z.string().max(500).optional(),
	sourceRefs: z.array(sourceRef).max(1000).optional(),
}).passthrough()

const caseSchema = z.object({
	caseId: z.string().trim().min(1).max(500),
	title: z.string().trim().min(1).max(1000).optional(),
	channelLabel: z.string().trim().min(1).max(500).optional(),
	settlementEvidence: z.enum(["observed", "estimated", "incomplete"]).optional(),
	evidenceGap: z.string().max(2000).optional(),
	accountingPayments: z.array(accountingPayment).max(1000).optional(),
	invoice: invoice.optional(),
	wire,
	candidateWires: z.array(wire).max(MAX_CANDIDATE_WIRES_PER_CASE, {
		message: `A case can contain no more than ${MAX_CANDIDATE_WIRES_PER_CASE} candidate wires.`,
	}).optional(),
	createdAt: z.iso.datetime({ offset: true }).optional(),
}).passthrough()

export function parseJsonSettlementCases(value: unknown): SettlementCase[] {
	const rows = Array.isArray(value) ? value : [value]
	if (rows.length > MAX_CASES_PER_INGESTION) {
		throw new IngestionLimitError(`An import can contain no more than ${MAX_CASES_PER_INGESTION} settlement cases.`)
	}
	const parsed = z.array(caseSchema).safeParse(rows)
	if (!parsed.success) {
		const firstIssue = parsed.error.issues[0]
		const location = firstIssue?.path.length ? firstIssue.path.join(".") : "payload"
		throw new Error(`Invalid settlement JSON at ${location}: ${firstIssue?.message || "schema validation failed"}`)
	}
	return parsed.data.map((row): SettlementCase => {
		const missingChargeFields = !Array.isArray(row.wire.senderCharges) || !Array.isArray(row.wire.receiverCharges)
		const evidenceGap = row.evidenceGap || (missingChargeFields
			? "The source does not provide both sender and receiver charge fields, so a complete fee reconciliation is not possible."
			: undefined)
		const settlementEvidence = row.settlementEvidence === "estimated" || row.settlementEvidence === "incomplete"
			? row.settlementEvidence
			: missingChargeFields ? "incomplete" : "observed"
		return {
			...row,
			title: row.title || `Settlement case ${row.caseId}`,
			channelLabel: row.channelLabel || "JSON settlement import",
			settlementEvidence,
			evidenceGap,
			accountingPayments: row.accountingPayments as AccountingPaymentApplication[] | undefined,
			createdAt: row.createdAt || new Date().toISOString(),
			invoice: row.invoice as InvoiceInput | undefined,
			wire: {
				...row.wire,
				senderCharges: row.wire.senderCharges || [],
				receiverCharges: row.wire.receiverCharges || [],
			} as WireOrBankInput,
			candidateWires: row.candidateWires?.map((candidate) => ({
				...candidate,
				senderCharges: candidate.senderCharges || [],
				receiverCharges: candidate.receiverCharges || [],
			})) as WireOrBankInput[] | undefined,
		}
	})
}
