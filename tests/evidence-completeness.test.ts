import assert from "node:assert/strict"
import test from "node:test"
import { normalizeInboundPayloadToCases } from "../src/core/ingest/normalize-upload"
import { extractTextFromPdfBuffer } from "../src/core/parsers/pdf-parser"
import { readRequestTextLimited, RequestBodyTooLargeError } from "../src/core/security/request-body"

const invoice = {
	invoiceId: "INV-1001",
	vendorOrClient: "Example Supplier",
	issueDate: "2026-10-01",
	dueDate: "2026-10-31",
	expectedAmount: { amountMinor: 12500, currency: "USD" },
	expectedSettlementCurrency: "USD",
	contractedChargeBearer: "SHA" as const,
	withholdingTaxRateBps: 0,
	sourceRefs: [{ sourceType: "invoice", recordId: "INV-1001", field: "invoice.amount", rawExcerpt: "invoice 125.00 USD" }],
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
		sourceRefs: [{ sourceType: "bank_csv" as const, recordId: "PAY-1001", field: "settled_amount", rawExcerpt: "124.00 USD" }],
	}
	const [settlementCase] = normalizeInboundPayloadToCases({
		format: "json",
		content: JSON.stringify({ invoice, wire }),
	})

	assert.equal(settlementCase.settlementEvidence, "observed")
	assert.equal(settlementCase.wire.wireId, wire.wireId)
})

test("wire-only JSON cannot imply an invoice or completed reconciliation", () => {
	const [settlementCase] = normalizeInboundPayloadToCases({
		format: "json",
		content: JSON.stringify({
			wire: {
				wireId: "WIRE-ONLY-1",
				format: "bank_csv",
				valueDate: "2026-10-30",
				settledAmount: { amountMinor: 12400, currency: "USD" },
				senderCharges: [],
				receiverCharges: [],
			},
		}),
	})

	assert.equal(settlementCase.settlementEvidence, "incomplete")
	assert.match(settlementCase.evidenceGap || "", /independent invoice/i)
})

test("MT103 amount is not reused as independent invoice evidence", () => {
	const [settlementCase] = normalizeInboundPayloadToCases({
		filename: "payment.mt103",
		format: "mt103",
		content: [":20:TXN-3001", ":32A:261030USD124,00", ":33B:USD125,00", ":50K:Example Buyer", ":59:Example Supplier", ":71A:SHA"].join("\n"),
	})

	assert.equal(settlementCase.settlementEvidence, "incomplete")
	assert.match(settlementCase.evidenceGap || "", /independent invoice/i)
})

test("JSON settlement input rejects invalid money and missing charge evidence cannot be observed", () => {
	assert.throws(
		() => normalizeInboundPayloadToCases({
			format: "json",
			content: JSON.stringify({ invoice, wire: { wireId: "bad", format: "bank_csv", valueDate: "2026-10-30", settledAmount: { amountMinor: "12400", currency: "USD" } } }),
		}),
		/Invalid settlement JSON.*amountMinor/,
	)

	const [settlementCase] = normalizeInboundPayloadToCases({
		format: "json",
		content: JSON.stringify({
			invoice,
			wire: {
				wireId: "WIRE-MISSING-FEES",
				format: "bank_csv",
				valueDate: "2026-10-30",
				settledAmount: { amountMinor: 12400, currency: "USD" },
				senderCharges: [],
				sourceRefs: [{ sourceType: "bank_csv", recordId: "PAY-2001", field: "settled_amount", rawExcerpt: "124.00 USD" }],
			},
		}),
	})
	assert.equal(settlementCase.settlementEvidence, "incomplete")
	assert.match(settlementCase.evidenceGap || "", /charge fields/i)
})

test("invoice CSV uploads remain evidence-incomplete instead of implied payment", () => {
	const [settlementCase] = normalizeInboundPayloadToCases({
		filename: "invoices.csv",
		content: "invoice_id,issue_date,due_date,vendor_name,amount,currency,charge_bearer\nINV-2001,2026-10-01,2026-10-31,Example Supplier,125.00,USD,SHA",
	})

	assert.equal(settlementCase.settlementEvidence, "estimated")
	assert.equal(settlementCase.wire.valueDate, "2026-10-31")
})

test("request body reader enforces its byte limit while streaming", async () => {
	const request = new Request("http://localhost/upload", { method: "POST", body: "12345" })
	await assert.rejects(readRequestTextLimited(request, 4), RequestBodyTooLargeError)

	const smallRequest = new Request("http://localhost/upload", { method: "POST", body: "1234" })
	assert.equal(await readRequestTextLimited(smallRequest, 4), "1234")
})

test("PDF ingestion rejects mislabeled and non-extractable files while reading actual PDF text", () => {
	const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Length 44 >>\nstream\nBT (Invoice INV-12345 EUR 125.00) Tj ET\nendstream\nendobj\n%%EOF\n", "utf8")
	assert.match(extractTextFromPdfBuffer(pdf), /INV-12345/)
	assert.throws(() => extractTextFromPdfBuffer(Buffer.from("not a pdf")), /not a complete PDF/)
	assert.throws(() => extractTextFromPdfBuffer(Buffer.from("%PDF-1.4\n%%EOF\n")), /no extractable text/)
})
