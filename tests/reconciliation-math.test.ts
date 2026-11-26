import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import {
	computeCentProofVarianceMinor,
	computeFxSpread,
	computeRecoverableOurViolationMinor,
	convertMinorUnits,
} from "../src/core/money"
import type { SettlementCase } from "../src/core/types"

test("All bundled scenarios satisfy exact integer-cents reconciliation rules", () => {
	const batch = JSON.parse(
		readFileSync(resolve(process.cwd(), "data/scenarios/black-friday-global-batch.json"), "utf8"),
	) as { cases: SettlementCase[] }
	const fallback = JSON.parse(
		readFileSync(resolve(process.cwd(), "data/fallback-rates.json"), "utf8"),
	) as { historical: Record<string, Record<string, number>> }
	const rates = fallback.historical["2026-11-24"]

	assert.equal(batch.cases.length, 6)

	for (const c of batch.cases) {
		const inv = c.invoice!
		const wire = c.wire
		const from = (wire.instructedAmount ?? inv.expectedAmount).currency
		const to = wire.settledAmount.currency
		const rate = from === to ? 1 : rates[`${from}_${to}`]
		assert.ok(rate > 0, `Expected historical rate for ${from}_${to}`)

		const normalizeFee = (amountMinor: number, ccy: string) =>
			ccy === to ? amountMinor : convertMinorUnits(amountMinor, ccy, to, rates[`${ccy}_${to}`])

		const receiverFeesMinor =
			wire.receiverCharges.reduce((s, f) => s + normalizeFee(f.amountMinor, f.currency), 0) +
			(wire.repairFee ? normalizeFee(wire.repairFee.amountMinor, wire.repairFee.currency) : 0)
		const platformFeeMinor = wire.platformFee
			? normalizeFee(wire.platformFee.amountMinor, wire.platformFee.currency)
			: 0

		const fx = computeFxSpread({
			instructedGrossMinor: (wire.instructedAmount ?? inv.expectedAmount).amountMinor,
			instructedCurrency: from,
			settledMinor: wire.settledAmount.amountMinor,
			settledCurrency: to,
			normalizedReceiverChargesMinor: wire.receiverCharges.reduce(
				(s, f) => s + normalizeFee(f.amountMinor, f.currency),
				0,
			),
			normalizedRepairFeeMinor: wire.repairFee ? normalizeFee(wire.repairFee.amountMinor, wire.repairFee.currency) : 0,
			normalizedPlatformFeeMinor: platformFeeMinor,
			midMarketRate: rate,
			bankAppliedRate: wire.bankAppliedRate,
		})

		const variance = computeCentProofVarianceMinor({
			midMarketExpectedMinor: fx.midMarketExpectedMinor,
			fxSpreadLossMinor: fx.fxSpreadLossMinor,
			deductedFeesMinor: receiverFeesMinor + platformFeeMinor,
			withholdingTaxMinor: 0,
			netSettledMinor: wire.settledAmount.amountMinor,
		})

		if (c.caseId === "CASE-002") {
			const recoverable = computeRecoverableOurViolationMinor({
				contractedBearer: inv.contractedChargeBearer,
				wireBearer: wire.chargeBearer,
				normalizedReceiverChargesMinor: 4500,
				normalizedRepairFeeMinor: 0,
			})
			assert.equal(fx.fxSpreadLossMinor, 24650)
			assert.equal(recoverable, 4500)
			assert.equal(variance, 0)
		} else if (c.caseId === "CASE-003") {
			// Intentionally carries €120.00 unexplained short-pay (12000 minor units)
			assert.equal(variance, 12000)
		} else {
			assert.equal(variance, 0, `${c.caseId} must reconcile to 0 unexplained variance`)
		}
	}
})
