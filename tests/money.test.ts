import assert from "node:assert/strict"
import test from "node:test"
import {
	computeInvoiceLineItemsTotal,
	computeTaxWithholding,
	convertMinorUnits,
	formatMoney,
	parseDecimalStringToMinor,
	validateBicFormat,
	validateIbanMod97,
} from "../src/core/money"

test("parseDecimalStringToMinor handles English and SWIFT comma formats across minor exponents", () => {
	assert.equal(parseDecimalStringToMinor("5,190.00", "USD"), 519000)
	assert.equal(parseDecimalStringToMinor("5190,00", "USD"), 519000)
	assert.equal(parseDecimalStringToMinor("16842", "JPY"), 16842)
	assert.equal(parseDecimalStringToMinor("12.345", "KWD"), 12345)
})

test("convertMinorUnits safely converts across JPY (0-dec), USD (2-dec), and KWD (3-dec)", () => {
	// 10000 USD minor ($100.00) * 150.0 JPY/USD => 15000 JPY minor (¥15,000)
	assert.equal(convertMinorUnits(10000, "USD", "JPY", 150), 15000)
	// 1000 KWD minor (1.000 KWD) * 3.25 USD/KWD => 325 USD minor ($3.25)
	assert.equal(convertMinorUnits(1000, "KWD", "USD", 3.25), 325)
})

test("validateIbanMod97 and validateBicFormat detect valid and corrupted banking identifiers", () => {
	assert.equal(validateIbanMod97("DE89370400440532013000").valid, true)
	assert.equal(validateIbanMod97("DE89370400440532013099").valid, false)
	assert.equal(validateBicFormat("DEUTDEFFXXX").valid, true)
	assert.equal(validateBicFormat("INVALID12").valid, false)
})

test("computeTaxWithholding and line items verification compute exact integer cents", () => {
	assert.equal(computeTaxWithholding(500000, 500), 25000)
	const check = computeInvoiceLineItemsTotal(
		[{ description: "Sensors", quantity: 10, unitPriceMinor: 50000, lineTotalMinor: 500000 }],
		0,
		0,
	)
	assert.equal(check.computedMinor, 500000)
	assert.equal(check.mismatchExists, false)
	assert.equal(formatMoney(519000, "USD"), "$5,190.00")
})
