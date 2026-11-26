import type { Tool } from "@mozaik-ai/core"
import { z } from "zod"
import { fetchEcbMidMarketRate } from "../../core/fx/frankfurter-client"
import { convertMinorUnits, formatMoney } from "../../core/money"
import { parseCamt053Xml } from "../../core/parsers/camt053-parser"
import { parseSingleMt103 } from "../../core/parsers/mt103-parser"
import type { OrphanMatchCandidate, SourceRef, WireAssessment } from "../../core/types"
import { resolveRuntime } from "../corridor-runtime"

const CaseIdSchema = z.object({ caseId: z.string() })
const WireIdSchema = z.object({ caseId: z.string().optional(), wireId: z.string().optional() })
const InvoiceIdSchema = z.object({ caseId: z.string().optional(), invoiceId: z.string().optional() })

function tokenSet(text?: string): Set<string> {
	if (!text) return new Set()
	return new Set(
		text
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, " ")
			.split(/\s+/)
			.filter((t) => t.length >= 3),
	)
}

function ensureWireAssessment(caseId: string): WireAssessment | undefined {
	const state = resolveRuntime().state
	const existing = state.wireByCaseId.get(caseId)
	if (existing) return existing
	const c = state.casesById.get(caseId)
	if (!c) return undefined
	const fresh: WireAssessment = {
		caseId,
		wireId: c.wire.wireId,
		matchedInvoiceId: c.invoice?.invoiceId,
		isOrphan: !c.wire.remittanceInfo || c.wire.remittanceInfo.trim().length === 0,
		normalizedSenderFeesMinor: 0,
		normalizedReceiverFeesMinor: 0,
		normalizedRepairFeeMinor: 0,
		normalizedPlatformFeeMinor: 0,
		normalizedTotalDeductedFeesMinor: 0,
		splitPaymentCount: 1 + (c.candidateWires?.length ?? 0),
		splitTotalSettledMinor: c.wire.settledAmount.amountMinor,
		sourceRefs: [...(c.wire.sourceRefs ?? [])],
	}
	state.wireByCaseId.set(caseId, fresh)
	return fresh
}

export const parseWireRecordTool: Tool = {
	type: "function",
	name: "parse_wire_record",
	description: "Parse wire/payout advice (SWIFT MT103, bank/platform CSV, ISO 20022 camt.053 XML) for caseId with exact SourceRefs.",
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

		let wire = c.wire
		if (wire.rawText && wire.format === "mt103" && (!wire.sourceRefs || wire.sourceRefs.length === 0)) {
			const parsed = parseSingleMt103(wire.rawText)
			wire = { ...wire, sourceRefs: parsed.sourceRefs }
			c.wire = wire
		} else if (wire.rawText && wire.format === "camt053" && (!wire.sourceRefs || wire.sourceRefs.length === 0)) {
			const parsed = parseCamt053Xml(wire.rawText)[0]
			if (parsed) {
				wire = { ...wire, sourceRefs: parsed.sourceRefs }
				c.wire = wire
			}
		}

		const refs: SourceRef[] = [
			...(wire.sourceRefs ?? []),
			{
				sourceType: wire.format === "platform_payout" ? "platform_csv" : wire.format === "camt053" ? "camt053" : wire.format === "bank_csv" ? "bank_csv" : "mt103",
				recordId: wire.wireId,
				field: "settledAmount",
				rawExcerpt: `:32A:/Net settled ${formatMoney(wire.settledAmount.amountMinor, wire.settledAmount.currency)} on ${wire.valueDate}`,
			},
		]

		const existing = ensureWireAssessment(caseId)!
		existing.sourceRefs = refs
		state.wireByCaseId.set(caseId, existing)

		return {
			caseId,
			wireId: wire.wireId,
			format: wire.format,
			platformName: wire.platformName ?? "direct_bank",
			settledAmountMinor: wire.settledAmount.amountMinor,
			settledFormatted: formatMoney(wire.settledAmount.amountMinor, wire.settledAmount.currency),
			settledCurrency: wire.settledAmount.currency,
			chargeBearer: wire.chargeBearer ?? null,
			remittanceInfo: wire.remittanceInfo ?? "",
			isOrphan: existing.isOrphan,
			sourceRefs: refs,
			summary: `Parsed ${wire.wireId} (${wire.format}): landed ${formatMoney(wire.settledAmount.amountMinor, wire.settledAmount.currency)}, :71A:=${wire.chargeBearer ?? "N/A"}, :70:=${wire.remittanceInfo || "<STRIPPED>"}`,
		}
	},
}

