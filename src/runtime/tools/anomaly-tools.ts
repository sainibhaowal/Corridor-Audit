import type { Tool } from "@mozaik-ai/core"
import { z } from "zod"
import { formatMoney } from "../../core/money"
import type { AnomalyAssessment, SourceRef } from "../../core/types"
import { resolveRuntime } from "../corridor-runtime"

const CaseIdSchema = z.object({ caseId: z.string() })
const BankChangeSchema = z.object({
	caseId: z.string().optional(),
	vendorName: z.string().optional(),
	wireAccountRef: z.string().optional(),
	expectedAccountRef: z.string().optional(),
})

function ensureAnomaly(caseId: string): AnomalyAssessment {
	const state = resolveRuntime().state
	const existing = state.anomalyByCaseId.get(caseId)
	if (existing) return existing
	const fresh: AnomalyAssessment = {
		caseId,
		classification: "NONE",
		duplicateWireIds: [],
		duplicateCount: 1,
		vendorBankChanged: false,
		complianceFlags: [],
		sourceRefs: [],
	}
	state.anomalyByCaseId.set(caseId, fresh)
	return fresh
}

export const scanDuplicateWiresTool: Tool = {
	type: "function",
	name: "scan_duplicate_wires",
	description: "Scan wires in CorridorState for duplicate invoice references, identical amount+sender within 48h, or split installments.",
	parameters: {
		type: "object",
		properties: { caseId: { type: "string" } },
		required: ["caseId"],
	},
	strict: false,
	invoke: async (rawArgs: unknown) => {
		const { caseId } = CaseIdSchema.parse(rawArgs)
		const state = resolveRuntime().state
		const c = state.casesById.get(caseId)
		if (!c) return { error: `Unknown caseId ${caseId}` }

		const assessment = ensureAnomaly(caseId)
		const group = [c.wire, ...(c.candidateWires ?? [])]
		const refs: SourceRef[] = group.map((w) => ({
			sourceType: w.format === "mt103" ? "mt103" : "bank_csv",
			recordId: w.wireId,
			field: "duplicate_scan",
			rawExcerpt: `${w.wireId} (${w.transactionRef ?? w.wireId}): ${formatMoney(w.settledAmount.amountMinor, w.settledAmount.currency)} for ${w.remittanceInfo || "N/A"}`,
		}))

		if (group.length <= 1) {
			assessment.classification = "NONE"
			assessment.duplicateCount = 1
			assessment.duplicateWireIds = [c.wire.wireId]
			assessment.sourceRefs.push(...refs)
			return {
				caseId,
				classification: "NONE",
				duplicateCount: 1,
				wireIds: [c.wire.wireId],
				sourceRefs: refs,
				summary: `Single wire ${c.wire.wireId}; no duplicate feed detected.`,
			}
		}

		const expectedMinor = c.invoice?.expectedAmount.amountMinor ?? c.wire.settledAmount.amountMinor
		const allEqualFull = group.every((w) => w.settledAmount.amountMinor === expectedMinor)
		const sumMinor = group.reduce((s, w) => s + w.settledAmount.amountMinor, 0)
		const isSplit = !allEqualFull && sumMinor === expectedMinor

		assessment.classification = allEqualFull
			? "TRUE_DUPLICATE"
			: isSplit
				? "SPLIT_INSTALLMENT"
				: "COLLISION_FALSE_POSITIVE"
		assessment.duplicateCount = group.length
		assessment.duplicateWireIds = group.map((w) => w.wireId)
		assessment.sourceRefs.push(...refs)
		state.anomalyByCaseId.set(caseId, assessment)

		return {
			caseId,
			classification: assessment.classification,
			duplicateCount: group.length,
			wireIds: assessment.duplicateWireIds,
			sourceRefs: refs,
			summary: `Detected ${group.length} matching wires (${assessment.duplicateWireIds.join(", ")}) classified as ${assessment.classification}.`,
		}
	},
}

export const checkVendorBankChangeTool: Tool = {
	type: "function",
	name: "check_vendor_bank_change",
	description: "Compare incoming beneficiary IBAN/account reference against prior vendor records to flag Business Email Compromise (BEC) risk.",
	parameters: {
		type: "object",
		properties: {
			caseId: { type: "string" },
			vendorName: { type: "string" },
			wireAccountRef: { type: "string" },
			expectedAccountRef: { type: "string" },
		},
	},
	strict: false,
	invoke: async (rawArgs: unknown) => {
		const args = BankChangeSchema.parse(rawArgs)
		const state = resolveRuntime().state
		const c = args.caseId ? state.casesById.get(args.caseId) : undefined
		const wireRef = args.wireAccountRef ?? c?.wire.beneficiaryAccountRef
		const expectedRef = args.expectedAccountRef ?? c?.invoice?.priorAccountRef ?? c?.invoice?.vendorIban
		const changed = Boolean(wireRef && expectedRef && wireRef !== expectedRef)

		if (args.caseId) {
			const assessment = ensureAnomaly(args.caseId)
			assessment.vendorBankChanged = changed
			assessment.bankChangeDetails = changed
				? `Account changed from ${expectedRef} to ${wireRef}`
				: undefined
			state.anomalyByCaseId.set(args.caseId, assessment)
		}

		return {
			vendorName: args.vendorName ?? c?.invoice?.vendorOrClient ?? "Unknown",
			wireAccountRef: wireRef ?? null,
			expectedAccountRef: expectedRef ?? null,
			vendorBankChanged: changed,
			summary: changed
				? `BEC ALERT: Beneficiary account changed (${expectedRef} -> ${wireRef})`
				: "Vendor bank account matches prior record (no BEC mismatch).",
		}
	},
}

export const screenCorridorComplianceTool: Tool = {
	type: "function",
	name: "screen_corridor_compliance",
	description: "Run deterministic corridor compliance screening (structuring near reporting thresholds, off-hours wire timing, synthetic watchlist).",
	parameters: {
		type: "object",
		properties: { caseId: { type: "string" } },
		required: ["caseId"],
	},
	strict: false,
	invoke: async (rawArgs: unknown) => {
		const { caseId } = CaseIdSchema.parse(rawArgs)
		const state = resolveRuntime().state
		const c = state.casesById.get(caseId)
		if (!c) return { error: `Unknown caseId ${caseId}` }

		const flags: string[] = []
		if (c.wire.offHours) flags.push("OFF_HOURS_EXECUTION")
		if (c.wire.watchlistTag) flags.push(`WATCHLIST_TAG:${c.wire.watchlistTag}`)
		if (c.wire.settledAmount.amountMinor >= 950000 && c.wire.settledAmount.amountMinor < 1000000) {
			flags.push("THRESHOLD_PROXIMITY_REVIEW")
		}

		const assessment = ensureAnomaly(caseId)
		assessment.complianceFlags = flags
		state.anomalyByCaseId.set(caseId, assessment)

		return {
			caseId,
			complianceFlags: flags,
			passed: flags.length === 0,
			summary: flags.length === 0 ? "All compliance checks CLEAR." : `Compliance flags raised: ${flags.join(", ")}`,
		}
	},
}

export const anomalyTools: Tool[] = [
	scanDuplicateWiresTool,
	checkVendorBankChangeTool,
	screenCorridorComplianceTool,
]
