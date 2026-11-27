import assert from "node:assert/strict"
import test from "node:test"
import { parseCamt053Xml } from "../src/core/parsers/camt053-parser"
import { parseInvoicesCsv } from "../src/core/parsers/csv-parser"
import { parseMt103Blocks } from "../src/core/parsers/mt103-parser"
import { parseInboundEmailToCases } from "../src/core/integrations/email-parser"
import { parseJsonSettlementCases } from "../src/core/ingest/case-schema"
import { IngestionLimitError, MAX_CASES_PER_INGESTION, MAX_CANDIDATE_WIRES_PER_CASE } from "../src/core/ingest/limits"

const makeCase = (index: number) => ({
	caseId: `case-${index}`,
	wire: {
		wireId: `wire-${index}`,
		format: "bank_csv" as const,
		valueDate: "2026-11-27",
		settledAmount: { amountMinor: 100, currency: "USD" },
		senderCharges: [],
		receiverCharges: [],
	},
})

test("JSON intake enforces case and candidate-wire limits before case materialization", () => {
	assert.equal(parseJsonSettlementCases(Array.from({ length: MAX_CASES_PER_INGESTION }, (_, index) => makeCase(index))).length, MAX_CASES_PER_INGESTION)
	assert.throws(() => parseJsonSettlementCases(Array.from({ length: MAX_CASES_PER_INGESTION + 1 }, (_, index) => makeCase(index))), IngestionLimitError)
	assert.throws(() => parseJsonSettlementCases({
		...makeCase(0),
		candidateWires: Array.from({ length: MAX_CANDIDATE_WIRES_PER_CASE + 1 }, (_, index) => ({ ...makeCase(index).wire })),
	}), /candidate wires/)
})

test("CSV, MT103, and ISO 20022 parsers stop oversized imports at the shared case limit", () => {
	const csvRows = ["invoice_id,amount,currency", ...Array.from({ length: MAX_CASES_PER_INGESTION + 1 }, (_, index) => `inv-${index},1.00,USD`)]
	assert.throws(() => parseInvoicesCsv(csvRows.join("\n")), IngestionLimitError)

	const swiftBlock = (index: number) => `:20:REF-${index}\n:32A:261127USD1,00`
	assert.throws(() => parseMt103Blocks(Array.from({ length: MAX_CASES_PER_INGESTION + 1 }, (_, index) => swiftBlock(index)).join("\n---\n")), IngestionLimitError)

	const xmlEntry = (index: number) => `<Ntry><NtryRef>entry-${index}</NtryRef><Amt Ccy="USD">1.00</Amt></Ntry>`
	assert.throws(() => parseCamt053Xml(Array.from({ length: MAX_CASES_PER_INGESTION + 1 }, (_, index) => xmlEntry(index)).join("")), IngestionLimitError)
})

test("email attachment batches share one case limit", () => {
	const attachmentCases = JSON.stringify(Array.from({ length: 300 }, (_, index) => makeCase(index)))
	assert.throws(() => parseInboundEmailToCases({
		attachments: [
			{ filename: "first.json", content: attachmentCases },
			{ filename: "second.json", content: attachmentCases },
		],
	}), IngestionLimitError)
})