export const detectRepairAndLiftingFeesTool: Tool = {
	type: "function",
	name: "detect_repair_and_lifting_fees",
	description: "Isolate and normalize :71F: sender fees, :71G: receiver lifting fees, ISO 20022 repair fees, and platform withdrawal fees.",
	parameters: {
		type: "object",
		properties: {
			caseId: { type: "string" },
			wireId: { type: "string" },
		},
	},
	strict: false,
	invoke: async (rawArgs: unknown) => {
		const args = WireIdSchema.parse(rawArgs)
		const state = resolveRuntime().state
		const c =
			(args.caseId ? state.casesById.get(args.caseId) : undefined) ??
			[...state.casesById.values()].find((item) => item.wire.wireId === args.wireId)
		if (!c) return { error: "Case/Wire not found" }

		const wire = c.wire
		const targetCcy = wire.settledAmount.currency
		const norm = async (amountMinor: number, ccy: string) => {
			if (ccy.toUpperCase() === targetCcy.toUpperCase()) return amountMinor
			const r = await fetchEcbMidMarketRate({ fromCurrency: ccy, toCurrency: targetCcy, valueDate: wire.valueDate })
			return convertMinorUnits(amountMinor, ccy, targetCcy, r.midMarketRate)
		}

		let senderFeesMinor = 0
		for (const f of wire.senderCharges) senderFeesMinor += await norm(f.amountMinor, f.currency)

		let receiverFeesMinor = 0
		for (const f of wire.receiverCharges) receiverFeesMinor += await norm(f.amountMinor, f.currency)

		const repairFeeMinor = wire.repairFee ? await norm(wire.repairFee.amountMinor, wire.repairFee.currency) : 0
		const platformFeeMinor = wire.platformFee ? await norm(wire.platformFee.amountMinor, wire.platformFee.currency) : 0
		const totalDeductedMinor = receiverFeesMinor + repairFeeMinor + platformFeeMinor

		const assessment = ensureWireAssessment(c.caseId)
		if (assessment) {
			assessment.normalizedSenderFeesMinor = senderFeesMinor
			assessment.normalizedReceiverFeesMinor = receiverFeesMinor
			assessment.normalizedRepairFeeMinor = repairFeeMinor
			assessment.normalizedPlatformFeeMinor = platformFeeMinor
			assessment.normalizedTotalDeductedFeesMinor = totalDeductedMinor
			if (receiverFeesMinor > 0) {
				assessment.sourceRefs.push({
					sourceType: wire.format === "mt103" ? "mt103" : "bank_csv",
					recordId: wire.wireId,
					field: ":71G:",
					rawExcerpt: `Receiver/intermediary deducted ${formatMoney(receiverFeesMinor, targetCcy)}`,
				})
			}
			if (repairFeeMinor > 0) {
				assessment.sourceRefs.push({
					sourceType: wire.format === "camt053" ? "camt053" : "mt103",
					recordId: wire.wireId,
					field: "repairFee",
					rawExcerpt: `ISO repair fee ${formatMoney(repairFeeMinor, targetCcy)}`,
				})
			}
			if (platformFeeMinor > 0) {
				assessment.sourceRefs.push({
					sourceType: "platform_csv",
					recordId: wire.wireId,
					field: "platformFee",
					rawExcerpt: `Platform fee ${formatMoney(platformFeeMinor, targetCcy)}`,
				})
			}
			state.wireByCaseId.set(c.caseId, assessment)
		}

		return {
			caseId: c.caseId,
			wireId: wire.wireId,
			targetCurrency: targetCcy,
			senderFeesMinor,
			receiverFeesMinor,
			repairFeeMinor,
			platformFeeMinor,
			totalDeductedFeesMinor: totalDeductedMinor,
			summary: `Fees isolated in ${targetCcy}: receiver=${formatMoney(receiverFeesMinor, targetCcy)}, repair=${formatMoney(repairFeeMinor, targetCcy)}, platform=${formatMoney(platformFeeMinor, targetCcy)}`,
		}
	},
}

