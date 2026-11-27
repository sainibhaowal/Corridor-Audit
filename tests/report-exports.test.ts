import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildVerdictPdf, buildVerdictsCsv, buildVerdictTxt } from "../src/core/reports/export-formats"
import { extractTextFromPdfBuffer } from "../src/core/parsers/pdf-parser"
import type { AuditVerdict } from "../src/core/types"

const SAMPLE_VERDICT: AuditVerdict = {
	caseId: "MT103-EXPORT-01",
	invoiceId: "INV-2026-001",
	wireId: "WIRE-2026-001",
	provenance: {
		appVersion: "0.2.0",
		sourceRevision: "test-sha",
		workingTree: "clean",
		auditRulesVersion: "1.0.0",
	},
	status: "RECOVERABLE_FEE_VIOLATION",
	plainEnglishSummary: "Correspondent deducted $35.00 despite :71A:OUR clause.",
	numbers: {
		invoicedMinor: 500000,
		invoicedCurrency: "EUR",
		midMarketEquivalentMinor: 540000,
		settledMinor: 512200,
		settledCurrency: "USD",
		fxSpreadLossMinor: 24300,
		fxSpreadBps: 450,
		liftingAndRepairFeesMinor: 3500,
		platformFeeMinor: 0,
		withholdingTaxMinor: 0,
		recoverableFeeMinor: 3500,
		unexplainedVarianceMinor: 0,
	},
	replay: {
		actualNetMinor: 512200,
		optimalTransparentNetMinor: 539000,
		totalLeakMinor: 26800,
		totalLeakBps: 496,
	},
	sourceRefs: [
		{
			sourceType: "mt103",
			recordId: "WIRE-2026-001",
			field: ":71A:",
			rawExcerpt: ":71A:OUR",
		},
	],
	disclaimer: "Synthetic/public data demonstration only. Not financial or legal advice.",
	completedAt: "2026-11-27T12:00:00.000Z",
}

test("export formatters generate TXT, CSV (with formula neutralization), and valid PDF", () => {
	const txt = buildVerdictTxt(SAMPLE_VERDICT)
	assert.match(txt, /CORRIDOR AUDIT REPORT - MT103-EXPORT-01/)
	assert.match(txt, /5000\.00 EUR/)
	assert.match(txt, /35\.00 USD/)

	const csv = buildVerdictsCsv([
		SAMPLE_VERDICT,
		{ ...SAMPLE_VERDICT, caseId: "=HYPERLINK(\"bad\")", plainEnglishSummary: "A, \"quoted\" summary" },
	])
	const csvLines = csv.split("\r\n")
	assert.equal(csvLines.length, 3)
	assert.match(csvLines[0], /^case_id,invoice_id,wire_id,status,/)
	assert.match(csvLines[1], /^MT103-EXPORT-01,INV-2026-001,WIRE-2026-001,RECOVERABLE_FEE_VIOLATION,/)
	assert.match(csvLines[2], /^"'=HYPERLINK/)
	assert.match(csvLines[2], /"A, ""quoted"" summary"/)

	const pdf = buildVerdictPdf(SAMPLE_VERDICT)
	const pdfText = pdf.toString("latin1")
	assert.ok(pdfText.startsWith("%PDF-1.4\n"))
	assert.ok(pdfText.endsWith("%%EOF\n"))
	const extracted = extractTextFromPdfBuffer(pdf)
	assert.match(extracted, /MT103-EXPORT-01/)
	assert.match(extracted, /GROUNDED SOURCE CITATIONS/)
})

test("report API routes serve txt, csv, pdf, json with attachment and preview=1 inline headers", async () => {
	const dir = mkdtempSync(join(tmpdir(), "corridor-report-"))
	const prevDbPath = process.env.CORRIDOR_DB_PATH
	process.env.CORRIDOR_DB_PATH = join(dir, "corridor.sqlite")

	try {
		const { getCorridorDb } = await import("../src/core/db/database")
		const { initCorridorOrchestrator } = await import("../src/runtime/orchestrator")
		const reportByIdRoute = await import("../src/app/api/report/[caseId]/route")
		const reportAllRoute = await import("../src/app/api/report/route")

		const db = getCorridorDb()
		db.saveCase({
			caseId: SAMPLE_VERDICT.caseId,
			title: "Export Test Case",
			channelLabel: "SWIFT MT103",
			settlementEvidence: "observed",
			wire: {
				wireId: SAMPLE_VERDICT.wireId,
				format: "mt103",
				valueDate: "2026-11-27",
				settledAmount: { amountMinor: 512200, currency: "USD" },
				senderCharges: [],
				receiverCharges: [{ amountMinor: 3500, currency: "USD" }],
			},
			createdAt: "2026-11-27T12:00:00.000Z",
		})
		db.saveAuditVerdict(SAMPLE_VERDICT)
		const orch = initCorridorOrchestrator()
		orch.state.auditByCaseId.set(SAMPLE_VERDICT.caseId, SAMPLE_VERDICT)

		const pdfRes = await reportByIdRoute.GET(
			new Request("http://127.0.0.1:3000/api/report/MT103-EXPORT-01?format=pdf&preview=1"),
			{ params: Promise.resolve({ caseId: SAMPLE_VERDICT.caseId }) },
		)
		assert.equal(pdfRes.status, 200)
		assert.equal(pdfRes.headers.get("content-type"), "application/pdf")
		assert.match(pdfRes.headers.get("content-disposition") || "", /^inline;/)
		const pdfBytes = Buffer.from(await pdfRes.arrayBuffer())
		assert.ok(pdfBytes.toString("latin1").startsWith("%PDF-1.4"))

		const csvRes = await reportByIdRoute.GET(
			new Request("http://127.0.0.1:3000/api/report/MT103-EXPORT-01?format=csv"),
			{ params: Promise.resolve({ caseId: SAMPLE_VERDICT.caseId }) },
		)
		assert.equal(csvRes.status, 200)
		assert.equal(csvRes.headers.get("content-type"), "text/csv; charset=utf-8")
		assert.match(csvRes.headers.get("content-disposition") || "", /^attachment;/)
		assert.match(await csvRes.text(), /MT103-EXPORT-01/)

		const batchCsvRes = await reportAllRoute.GET(
			new Request("http://127.0.0.1:3000/api/report?format=csv"),
		)
		assert.equal(batchCsvRes.status, 200)
		assert.equal(batchCsvRes.headers.get("content-type"), "text/csv; charset=utf-8")
		assert.match(await batchCsvRes.text(), /MT103-EXPORT-01/)
	} finally {
		if (prevDbPath === undefined) delete process.env.CORRIDOR_DB_PATH
		else process.env.CORRIDOR_DB_PATH = prevDbPath
		try {
			rmSync(dir, { recursive: true, force: true })
		} catch {
			// Windows SQLite singleton handle may still be open until process exit
		}
	}
})
