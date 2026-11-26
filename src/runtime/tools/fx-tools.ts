import type { Tool } from "@mozaik-ai/core"
import { z } from "zod"
import { fetchEcbMidMarketRate } from "../../core/fx/frankfurter-client"
import { computeFxSpread, convertMinorUnits, formatMoney } from "../../core/money"
import type { FxAssessment, SourceRef } from "../../core/types"
import { resolveRuntime } from "../corridor-runtime"

const FetchRateSchema = z.object({
	caseId: z.string().optional(),
	fromCurrency: z.string().optional(),
	toCurrency: z.string().optional(),
	valueDate: z.string().optional(),
})

const NormalizeSchema = z.object({
	caseId: z.string().optional(),
	amountMinor: z.number().int().optional(),
	fromCurrency: z.string().optional(),
	toCurrency: z.string().optional(),
	rate: z.number().optional(),
})

const SpreadSchema = z.object({
	caseId: z.string(),
	instructedAmountMinor: z.number().int().optional(),
	instructedCurrency: z.string().optional(),
	settledCurrency: z.string().optional(),
	midMarketRate: z.number().optional(),
})

const BenchmarkSchema = z.object({
	caseId: z.string().optional(),
	corridor: z.string().optional(),
	channel: z.string().optional(),
	actualFeeMinor: z.number().int().optional(),
	grossMinor: z.number().int().optional(),
})

export const fetchEcbMidMarketRateTool: Tool = {
	type: "function",
	name: "fetch_ecb_mid_market_rate",
	description: "Fetch official ECB mid-market FX rate for valueDate from api.frankfurter.app (with automatic bundled cache fallback).",
	parameters: {
		type: "object",
		properties: {
			caseId: { type: "string" },
			fromCurrency: { type: "string" },
			toCurrency: { type: "string" },
			valueDate: { type: "string" },
		},
	},
	strict: false,
	invoke: async (rawArgs: unknown) => {
		const args = FetchRateSchema.parse(rawArgs)
		const state = resolveRuntime().state
		const c = args.caseId ? state.casesById.get(args.caseId) : undefined
		const fromCurrency =
			args.fromCurrency ??
			c?.wire.instructedAmount?.currency ??
			c?.invoice?.expectedAmount.currency ??
			"EUR"
		const toCurrency = args.toCurrency ?? c?.wire.settledAmount.currency ?? "USD"
		const valueDate = args.valueDate ?? c?.wire.valueDate ?? "2026-11-24"

		const rateRecord = await fetchEcbMidMarketRate({ fromCurrency, toCurrency, valueDate })
		if (args.caseId) {
			state.fxCache.set(`${args.caseId}:${fromCurrency}->${toCurrency}`, rateRecord)
		}

		const ref: SourceRef = {
			sourceType: "ecb_fx",
			recordId: `ECB-${rateRecord.ecbRateDate}`,
			field: `${rateRecord.from}/${rateRecord.to}`,
			rawExcerpt: `ECB ${rateRecord.ecbRateDate}: 1 ${rateRecord.from} = ${rateRecord.midMarketRate} ${rateRecord.to} (${rateRecord.source})`,
			url: rateRecord.sourceUrl,
		}

		return {
			...rateRecord,
			sourceRefs: [ref],
			summary: `ECB ${rateRecord.ecbRateDate} (${rateRecord.source}): 1 ${rateRecord.from} = ${rateRecord.midMarketRate} ${rateRecord.to}`,
		}
	},
}

