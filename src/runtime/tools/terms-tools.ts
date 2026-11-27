import type { Tool } from "@mozaik-ai/core"
import { z } from "zod"
import {
	computeInvoiceLineItemsTotal,
	computeTaxWithholding,
	formatMoney,
	validateBicFormat,
	validateIbanMod97,
} from "../../core/money"
import type { ChargeBearerClause, SourceRef, TermsAssessment } from "../../core/types"
import { DEFAULT_WORKSPACE_ID, getCorridorDb } from "../../core/db/database"
import { resolveWithholdingPolicy } from "../../core/policies/tax-profile"
import { resolveRuntime } from "../corridor-runtime"

const CaseIdSchema = z.object({ caseId: z.string().min(1) })
const IbanBicSchema = z.object({
	caseId: z.string().optional(),
	iban: z.string().optional(),
	bic: z.string().optional(),
})
const TaxSchema = z.object({
	caseId: z.string().optional(),
	grossMinor: z.number().int().optional(),
	currency: z.string().optional(),
	withholdingTaxRateBps: z.number().int().optional(),
})
const ClauseSchema = z.object({
	caseId: z.string().optional(),
	invoiceBearer: z.enum(["OUR", "SHA", "BEN"]).optional(),
	wireBearer: z.enum(["OUR", "SHA", "BEN"]).optional(),
	receiverChargesCount: z.number().int().optional(),
})

function ensureTermsAssessment(caseId: string): TermsAssessment {
	const state = resolveRuntime().state
	const existing = state.termsByCaseId.get(caseId)
	if (existing) return existing
	const c = state.casesById.get(caseId)
	const inv = c?.invoice
	const taxProfile = getCorridorDb().getCurrentTaxPolicy(DEFAULT_WORKSPACE_ID)
	const taxPolicy = resolveWithholdingPolicy({
		invoiceRateBps: inv?.withholdingTaxRateBps,
		workspaceRateBps: taxProfile.withholdingTaxBps,
		taxCountry: taxProfile.country,
	})
	const expectedCurrency = inv?.expectedAmount.currency ?? c?.wire.instructedAmount?.currency ?? "USD"
	const expectedSettlementCurrency = inv?.expectedSettlementCurrency ?? c?.wire.settledAmount.currency ?? "USD"
	const draft: TermsAssessment = {
		caseId,
		invoiceId: inv?.invoiceId ?? `UNLINKED-${caseId}`,
		expectedGrossMinor: inv?.expectedAmount.amountMinor ?? c?.wire.instructedAmount?.amountMinor ?? 0,
		expectedCurrency,
		expectedSettlementCurrency,
		contractedChargeBearer: inv?.contractedChargeBearer ?? c?.wire.chargeBearer ?? "SHA",
		withholdingTaxRateBps: taxPolicy.rateBps,
		withholdingTaxSource: taxPolicy.source,
		taxCountry: taxPolicy.taxCountry,
		taxPolicyVersionId: taxProfile.id,
		withholdingTaxMinor: 0,
		lineItemCheckPassed: true,
		lineItemComputedMinor: inv?.expectedAmount.amountMinor ?? 0,
		clauseBreachDetected: false,
		clauseSummary: "Pending evaluation",
		sourceRefs: [],
	}
	state.termsByCaseId.set(caseId, draft)
	return draft
}

