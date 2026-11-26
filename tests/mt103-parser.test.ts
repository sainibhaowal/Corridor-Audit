import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { parseInvoicesCsv, parseWiresCsv } from "../src/core/parsers/csv-parser"
import { parseCamt053Xml } from "../src/core/parsers/camt053-parser"
import { parseMt103Blocks } from "../src/core/parsers/mt103-parser"

test("parseMt103Blocks parses multi-block SWIFT MT103 sample wires with exact SourceRefs", () => {
	const raw = readFileSync(resolve(process.cwd(), "data/mt103-samples/sample-wires.txt"), "utf8")
	const wires = parseMt103Blocks(raw)
	assert.equal(wires.length, 3)

	const case2 = wires[1]
	assert.equal(case2.transactionRef, "TXN20261124BF02")
	assert.equal(case2.instructedAmount?.amountMinor, 500000)
	assert.equal(case2.instructedAmount?.currency, "EUR")
	assert.equal(case2.settledAmount.amountMinor, 519000)
	assert.equal(case2.settledAmount.currency, "USD")
	assert.equal(case2.chargeBearer, "OUR")
	assert.equal(case2.receiverCharges[0]?.amountMinor, 4500)

	const orphan = wires[2]
	assert.equal(orphan.remittanceInfo, "")
	assert.ok((orphan.sourceRefs?.length ?? 0) >= 5)
})

test("parseInvoicesCsv and parseWiresCsv handle Upwork & SWIFT CSV rows", () => {
	const invCsv = readFileSync(resolve(process.cwd(), "data/scenarios/invoices-sample.csv"), "utf8")
	const wireCsv = readFileSync(resolve(process.cwd(), "data/scenarios/bank-payouts-sample.csv"), "utf8")
	const invoices = parseInvoicesCsv(invCsv)
	const wires = parseWiresCsv(wireCsv)

	assert.equal(invoices.length, 3)
	assert.equal(invoices[1].invoiceId, "INV-2041")
	assert.equal(invoices[1].contractedChargeBearer, "OUR")

	assert.equal(wires.length, 3)
	assert.equal(wires[0].platformName, "upwork")
	assert.equal(wires[0].platformFee?.amountMinor, 1500)
	assert.equal(wires[0].settledAmount.amountMinor, 130530)
})

test("parseCamt053Xml extracts ISO 20022 settlement amount, charges and repair fee", () => {
	const xml = `<Ntry><NtryRef>TXN20261124BF03</NtryRef><Amt Ccy="EUR">4647.00</Amt><InstdAmt Ccy="GBP">4000.00</InstdAmt><ChrgBr>SHAR</ChrgBr><ValDt><Dt>2026-11-24</Dt></ValDt><Ustrd>INV-2026-103</Ustrd><AddtlNtryInf>REPAIR: EUR 28.00 IBAN_MOD97_ERR</AddtlNtryInf></Ntry>`
	const parsed = parseCamt053Xml(xml)
	assert.equal(parsed.length, 1)
	assert.equal(parsed[0].settledAmount.amountMinor, 464700)
	assert.equal(parsed[0].repairFee?.amountMinor, 2800)
	assert.equal(parsed[0].chargeBearer, "SHA")
})