export const normalizeCurrencyAmountTool: Tool = {
	type: "function",
	name: "normalize_currency_amount",
	description: "Safely convert integer minor units across currencies and decimal exponents (e.g., JPY 0-dec, USD/EUR 2-dec, KWD 3-dec).",
	parameters: {
		type: "object",
		properties: {
			caseId: { type: "string" },
			amountMinor: { type: "number" },
			fromCurrency: { type: "string" },
			toCurrency: { type: "string" },
			rate: { type: "number" },
		},
	},
	strict: false,
	invoke: async (rawArgs: unknown) => {
		const args = NormalizeSchema.parse(rawArgs)
		const state = resolveRuntime().state
		const c = args.caseId ? state.casesById.get(args.caseId) : undefined
		const fromCurrency =
			args.fromCurrency ?? c?.wire.instructedAmount?.currency ?? c?.invoice?.expectedAmount.currency ?? "EUR"
		const toCurrency = args.toCurrency ?? c?.wire.settledAmount.currency ?? "USD"
		const amountMinor =
			args.amountMinor ?? c?.wire.instructedAmount?.amountMinor ?? c?.invoice?.expectedAmount.amountMinor ?? 0
		const cached = args.caseId ? state.fxCache.get(`${args.caseId}:${fromCurrency}->${toCurrency}`) : undefined
		const rate =
			args.rate ??
			cached?.midMarketRate ??
			(await fetchEcbMidMarketRate({ fromCurrency, toCurrency, valueDate: c?.wire.valueDate ?? "2026-11-24" }))
				.midMarketRate

		const convertedMinor = convertMinorUnits(amountMinor, fromCurrency, toCurrency, rate)
		return {
			amountMinor,
			fromCurrency,
			toCurrency,
			rate,
			convertedMinor,
			convertedFormatted: formatMoney(convertedMinor, toCurrency),
			summary: `Normalized ${formatMoney(amountMinor, fromCurrency)} -> ${formatMoney(convertedMinor, toCurrency)} @ ${rate}`,
		}
	},
}

export const computeFxSpreadMinorTool: Tool = {
	type: "function",
	name: "compute_fx_spread_minor",
	description: "Compute exact midMarketExpectedMinor, fxSpreadLossMinor, and fxSpreadBps for a settlement case.",
	parameters: {
		type: "object",
		properties: {
			caseId: { type: "string" },
			instructedAmountMinor: { type: "number" },
			instructedCurrency: { type: "string" },
			settledCurrency: { type: "string" },
			midMarketRate: { type: "number" },
		},
		required: ["caseId"],
	},
	strict: false,
	invoke: async (rawArgs: unknown) => {
		const args = SpreadSchema.parse(rawArgs)
		const state = resolveRuntime().state
		const c = state.casesById.get(args.caseId)
		if (!c) return { error: `Unknown caseId ${args.caseId}` }

		const from =
			args.instructedCurrency ??
			c.wire.instructedAmount?.currency ??
			c.invoice?.expectedAmount.currency ??
			c.wire.settledAmount.currency
		const to = args.settledCurrency ?? c.wire.settledAmount.currency
		const grossMinor =
			args.instructedAmountMinor ??
			c.wire.instructedAmount?.amountMinor ??
			c.invoice?.expectedAmount.amountMinor ??
			c.wire.settledAmount.amountMinor

		const rateRecord =
			state.fxCache.get(`${args.caseId}:${from}->${to}`) ??
			(await fetchEcbMidMarketRate({ fromCurrency: from, toCurrency: to, valueDate: c.wire.valueDate }))
		const effectiveRate = args.midMarketRate ?? rateRecord.midMarketRate

		const feeRateIfNeeded = async (ccy: string) => {
			if (ccy.toUpperCase() === to.toUpperCase()) return 1
			const r = await fetchEcbMidMarketRate({ fromCurrency: ccy, toCurrency: to, valueDate: c.wire.valueDate })
			return r.midMarketRate
		}

		let receiverFeesMinor = 0
		for (const chg of c.wire.receiverCharges) {
			const r = await feeRateIfNeeded(chg.currency)
			receiverFeesMinor += convertMinorUnits(chg.amountMinor, chg.currency, to, r)
		}
		const repairFeeMinor = c.wire.repairFee
			? convertMinorUnits(c.wire.repairFee.amountMinor, c.wire.repairFee.currency, to, await feeRateIfNeeded(c.wire.repairFee.currency))
			: 0
		const platformFeeMinor = c.wire.platformFee
			? convertMinorUnits(c.wire.platformFee.amountMinor, c.wire.platformFee.currency, to, await feeRateIfNeeded(c.wire.platformFee.currency))
			: 0

		const spread = computeFxSpread({
			instructedGrossMinor: grossMinor,
			instructedCurrency: from,
			settledMinor: c.wire.settledAmount.amountMinor,
			settledCurrency: to,
			normalizedReceiverChargesMinor: receiverFeesMinor,
			normalizedRepairFeeMinor: repairFeeMinor,
			normalizedPlatformFeeMinor: platformFeeMinor,
			midMarketRate: effectiveRate,
			bankAppliedRate: c.wire.bankAppliedRate,
		})

		const corridorStatus: FxAssessment["corridorStatus"] =
			spread.fxSpreadBps <= 50 ? "TRANSPARENT" : spread.fxSpreadBps <= 200 ? "ELEVATED_SPREAD" : "HIGH_MARKUP"

		const refs: SourceRef[] = [
			{
				sourceType: "ecb_fx",
				recordId: `ECB-${rateRecord.ecbRateDate}`,
				field: `${from}/${to}`,
				rawExcerpt: `ECB ${rateRecord.ecbRateDate}: ${effectiveRate} (${rateRecord.source})`,
				url: rateRecord.sourceUrl,
			},
		]

		const assessment: FxAssessment = {
			caseId: args.caseId,
			rateRecord,
			midMarketExpectedMinor: spread.midMarketExpectedMinor,
			fxSpreadLossMinor: spread.fxSpreadLossMinor,
			fxSpreadBps: spread.fxSpreadBps,
			corridorBenchmarkBps: 35,
			corridorStatus,
			sourceRefs: refs,
			agentSummary: `ECB expected ${formatMoney(spread.midMarketExpectedMinor, to)}; hidden FX spread ${formatMoney(spread.fxSpreadLossMinor, to)} (${(spread.fxSpreadBps / 100).toFixed(2)}%)`,
		}
		state.fxByCaseId.set(args.caseId, assessment)

		return {
			caseId: args.caseId,
			midMarketExpectedMinor: spread.midMarketExpectedMinor,
			midMarketExpectedFormatted: formatMoney(spread.midMarketExpectedMinor, to),
			fxSpreadLossMinor: spread.fxSpreadLossMinor,
			fxSpreadFormatted: formatMoney(spread.fxSpreadLossMinor, to),
			fxSpreadBps: spread.fxSpreadBps,
			corridorStatus,
			sourceRefs: refs,
			summary: assessment.agentSummary,
		}
	},
}