export const getInvoiceRecordTool: Tool = {
	type: "function",
	name: "get_invoice_record",
	description: "Load invoice contract obligations, expected gross minor amount, charge bearer clause, and IBAN/BIC for caseId.",
	parameters: {
		type: "object",
		properties: { caseId: { type: "string", description: "Case ID e.g. CASE-002" } },
		required: ["caseId"],
	},
	strict: false,
	invoke: async (rawArgs: unknown) => {
		const { caseId } = CaseIdSchema.parse(rawArgs)
		const state = resolveRuntime().state
		const c = state.casesById.get(caseId)
		if (!c) return { error: `Unknown caseId ${caseId}` }
		const inv = c.invoice
		const assessment = ensureTermsAssessment(caseId)
		const refs: SourceRef[] = inv
			? [
					{
						sourceType: "invoice",
						recordId: inv.invoiceId,
						field: "expectedAmount",
						rawExcerpt: `${inv.invoiceId}: ${formatMoney(inv.expectedAmount.amountMinor, inv.expectedAmount.currency)} (${inv.contractedChargeBearer})`,
					},
					{
						sourceType: "invoice",
						recordId: inv.invoiceId,
						field: "contractedChargeBearer",
						rawExcerpt: `Charge bearer=${inv.contractedChargeBearer}, settlement=${inv.expectedSettlementCurrency}`,
					},
					...(inv.sourceRefs ?? []),
				]
			: [
					{
						sourceType: "mt103",
						recordId: c.wire.wireId,
						field: "unlinked_invoice",
						rawExcerpt: `No direct invoice pre-attached; evaluating from wire ${c.wire.wireId}`,
					},
				]
		assessment.sourceRefs = refs
		if (assessment.withholdingTaxSource === "workspace_profile") {
			refs.push({
				sourceType: "workspace_policy",
				recordId: assessment.taxPolicyVersionId,
				field: "withholdingTaxBps",
				rawExcerpt: `Workspace tax profile ${assessment.taxPolicyVersionId} (${assessment.taxCountry}): ${assessment.withholdingTaxRateBps} bps used because the invoice did not provide a rate. This is a configured assumption, not a jurisdictional tax determination.`,
			})
		}
		state.termsByCaseId.set(caseId, assessment)

		return {
			caseId,
			invoiceId: assessment.invoiceId,
			vendorOrClient: inv?.vendorOrClient ?? c.wire.senderName ?? "Unknown",
			expectedAmountMinor: assessment.expectedGrossMinor,
			expectedFormatted: formatMoney(assessment.expectedGrossMinor, assessment.expectedCurrency),
			expectedCurrency: assessment.expectedCurrency,
			expectedSettlementCurrency: assessment.expectedSettlementCurrency,
			contractedChargeBearer: assessment.contractedChargeBearer,
			vendorIban: inv?.vendorIban,
			vendorBic: inv?.vendorBic,
			withholdingTaxRateBps: assessment.withholdingTaxRateBps,
			withholdingTaxSource: assessment.withholdingTaxSource,
			taxCountry: assessment.taxCountry,
			taxPolicyVersionId: assessment.taxPolicyVersionId,
			hasLineItems: Boolean(inv?.lineItems?.length),
			summary: `Loaded ${assessment.invoiceId}: ${formatMoney(assessment.expectedGrossMinor, assessment.expectedCurrency)} (${assessment.contractedChargeBearer})`,
			sourceRefs: refs,
		}
	},
}

