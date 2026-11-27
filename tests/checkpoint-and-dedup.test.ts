import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CorridorDatabase } from "../src/core/db/database"
import { CorridorState } from "../src/runtime/corridor-runtime"
import type { SettlementCase } from "../src/core/types"

test("persistent monotonic case sequences never repeat across database reopens", () => {
	const dir = mkdtempSync(join(tmpdir(), "corridor-seq-"))
	const dbPath = join(dir, "corridor.sqlite")
	try {
		const db1 = new CorridorDatabase(dbPath)
		assert.deepEqual(db1.allocateCaseNumbers(2), [1, 2])
		assert.deepEqual(db1.allocateCaseNumbers(1), [3])
		db1.close()

		const db2 = new CorridorDatabase(dbPath)
		assert.deepEqual(db2.allocateCaseNumbers(2), [4, 5])
		db2.close()
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
})

test("encrypted specialist checkpoints persist in SQLite and restore into CorridorState", () => {
	const dir = mkdtempSync(join(tmpdir(), "corridor-ckpt-"))
	const dbPath = join(dir, "corridor.sqlite")
	try {
		const db = new CorridorDatabase(dbPath)
		const settlementCase: SettlementCase = {
			caseId: "MT103-0001",
			title: "Checkpoint Test",
			channelLabel: "SWIFT MT103",
			settlementEvidence: "observed",
			wire: {
				wireId: "WIRE-001",
				format: "mt103",
				valueDate: "2026-11-27",
				settledAmount: { amountMinor: 500000, currency: "USD" },
				senderCharges: [],
				receiverCharges: [],
			},
			createdAt: "2026-11-27T12:00:00.000Z",
		}
		db.saveCase(settlementCase)

		const termsPayload = {
			caseId: "MT103-0001",
			invoiceId: "INV-001",
			clauseSummary: "OUR clause verified",
			contractedChargeBearer: "OUR",
			ibanValid: true,
			bicValid: true,
			withholdingTaxMinor: 0,
			sourceRefs: [],
		}
		const fxPayload = {
			caseId: "MT103-0001",
			fxSpreadLossMinor: 1200,
			fxSpreadBps: 24,
			midMarketEquivalentMinor: 501200,
			rateRecord: {
				from: "EUR",
				to: "USD",
				requestedDate: "2026-11-27",
				ecbRateDate: "2026-11-27",
				midMarketRate: 1.08,
				source: "frankfurter_live",
				sourceUrl: "https://api.frankfurter.app/2026-11-27",
			},
			sourceRefs: [],
		}
		db.saveCaseCheckpoint({ caseId: "MT103-0001", role: "terms", payload: termsPayload })
		db.saveCaseCheckpoint({ caseId: "MT103-0001", role: "fx", payload: fxPayload })

		const loaded = db.loadCaseCheckpoints("MT103-0001")
		assert.deepEqual((loaded.terms as { clauseSummary: string }).clauseSummary, "OUR clause verified")
		assert.equal((loaded.fx as { fxSpreadBps: number }).fxSpreadBps, 24)
		assert.equal(loaded.wire, undefined)

		const state = new CorridorState()
		state.registerCase(settlementCase, loaded)
		assert.equal(state.findingsByRole.get("MT103-0001")?.has("terms"), true)
		assert.equal(state.findingsByRole.get("MT103-0001")?.has("fx"), true)
		assert.equal(state.findingsByRole.get("MT103-0001")?.has("wire"), false)
		assert.equal(state.termsByCaseId.get("MT103-0001")?.clauseSummary, "OUR clause verified")

		db.clearCaseCheckpoints("MT103-0001")
		assert.deepEqual(db.loadCaseCheckpoints("MT103-0001"), {})
		db.close()
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
})

test("upload API deduplicates identical files by SHA-256 and assigns monotonic case IDs", async () => {
	const dir = mkdtempSync(join(tmpdir(), "corridor-upload-dedup-"))
	const prevDbPath = process.env.CORRIDOR_DB_PATH
	process.env.CORRIDOR_DB_PATH = join(dir, "corridor.sqlite")
	try {
		const uploadRoute = await import("../src/app/api/audit/upload/route")
		const csvContent = "invoice_id,vendor,due_date,amount,currency,charge_bearer\nINV-900,Acme,2026-11-27,1000.00,USD,OUR"

		const res1 = await uploadRoute.POST(
			new Request("http://127.0.0.1:3000/api/audit/upload", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ filename: "invoices.csv", content: csvContent, format: "csv" }),
			}),
		)
		assert.equal(res1.status, 202)
		const body1 = (await res1.json()) as { ok: boolean; duplicate?: boolean; queuedCount: number; caseIds: string[] }
		assert.equal(body1.ok, true)
		assert.equal(body1.queuedCount, 1)
		assert.match(body1.caseIds[0], /^INVCASE-\d{4}$/)

		const res2 = await uploadRoute.POST(
			new Request("http://127.0.0.1:3000/api/audit/upload", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ filename: "invoices-copy.csv", content: csvContent, format: "csv" }),
			}),
		)
		assert.equal(res2.status, 200)
		const body2 = (await res2.json()) as { ok: boolean; duplicate?: boolean; queuedCount: number; caseIds: string[] }
		assert.equal(body2.ok, true)
		assert.equal(body2.duplicate, true)
		assert.equal(body2.queuedCount, 0)
		assert.deepEqual(body2.caseIds, body1.caseIds)
	} finally {
		if (prevDbPath === undefined) delete process.env.CORRIDOR_DB_PATH
		else process.env.CORRIDOR_DB_PATH = prevDbPath
		try {
			rmSync(dir, { recursive: true, force: true })
		} catch {
			// Windows SQLite singleton handle cleanup
		}
	}
})
