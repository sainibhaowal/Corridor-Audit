import type { ChargeBearerClause, CurrencyCode, InvoiceLineItem, Money } from "./types"

export const MINOR_UNIT_EXPONENTS: Record<string, number> = {
	JPY: 0,
	KRW: 0,
	VND: 0,
	BHD: 3,
	KWD: 3,
	OMR: 3,
	JOD: 3,
	TND: 3,
}

export function getMinorDigits(currency: CurrencyCode): number {
	const code = currency.trim().toUpperCase()
	return MINOR_UNIT_EXPONENTS[code] ?? 2
}

export function toMinorUnits(majorAmount: number, currency: CurrencyCode): number {
	const factor = 10 ** getMinorDigits(currency)
	return Math.round(majorAmount * factor)
}

export function parseDecimalStringToMinor(raw: string, currency: CurrencyCode): number {
	const cleaned = raw.trim().replace(/[^0-9.,-]/g, "")
	if (!cleaned) return 0

	// Support SWIFT European comma decimals ("5190,00") vs English ("5,190.00")
	let normalized = cleaned
	const hasComma = cleaned.includes(",")
	const hasDot = cleaned.includes(".")
	if (hasComma && hasDot) {
		if (cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")) {
			normalized = cleaned.replace(/\./g, "").replace(",", ".")
		} else {
			normalized = cleaned.replace(/,/g, "")
		}
	} else if (hasComma) {
		const decimalsAfterComma = cleaned.length - cleaned.lastIndexOf(",") - 1
		normalized = decimalsAfterComma <= 3 ? cleaned.replace(",", ".") : cleaned.replace(/,/g, "")
	}

	const num = Number(normalized)
	if (!Number.isFinite(num)) return 0
	return toMinorUnits(num, currency)
}

export function formatMoney(amountMinor: number, currency: CurrencyCode): string {
	const code = currency.trim().toUpperCase()
	const digits = getMinorDigits(code)
	const factor = 10 ** digits
	const value = amountMinor / factor
	const sign = amountMinor < 0 ? "-" : ""
	const absStr = Math.abs(value).toLocaleString("en-US", {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits,
	})

	const symbolMap: Record<string, string> = {
		USD: "$",
		EUR: "€",
		GBP: "£",
		JPY: "¥",
	}
	const sym = symbolMap[code]
	return sym ? `${sign}${sym}${absStr}` : `${sign}${absStr} ${code}`
}

/**
 * Converts integer minor units between currencies safely across different
 * decimal exponents (e.g., USD 2 decimals <-> JPY 0 decimals <-> KWD 3 decimals).
 */
export function convertMinorUnits(
	amountMinor: number,
	fromCurrency: CurrencyCode,
	toCurrency: CurrencyCode,
	rate: number,
): number {
	const fromUpper = fromCurrency.trim().toUpperCase()
	const toUpper = toCurrency.trim().toUpperCase()
	if (fromUpper === toUpper) return amountMinor

	const fromDigits = getMinorDigits(fromUpper)
	const toDigits = getMinorDigits(toUpper)
	const scale = 10 ** (toDigits - fromDigits)
	return Math.round(amountMinor * scale * rate)
}

export function normalizeMoneyToCurrency(
	money: Money | undefined,
	targetCurrency: CurrencyCode,
	ratesToTarget: Record<string, number>,
): number {
	if (!money || money.amountMinor === 0) return 0
	const from = money.currency.trim().toUpperCase()
	const target = targetCurrency.trim().toUpperCase()
	if (from === target) return money.amountMinor

	const rate = ratesToTarget[from]
	if (!rate || !Number.isFinite(rate)) {
		throw new Error(`Missing FX conversion rate from ${from} to ${target}`)
	}
	return convertMinorUnits(money.amountMinor, from, target, rate)
}

export function computeTaxWithholding(grossMinor: number, withholdingTaxRateBps: number): number {
	if (withholdingTaxRateBps <= 0 || grossMinor <= 0) return 0
	return Math.round((grossMinor * withholdingTaxRateBps) / 10000)
}

export function computeInvoiceLineItemsTotal(
	lineItems: InvoiceLineItem[],
	taxMinor = 0,
	discountMinor = 0,
): { computedMinor: number; mismatchExists: boolean } {
	let sum = 0
	let mismatchExists = false
	for (const item of lineItems) {
		const expectedLine = Math.round(item.quantity * item.unitPriceMinor)
		if (expectedLine !== item.lineTotalMinor) {
			mismatchExists = true
		}
		sum += expectedLine
	}
	return {
		computedMinor: sum + taxMinor - discountMinor,
		mismatchExists,
	}
}

export interface FxSpreadResult {
	midMarketExpectedMinor: number
	impliedGrossBeforeReceiverFeesMinor: number
	fxSpreadLossMinor: number
	fxSpreadBps: number
}

