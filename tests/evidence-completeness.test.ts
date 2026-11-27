import assert from "node:assert/strict"
import test from "node:test"
import { normalizeInboundPayloadToCases } from "../src/core/ingest/normalize-upload"

const invoice = {
	invoiceId: "INV-1001",
	vendorOrClient: "Example Supplier",
	issueDate: "2026-10-01",
	dueDate: "2026-10-31",
	expectedAmount: { amountMinor: 12500, currency: "USD" },
	expectedSettlementCurrency: "USD",
	contractedChargeBearer: "SHA" as const,
	withholdingTaxRateBps: 0,
}

test("invoice-only JSON is marked estimated and uses the invoice due date", () => {
	const [settlementCase] = normalizeInboundPayloadToCases({
		format: "json",
		content: JSON.stringify({ invoice }),
	})

	assert.equal(settlementCase.settlementEvidence, "estimated")
	assert.equal(settlementCase.wire.settledAmount.amountMinor, invoice.expectedAmount.amountMinor)
	assert.equal(settlementCase.wire.valueDate, invoice.dueDate)
})

test("a supplied wire is treated as observed payment evidence", () => {
	const wire = {
		wireId: "WIRE-1001",
		format: "bank_csv",
		valueDate: "2026-10-30",
		settledAmount: { amountMinor: 12400, currency: "USD" },
		senderCharges: [],
		receiverCharges: [],
	}
	const [settlementCase] = normalizeInboundPayloadToCases({
		format: "json",
		content: JSON.stringify({ invoice, wire }),
	})

	assert.equal(settlementCase.settlementEvidence, "observed")
	assert.equal(settlementCase.wire.wireId, wire.wireId)
})

test("invoice CSV uploads remain evidence-incomplete instead of implied payment", () => {
	const [settlementCase] = normalizeInboundPayloadToCases({
		filename: "invoices.csv",
		content: "invoice_id,issue_date,due_date,vendor_name,amount,currency,charge_bearer\nINV-2001,2026-10-01,2026-10-31,Example Supplier,125.00,USD,SHA",
	})

	assert.equal(settlementCase.settlementEvidence, "estimated")
	assert.equal(settlementCase.wire.valueDate, "2026-10-31")
})
