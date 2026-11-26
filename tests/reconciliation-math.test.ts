import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import {
	computeCentProofVarianceMinor,
	computeFxSpread,
	computeRecoverableOurViolationMinor,
	computeTaxWithholding,
	convertMinorUnits,
} from "../src/core/money"
import type { SettlementCase } from "../src/core/types"

test("Integer-cents reconciliation catches OUR fee violations and short-pay variance with zero float drift", () => {
	const fallback = JSON.parse(
		readFileSync(resolve(process.cwd(), "data/fallback-rates.json"), "utf8"),
	) as { historical: Record<string, Record<string, number>> }
	const rates = fallback.historical["2026-11-24"]
	const rate = rates.EUR_USD
	assert.ok(rate > 0, "Expected historical ECB rate for EUR_USD")

	const fx = computeFxSpread({
		instructedGrossMinor: 500000, // €5,000.00
		instructedCurrency: "EUR",
		settledMinor: 519000, // $5,190.00
		settledCurrency: "USD",
		normalizedReceiverChargesMinor: 4500, // $45.00
		normalizedRepairFeeMinor: 0,
		normalizedPlatformFeeMinor: 0,
		midMarketRate: rate,
		bankAppliedRate: 1.047,
	})

	const variance = computeCentProofVarianceMinor({
		midMarketExpectedMinor: fx.midMarketExpectedMinor,
		fxSpreadLossMinor: fx.fxSpreadLossMinor,
		deductedFeesMinor: 4500,
		withholdingTaxMinor: 0,
		netSettledMinor: 519000,
	})

	const recoverable = computeRecoverableOurViolationMinor({
		contractedBearer: "OUR",
		wireBearer: "OUR",
		normalizedReceiverChargesMinor: 4500,
		normalizedRepairFeeMinor: 0,
	})

	assert.equal(fx.fxSpreadLossMinor, 24650)
	assert.equal(recoverable, 4500)
	assert.equal(variance, 0)
})

test("Cross-currency withholding tax preserves exact zero-drift balance conservation", () => {
	const grossEurMinor = 100000 // €1,000.00
	const whtBps = 1000 // 10% = €100.00
	const ecbRate = 1.0963
	const bankRate = 1.05
	const feeUsdMinor = 2000 // $20.00

	const taxEurMinor = computeTaxWithholding(grossEurMinor, whtBps) // 10000 EUR cents
	const taxUsdMinor = convertMinorUnits(taxEurMinor, "EUR", "USD", ecbRate) // 10963 USD cents
	const settledUsdMinor =
		convertMinorUnits(grossEurMinor, "EUR", "USD", bankRate) - feeUsdMinor - taxUsdMinor

	const fxWithRate = computeFxSpread({
		instructedGrossMinor: grossEurMinor,
		instructedCurrency: "EUR",
		settledMinor: settledUsdMinor,
		settledCurrency: "USD",
		normalizedReceiverChargesMinor: feeUsdMinor,
		normalizedRepairFeeMinor: 0,
		normalizedPlatformFeeMinor: 0,
		normalizedWithholdingTaxMinor: taxUsdMinor,
		midMarketRate: ecbRate,
		bankAppliedRate: bankRate,
	})
	const varianceWithRate = computeCentProofVarianceMinor({
		midMarketExpectedMinor: fxWithRate.midMarketExpectedMinor,
		fxSpreadLossMinor: fxWithRate.fxSpreadLossMinor,
		deductedFeesMinor: feeUsdMinor,
		withholdingTaxMinor: taxUsdMinor,
		netSettledMinor: settledUsdMinor,
	})
	assert.equal(varianceWithRate, 0)

	// Without disclosed bankAppliedRate, tax must NOT be misclassified into FX spread
	const fxNoRate = computeFxSpread({
		instructedGrossMinor: grossEurMinor,
		instructedCurrency: "EUR",
		settledMinor: settledUsdMinor,
		settledCurrency: "USD",
		normalizedReceiverChargesMinor: feeUsdMinor,
		normalizedRepairFeeMinor: 0,
		normalizedPlatformFeeMinor: 0,
		normalizedWithholdingTaxMinor: taxUsdMinor,
		midMarketRate: ecbRate,
	})
	assert.equal(fxNoRate.fxSpreadLossMinor, fxWithRate.fxSpreadLossMinor)
})