export function computeFxSpread(params: {
	instructedGrossMinor: number
	instructedCurrency: CurrencyCode
	settledMinor: number
	settledCurrency: CurrencyCode
	normalizedReceiverChargesMinor: number
	normalizedRepairFeeMinor: number
	normalizedPlatformFeeMinor: number
	normalizedWithholdingTaxMinor?: number
	midMarketRate: number
	bankAppliedRate?: number
}): FxSpreadResult {
	const fromUpper = params.instructedCurrency.trim().toUpperCase()
	const toUpper = params.settledCurrency.trim().toUpperCase()
	const taxMinor = params.normalizedWithholdingTaxMinor ?? 0

	if (fromUpper === toUpper) {
		return {
			midMarketExpectedMinor: params.instructedGrossMinor,
			impliedGrossBeforeReceiverFeesMinor:
				params.settledMinor +
				params.normalizedReceiverChargesMinor +
				params.normalizedRepairFeeMinor +
				params.normalizedPlatformFeeMinor +
				taxMinor,
			fxSpreadLossMinor: 0,
			fxSpreadBps: 0,
		}
	}

	const midMarketExpectedMinor = convertMinorUnits(
		params.instructedGrossMinor,
		fromUpper,
		toUpper,
		params.midMarketRate,
	)

	// When bankAppliedRate (:36: or disclosed withdrawal rate) is known, compute FX spread
	// directly from the applied rate so any separate short-pay stays exposed in unexplainedVarianceMinor.
	const bankGrossFromRate =
		params.bankAppliedRate && params.bankAppliedRate > 0
			? convertMinorUnits(params.instructedGrossMinor, fromUpper, toUpper, params.bankAppliedRate)
			: undefined

	const impliedGrossBeforeReceiverFeesMinor =
		bankGrossFromRate ??
		params.settledMinor +
			params.normalizedReceiverChargesMinor +
			params.normalizedRepairFeeMinor +
			params.normalizedPlatformFeeMinor +
			taxMinor

	const fxSpreadLossMinor = midMarketExpectedMinor - impliedGrossBeforeReceiverFeesMinor
	const fxSpreadBps =
		midMarketExpectedMinor > 0
			? Math.round((fxSpreadLossMinor / midMarketExpectedMinor) * 10000)
			: 0

	return {
		midMarketExpectedMinor,
		impliedGrossBeforeReceiverFeesMinor,
		fxSpreadLossMinor,
		fxSpreadBps,
	}
}

export function computeRecoverableOurViolationMinor(params: {
	contractedBearer: ChargeBearerClause
	wireBearer?: ChargeBearerClause
	normalizedReceiverChargesMinor: number
	normalizedRepairFeeMinor: number
}): number {
	const isOur = params.contractedBearer === "OUR" || params.wireBearer === "OUR"
	if (!isOur) return 0
	return params.normalizedReceiverChargesMinor + params.normalizedRepairFeeMinor
}

export function computeCentProofVarianceMinor(params: {
	midMarketExpectedMinor: number
	fxSpreadLossMinor: number
	deductedFeesMinor: number
	withholdingTaxMinor: number
	netSettledMinor: number
}): number {
	return (
		params.midMarketExpectedMinor -
		params.fxSpreadLossMinor -
		params.deductedFeesMinor -
		params.withholdingTaxMinor -
		params.netSettledMinor
	)
}

/**
 * Deterministic ISO 13616 IBAN checksum validation (Mod-97 == 1).
 */
export function validateIbanMod97(rawIban: string): { valid: boolean; reason?: string } {
	const iban = rawIban.replace(/\s+/g, "").toUpperCase()
	if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) {
		return { valid: false, reason: "Invalid IBAN length or character structure" }
	}
	const rearranged = iban.slice(4) + iban.slice(0, 4)
	let digits = ""
	for (const ch of rearranged) {
		const code = ch.charCodeAt(0)
		if (code >= 65 && code <= 90) {
			digits += String(code - 55)
		} else {
			digits += ch
		}
	}
	let remainder = 0
	for (let i = 0; i < digits.length; i++) {
		remainder = (remainder * 10 + Number(digits[i])) % 97
	}
	return remainder === 1
		? { valid: true }
		: { valid: false, reason: `IBAN Mod-97 checksum failed (remainder=${remainder}, expected 1)` }
}

/**
 * Deterministic ISO 9362 SWIFT/BIC structure check (8 or 11 chars).
 */
export function validateBicFormat(rawBic: string): { valid: boolean; reason?: string } {
	const bic = rawBic.replace(/\s+/g, "").toUpperCase()
	const valid = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)
	return valid
		? { valid: true }
		: { valid: false, reason: "Invalid SWIFT/BIC format (expected 8 or 11 ISO 9362 characters)" }
}