export const matchOrphanWireTool: Tool = {
	type: "function",
	name: "match_orphan_wire",
	description: "Deterministically match a wire with stripped :70:/memo against open invoices using sender name, value date, and amount tolerance.",
	parameters: {
		type: "object",
		properties: {
			caseId: { type: "string" },
			wireId: { type: "string" },
		},
	},
	strict: false,
	invoke: async (rawArgs: unknown) => {
		const args = WireIdSchema.parse(rawArgs)
		const state = resolveRuntime().state
		const c =
			(args.caseId ? state.casesById.get(args.caseId) : undefined) ??
			[...state.casesById.values()].find((item) => item.wire.wireId === args.wireId)
		if (!c) return { error: "Case/Wire not found" }

		const wire = c.wire
		if (wire.remittanceInfo && wire.remittanceInfo.trim().length > 0) {
			const existingInvId = c.invoice?.invoiceId
			const assessment = ensureWireAssessment(c.caseId)
			if (assessment && existingInvId && !assessment.matchedInvoiceId) {
				assessment.matchedInvoiceId = existingInvId
			}
			return {
				caseId: c.caseId,
				wireId: wire.wireId,
				matchedCandidate: existingInvId
					? {
							invoiceId: existingInvId,
							vendorOrClient: c.invoice?.vendorOrClient ?? wire.senderName ?? "Unknown",
							score: 100,
							reasons: [`Explicit remittance reference :70:="${wire.remittanceInfo}"`],
						}
					: null,
				summary: `Wire ${wire.wireId} carries explicit remittance reference "${wire.remittanceInfo}" — orphan matching not needed.`,
			}
		}

		const wireTokens = tokenSet(wire.senderName)
		let best: OrphanMatchCandidate | undefined

		for (const inv of state.rawInvoices) {
			let score = 0
			const reasons: string[] = []

			// 1. Sender token overlap
			const invTokens = tokenSet(inv.vendorOrClient)
			let overlap = 0
			for (const t of wireTokens) {
				if (invTokens.has(t)) overlap++
			}
			if (overlap > 0) {
				const tokenScore = Math.min(45, overlap * 15)
				score += tokenScore
				reasons.push(`Sender token match (${overlap} tokens: ${inv.vendorOrClient})`)
			}

			// 2. Date window (0-7 days from issueDate)
			const dWire = Date.parse(wire.valueDate)
			const dInv = Date.parse(inv.issueDate)
			if (Number.isFinite(dWire) && Number.isFinite(dInv)) {
				const diffDays = Math.abs(dWire - dInv) / 86_400_000
				if (diffDays <= 7) {
					score += 25
					reasons.push(`Value date within ${diffDays.toFixed(0)} days`)
				}
			}

			// 3. Instructed / converted net amount tolerance (0-10%)
			const rate =
				inv.expectedAmount.currency === wire.settledAmount.currency
					? 1
					: (await fetchEcbMidMarketRate({
							fromCurrency: inv.expectedAmount.currency,
							toCurrency: wire.settledAmount.currency,
							valueDate: wire.valueDate,
						})).midMarketRate
			const expectedTarget = convertMinorUnits(
				inv.expectedAmount.amountMinor,
				inv.expectedAmount.currency,
				wire.settledAmount.currency,
				rate,
			)
			const diffPct = expectedTarget > 0 ? Math.abs(expectedTarget - wire.settledAmount.amountMinor) / expectedTarget : 1
			if (diffPct <= 0.1) {
				score += 30
				reasons.push(`Amount within ${(diffPct * 100).toFixed(2)}% corridor tolerance`)
			}

			if (!best || score > best.score) {
				best = { invoiceId: inv.invoiceId, vendorOrClient: inv.vendorOrClient, score, reasons }
			}
		}

		const assessment = ensureWireAssessment(c.caseId)
		if (assessment && best && best.score >= 50) {
			assessment.matchedInvoiceId = best.invoiceId
			assessment.orphanMatch = best
			assessment.sourceRefs.push({
				sourceType: "invoice",
				recordId: best.invoiceId,
				field: "orphan_match",
				rawExcerpt: `Matched stripped wire ${wire.wireId} -> ${best.invoiceId} (score ${best.score}/100: ${best.reasons.join("; ")})`,
			})
			state.wireByCaseId.set(c.caseId, assessment)
		}

		return {
			caseId: c.caseId,
			wireId: wire.wireId,
			matchedCandidate: best ?? null,
			summary: best
				? `Matched orphan wire ${wire.wireId} to ${best.invoiceId} (${best.score}/100): ${best.reasons.join(", ")}`
				: "No matching open invoice found within tolerance.",
		}
	},
}

export const reconcileSplitPaymentsTool: Tool = {
	type: "function",
	name: "reconcile_split_payments",
	description: "Aggregate multiple partial wires or duplicate feeds referencing the same invoiceId in integer minor units.",
	parameters: {
		type: "object",
		properties: {
			caseId: { type: "string" },
			invoiceId: { type: "string" },
		},
	},
	strict: false,
	invoke: async (rawArgs: unknown) => {
		const args = InvoiceIdSchema.parse(rawArgs)
		const state = resolveRuntime().state
		const c = args.caseId ? state.casesById.get(args.caseId) : undefined
		const invoiceId = args.invoiceId ?? c?.invoice?.invoiceId ?? ""

		const matching = c
			? [c.wire, ...(c.candidateWires ?? [])]
			: state.rawWires.filter((w) => (w.remittanceInfo ?? "").includes(invoiceId))

		const totalSettledMinor = matching.reduce((sum, w) => sum + w.settledAmount.amountMinor, 0)
		const currency = matching[0]?.settledAmount.currency ?? "USD"
		if (c) {
			const assessment = ensureWireAssessment(c.caseId)
			if (assessment) {
				assessment.splitPaymentCount = matching.length
				assessment.splitTotalSettledMinor = totalSettledMinor
			}
		}

		return {
			invoiceId,
			wireCount: matching.length,
			wireIds: matching.map((w) => w.wireId),
			totalSettledMinor,
			totalSettledFormatted: formatMoney(totalSettledMinor, currency),
			summary: `Found ${matching.length} wire(s) referencing ${invoiceId} totaling ${formatMoney(totalSettledMinor, currency)}`,
		}
	},
}

export const wireTools: Tool[] = [
	parseWireRecordTool,
	detectRepairAndLiftingFeesTool,
	matchOrphanWireTool,
	reconcileSplitPaymentsTool,
]