export const benchmarkCorridorFeesTool: Tool = {
	type: "function",
	name: "benchmark_corridor_fees",
	description: "Benchmark observed corridor FX spread & wire/platform fees against transparent reference ranges (35 bps benchmark).",
	parameters: {
		type: "object",
		properties: {
			caseId: { type: "string" },
			corridor: { type: "string" },
			channel: { type: "string" },
			actualFeeMinor: { type: "number" },
			grossMinor: { type: "number" },
		},
	},
	strict: false,
	invoke: async (rawArgs: unknown) => {
		const args = BenchmarkSchema.parse(rawArgs)
		const state = resolveRuntime().state
		const fx = args.caseId ? state.fxByCaseId.get(args.caseId) : undefined
		const c = args.caseId ? state.casesById.get(args.caseId) : undefined
		const observedSpreadBps = fx?.fxSpreadBps ?? 0
		const benchmarkBps = c?.wire.platformName && c.wire.platformName !== "direct_bank" ? 50 : 35
		const excessBps = Math.max(0, observedSpreadBps - benchmarkBps)
		return {
			caseId: args.caseId ?? null,
			corridor:
				args.corridor ??
				`${c?.invoice?.expectedAmount.currency ?? "EUR"}->${c?.wire.settledAmount.currency ?? "USD"}`,
			channel: args.channel ?? c?.channelLabel ?? "Cross-Border Rail",
			observedSpreadBps,
			transparentBenchmarkBps: benchmarkBps,
			excessMarkupBps: excessBps,
			summary:
				excessBps > 0
					? `Observed ${observedSpreadBps} bps exceeds transparent ${benchmarkBps} bps benchmark by ${excessBps} bps.`
					: `Within transparent corridor benchmark (${observedSpreadBps} bps <= ${benchmarkBps} bps).`,
		}
	},
}

export const fxTools: Tool[] = [
	fetchEcbMidMarketRateTool,
	normalizeCurrencyAmountTool,
	computeFxSpreadMinorTool,
	benchmarkCorridorFeesTool,
]
