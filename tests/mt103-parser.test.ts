import assert from "node:assert/strict"
import test from "node:test"
import { parseInvoicesCsv, parseWiresCsv } from "../src/core/parsers/csv-parser"
import { parseCamt053Xml } from "../src/core/parsers/camt053-parser"
import { parseMt103Blocks } from "../src/core/parsers/mt103-parser"

const MT103_FIXTURE = `{1:F01DEUTDEFFXXXX0000000000}{2:I103CITIUS33XXXXN}{4:
:20:TXN20261124BF01
:32A:261124USD2150,00
:33B:USD2150,00
:50K:ACME PAYER
:59:/DE89370400440532013000
VENDOR ONE
:70:/INV/INV-2040
:71A:SHA
-}
{1:F01NDEASESSXXXX0000000000}{2:I103CITIUS33XXXXN}{4:
:20:TXN20261124BF02
:32A:261124USD5190,00
:33B:EUR5000,00
:36:1,0470
:50K:NORDIC GEAR GMBH
:59:/US1234567890
CLOUD STUDIO
:70:/INV/INV-2041
:71A:OUR
:71G:USD45,00
-}
{1:F01DEUTDEFFXXXX0000000000}{2:I103BARCGB22XXXXN}{4:
:20:TXN20261124ORPHAN
:32A:261124GBP1500,00
:33B:GBP1500,00
:50K:LONDON CLIENT
:59:/GB29NWBK60161331926819
FREELANCER UK
:71A:SHA
-}`

const INVOICES_CSV_FIXTURE = `invoice_id,issue_date,due_date,vendor_name,payer_name,amount,currency,charge_bearer,withholding_tax_bps
INV-2040,2026-11-20,2026-12-20,Vendor One,Acme Payer,1320.30,USD,SHA,0
INV-2041,2026-11-21,2026-12-21,Cloud Studio,Nordic Gear GmbH,5000.00,EUR,OUR,0
INV-2042,2026-11-22,2026-12-22,Freelancer UK,London Client,1500.00,GBP,SHA,0`

const WIRES_CSV_FIXTURE = `transaction_ref,platform_name,value_date,settled_amount,settled_currency,instructed_amount,instructed_currency,charge_bearer,platform_fee,platform_fee_currency,remittance_info
TXN-UPW-01,upwork,2026-11-24,1305.30,USD,1320.30,USD,SHA,15.00,USD,/INV/INV-2040
TXN-SW-02,swift,2026-11-24,5190.00,USD,5000.00,EUR,OUR,0,USD,/INV/INV-2041
TXN-SW-03,swift,2026-11-24,1500.00,GBP,1500.00,GBP,SHA,0,GBP,/INV/INV-2042`

test("parseMt103Blocks parses multi-block SWIFT MT103 wires with exact SourceRefs", () => {
	const wires = parseMt103Blocks(MT103_FIXTURE)
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
	assert.equal(orphan.remittanceInfo ?? "", "")
	assert.ok((orphan.sourceRefs?.length ?? 0) >= 5)
})

test("parseInvoicesCsv and parseWiresCsv handle Upwork & SWIFT CSV rows", () => {
	const invoices = parseInvoicesCsv(INVOICES_CSV_FIXTURE)
	const wires = parseWiresCsv(WIRES_CSV_FIXTURE)

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