export const verifyInvoiceLineItemsTool: Tool = {
	type: "function",
	name: "verify_invoice_line_items",
	description: "Deterministically recompute invoice line items + tax - discount against expected invoice gross minor units.",
	parameters: {
		type: "object",
		properties: { caseId: { type: "string" } },
		required: ["caseId"],
	},
	strict: false,
	invoke: async (rawArgs: unknown) => {
		const { caseId } = CaseIdSchema.parse(rawArgs)
		const state = resolveRuntime().state
		const inv = state.casesById.get(caseId)?.invoice
		const assessment = ensureTermsAssessment(caseId)

		if (!inv || !inv.lineItems?.length) {
			assessment.lineItemCheckPassed = true
			assessment.lineItemComputedMinor = assessment.expectedGrossMinor
			return {
				caseId,
				lineItemCheckPassed: true,
				computedMinor: assessment.expectedGrossMinor,
				summary: "No granular line items supplied; invoice header amount accepted.",
			}
		}

		const lineItemsBaseMinor = inv.lineItems.reduce((sum, item) => sum + item.lineTotalMinor, 0)
		const taxMinor = inv.taxMinor ?? computeTaxWithholding(lineItemsBaseMinor, assessment.withholdingTaxRateBps)
		const res = computeInvoiceLineItemsTotal(inv.lineItems, taxMinor, inv.discountMinor ?? 0)
		const matchesHeader = res.computedMinor === inv.expectedAmount.amountMinor && !res.mismatchExists
		assessment.lineItemCheckPassed = matchesHeader
		assessment.lineItemComputedMinor = res.computedMinor
		const ref: SourceRef = {
			sourceType: "invoice",
			recordId: inv.invoiceId,
			field: "lineItems",
			rawExcerpt: `Line items total=${formatMoney(res.computedMinor, inv.expectedAmount.currency)} vs header=${formatMoney(inv.expectedAmount.amountMinor, inv.expectedAmount.currency)}`,
		}
		assessment.sourceRefs.push(ref)
		return {
			caseId,
			lineItemCheckPassed: matchesHeader,
			computedMinor: res.computedMinor,
			headerMinor: inv.expectedAmount.amountMinor,
			summary: matchesHeader
				? `Line items math PASSED (${formatMoney(res.computedMinor, inv.expectedAmount.currency)})`
				: `Line items mismatch detected (${res.computedMinor} vs ${inv.expectedAmount.amountMinor})`,
			sourceRefs: [ref],
		}
	},
}

export const validateIbanBicFormatTool: Tool = {
	type: "function",
	name: "validate_iban_bic_format",
	description: "Run ISO 13616 IBAN Mod-97 checksum and ISO 9362 SWIFT/BIC format validation to detect repair-fee triggers.",
	parameters: {
		type: "object",
		properties: {
			caseId: { type: "string" },
			iban: { type: "string" },
			bic: { type: "string" },
		},
	},
	strict: false,
	invoke: async (rawArgs: unknown) => {
		const parsed = IbanBicSchema.parse(rawArgs)
		const state = resolveRuntime().state
		const c = parsed.caseId ? state.casesById.get(parsed.caseId) : undefined
		const iban = parsed.iban ?? c?.invoice?.vendorIban
		const bic = parsed.bic ?? c?.invoice?.vendorBic

		const ibanCheck = iban ? validateIbanMod97(iban) : { valid: true, reason: "No IBAN on file" }
		const bicCheck = bic ? validateBicFormat(bic) : { valid: true, reason: "No BIC on file" }

		if (parsed.caseId) {
			const assessment = ensureTermsAssessment(parsed.caseId)
			assessment.ibanValid = ibanCheck.valid
			assessment.ibanIssue = ibanCheck.reason
			assessment.bicValid = bicCheck.valid
			if (iban) {
				assessment.sourceRefs.push({
					sourceType: "invoice",
					recordId: assessment.invoiceId,
					field: "vendorIban",
					rawExcerpt: `IBAN ${iban}: ${ibanCheck.valid ? "Mod-97 VALID" : ibanCheck.reason}`,
				})
			}
		}

		return {
			iban: iban ?? null,
			ibanValid: ibanCheck.valid,
			ibanIssue: ibanCheck.reason ?? null,
			bic: bic ?? null,
			bicValid: bicCheck.valid,
			bicIssue: bicCheck.reason ?? null,
			summary: ibanCheck.valid && bicCheck.valid
				? `IBAN/BIC checks VALID`
				: `Invalid banking identifier (${ibanCheck.reason ?? bicCheck.reason}); repair fee risk!`,
		}
	},
}

export const computeTaxWithholdingTool: Tool = {
	type: "function",
	name: "compute_tax_withholding",
	description: "Compute exact integer-cents tax withholding from gross minor amount and withholdingTaxRateBps.",
	parameters: {
		type: "object",
		properties: {
			caseId: { type: "string" },
			grossMinor: { type: "number" },
			currency: { type: "string" },
			withholdingTaxRateBps: { type: "number" },
		},
	},
	strict: false,
	invoke: async (rawArgs: unknown) => {
		const args = TaxSchema.parse(rawArgs)
		const state = resolveRuntime().state
		const inv = args.caseId ? state.casesById.get(args.caseId)?.invoice : undefined
		const grossMinor = args.grossMinor ?? inv?.expectedAmount.amountMinor ?? 0
		const currency = args.currency ?? inv?.expectedAmount.currency ?? "USD"
		const assessment = args.caseId ? ensureTermsAssessment(args.caseId) : undefined
		const bps = args.withholdingTaxRateBps ?? assessment?.withholdingTaxRateBps ?? inv?.withholdingTaxRateBps ?? 0
		const withholdingTaxMinor = computeTaxWithholding(grossMinor, bps)

		if (args.caseId) {
			const caseAssessment = ensureTermsAssessment(args.caseId)
			caseAssessment.withholdingTaxMinor = withholdingTaxMinor
		}

		return {
			grossMinor,
			currency,
			withholdingTaxRateBps: bps,
			withholdingTaxSource: assessment?.withholdingTaxSource,
			taxCountry: assessment?.taxCountry,
			taxPolicyVersionId: assessment?.taxPolicyVersionId,
			withholdingTaxMinor,
			withholdingFormatted: formatMoney(withholdingTaxMinor, currency),
			summary: `Withholding tax (${bps} bps): ${formatMoney(withholdingTaxMinor, currency)}`,
		}
	},
}

export const evaluateFeeClauseTool: Tool = {
	type: "function",
	name: "evaluate_fee_clause",
	description: "Compare contracted OUR/SHA/BEN fee bearer against SWIFT :71A: and :71G: receiver deductions.",
	parameters: {
		type: "object",
		properties: {
			caseId: { type: "string" },
			invoiceBearer: { type: "string", enum: ["OUR", "SHA", "BEN"] },
			wireBearer: { type: "string", enum: ["OUR", "SHA", "BEN"] },
			receiverChargesCount: { type: "number" },
		},
		required: ["caseId"],
	},
	strict: false,
	invoke: async (rawArgs: unknown) => {
		const args = ClauseSchema.parse(rawArgs)
		const caseId = args.caseId ?? "CASE-001"
		const state = resolveRuntime().state
		const c = state.casesById.get(caseId)
		const assessment = ensureTermsAssessment(caseId)

		const invoiceBearer: ChargeBearerClause =
			args.invoiceBearer ?? c?.invoice?.contractedChargeBearer ?? "SHA"
		const wireBearer: ChargeBearerClause = args.wireBearer ?? c?.wire.chargeBearer ?? invoiceBearer
		const receiverCount =
			args.receiverChargesCount ??
			((c?.wire.receiverCharges.length ?? 0) + (c?.wire.repairFee ? 1 : 0))

		const isOur = invoiceBearer === "OUR" || wireBearer === "OUR"
		const breachDetected = isOur && receiverCount > 0
		const bearerMismatch = invoiceBearer !== wireBearer

		assessment.clauseBreachDetected = breachDetected
		assessment.clauseSummary = breachDetected
			? `POTENTIAL DISCREPANCY: Submitted invoice terms specify ${invoiceBearer}, submitted wire records ${wireBearer}, and ${receiverCount} receiver deduction(s). Confirm against the original contract and bank statement.`
				: bearerMismatch
					? `POTENTIAL BEARER MISMATCH: Submitted invoice terms specify ${invoiceBearer}; submitted wire records ${wireBearer}. Confirm against the original contract and bank statement.`
					: `No fee-bearer discrepancy calculated from submitted records (${invoiceBearer}). Confirm against the original contract and bank statement.`

		state.termsByCaseId.set(caseId, assessment)

		return {
			caseId,
			invoiceBearer,
			wireBearer,
			receiverChargesCount: receiverCount,
			clauseBreachDetected: breachDetected,
			bearerMismatch,
			summary: assessment.clauseSummary,
		}
	},
}

export const termsTools: Tool[] = [
	getInvoiceRecordTool,
	verifyInvoiceLineItemsTool,
	validateIbanBicFormatTool,
	computeTaxWithholdingTool,
	evaluateFeeClauseTool,
]
