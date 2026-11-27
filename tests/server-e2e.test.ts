import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"

const TEST_DB_PATH = resolve(tmpdir(), `corridor-e2e-${process.pid}-${Date.now()}.db`)
process.env.CORRIDOR_DB_PATH = TEST_DB_PATH

import { POST as uploadRoute } from "../src/app/api/audit/upload/route"
import { GET as healthRoute } from "../src/app/api/health/route"
import { GET as historyRoute } from "../src/app/api/history/route"
import { GET as runtimeStatusRoute } from "../src/app/api/runtime/status/route"
import { POST as terminalRoute } from "../src/app/api/terminal/route"
import { POST as inboundWebhookRoute } from "../src/app/api/webhooks/inbound/route"
import { POST as emailWebhookRoute } from "../src/app/api/webhooks/email/route"
import { getCorridorDb } from "../src/core/db/database"

test("Next.js App Router API routes serve health, terminal, upload ingestion, webhook ingestion, and history", async () => {
	const health = (await (await healthRoute()).json()) as Record<string, unknown> & { ok: boolean }
	assert.equal(health.ok, true)
	assert.equal("provider" in health, false, "public liveness must not disclose internal runtime status")
	assert.equal("hotFolder" in health, false, "public liveness must not disclose local filesystem paths")

	const runtimeStatus = await runtimeStatusRoute(new Request("http://127.0.0.1/api/runtime/status"))
	const runtimePayload = (await runtimeStatus.json()) as { ok: boolean; framework: string; provider: { mode: string } }
	assert.equal(runtimeStatus.status, 200)
	assert.ok(["live", "unconfigured"].includes(runtimePayload.provider.mode))
	assert.ok(runtimePayload.framework.includes("Next.js"))

	const terminalHelp = await terminalRoute(
		new Request("http://127.0.0.1/api/terminal", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ command: "help" }),
		}),
	)
	const helpPayload = (await terminalHelp.json()) as { ok: boolean; output: string[] }
	assert.equal(terminalHelp.status, 200)
	assert.ok(helpPayload.output.some((line) => line.includes("inspect")))

	const badCommand = await terminalRoute(
		new Request("http://127.0.0.1/api/terminal", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ command: "whoami" }),
		}),
	)
	assert.equal(badCommand.status, 400, "The in-app console must reject non-application commands")

	const mt103 = [
		":20:TXN-E2E-001",
		":32A:261124USD5190,00",
		":33B:EUR5000,00",
		":36:1,0470",
		":50K:NORDIC GEAR GMBH",
		":59:/US1234567890",
		"CLOUD STUDIO",
		":70:/INV/INV-2041",
		":71A:OUR",
		":71G:USD45,00",
	].join("\n")
	const mislabeledBase64 = await uploadRoute(
		new Request("http://127.0.0.1/api/audit/upload", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ filename: "records.csv", base64: Buffer.from("not a PDF").toString("base64") }),
		}),
	)
	assert.equal(mislabeledBase64.status, 400, "binary base64 uploads must not be guessed as text records")

	const invalidPdf = await uploadRoute(
		new Request("http://127.0.0.1/api/audit/upload", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ format: "pdf", base64: Buffer.from("not a PDF").toString("base64") }),
		}),
	)
	assert.equal(invalidPdf.status, 400)
	const invalidPdfBody = (await invalidPdf.json()) as { ingestionId?: string }
	assert.ok(invalidPdfBody.ingestionId)
	assert.equal(getCorridorDb().getRawIngestion(invalidPdfBody.ingestionId || "")?.parseStatus, "failed")

	const uploadRes = await uploadRoute(
		new Request("http://127.0.0.1/api/audit/upload", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ filename: "wire.txt", content: mt103, format: "mt103" }),
		}),
	)
	assert.equal(uploadRes.status, 202)
	const uploadJson = (await uploadRes.json()) as { ok: boolean; queuedCount: number; caseIds: string[] }
	assert.equal(uploadJson.ok, true)
	assert.equal(uploadJson.queuedCount, 1)
	assert.equal(uploadJson.caseIds.length, 1)
	if (runtimePayload.provider.mode === "unconfigured") {
		assert.equal(getCorridorDb().getCaseQueueState(uploadJson.caseIds[0] || "")?.status, "queued", "without an LLM key, durable work must wait instead of invoking Mozaik")
	}

	const whRes = await inboundWebhookRoute(
		new Request("http://127.0.0.1/api/webhooks/inbound", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				caseId: "WH-E2E-01",
				title: "Webhook Settlement Case",
				sourceType: "webhook",
				wire: {
					wireId: "W-E2E-01",
					transactionRef: "TXN-WH-01",
					format: "bank_csv",
					valueDate: "2026-11-24",
					settledAmount: { amountMinor: 100000, currency: "USD" },
					chargeBearer: "SHA",
					senderCharges: [],
					receiverCharges: [],
					sourceRefs: [],
				},
			}),
		}),
	)
	assert.equal(whRes.status, 202)

	const histRes = await historyRoute(new Request("http://127.0.0.1/api/history"))
	assert.equal(histRes.status, 200)
	const histJson = (await histRes.json()) as { cases?: Array<{ caseId: string }> }
	assert.ok(Array.isArray(histJson.cases))
})

test("upload and email attachment intake record local malware scan status", async () => {
	const env = process.env as unknown as Record<string, string | undefined>
	const previousHost = env.CORRIDOR_CLAMD_HOST
	delete env.CORRIDOR_CLAMD_HOST
	try {
		const upload = await uploadRoute(new Request("http://127.0.0.1/api/audit/upload", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ filename: "scan-status.txt", content: ":20:TXN-SCAN-01\n:32A:261124USD10,00", format: "mt103" }),
		}))
		assert.equal(upload.status, 202)
		const uploadResult = await upload.json() as { ingestionId?: string }
		assert.equal(getCorridorDb().getRawIngestion(uploadResult.ingestionId || "")?.metadata.malwareScan, "not_configured")

		const email = await emailWebhookRoute(new Request("http://127.0.0.1/api/webhooks/email", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				from: "ops@example.test",
				attachments: [{ filename: "malformed.pdf", contentBase64: Buffer.from("not a PDF").toString("base64") }],
			}),
		}))
		assert.equal(email.status, 422)
		const lastEmail = getCorridorDb().listRawIngestions({ channel: "email", limit: 1 })[0]
		assert.equal(lastEmail?.metadata.malwareScan, "not_configured")
	} finally {
		if (previousHost === undefined) delete env.CORRIDOR_CLAMD_HOST
		else env.CORRIDOR_CLAMD_HOST = previousHost
	}
})

test("webhook acknowledges only after case persistence and a provider retry recovers the failed enqueue", async () => {
	const db = getCorridorDb()
	const caseId = "WH-QUEUE-PERSISTENCE-01"
	const raw = JSON.stringify({
		id: "evt-QUEUE-PERSISTENCE-01",
		caseId,
		title: "Durable webhook case",
		sourceType: "webhook",
		wire: {
			wireId: "WIRE-QUEUE-PERSISTENCE-01",
			format: "bank_csv",
			valueDate: "2026-11-27",
			settledAmount: { amountMinor: 12500, currency: "USD" },
			chargeBearer: "SHA",
			senderCharges: [],
			receiverCharges: [],
			sourceRefs: [],
		},
	})
	const secret = db.getRawWebhookSecret()
	const signature = `sha256=${createHmac("sha256", secret).update(raw, "utf8").digest("hex")}`
	const makeRequest = () => new Request("http://127.0.0.1/api/webhooks/inbound", {
		method: "POST",
		headers: { "Content-Type": "application/json", "x-corridor-signature": signature },
		body: raw,
	})
	const originalSaveCase = db.saveCase.bind(db)
	db.saveCase = ((settlementCase, workspaceId) => {
		if (settlementCase.caseId === caseId) throw new Error("injected durable queue write failure")
		originalSaveCase(settlementCase, workspaceId)
	}) as typeof db.saveCase
	try {
		const failed = await inboundWebhookRoute(makeRequest())
		assert.notEqual(failed.status, 202, "the event must not be acknowledged as queued if its case row could not be saved")
	} finally {
		db.saveCase = originalSaveCase
	}

	const retried = await inboundWebhookRoute(makeRequest())
	assert.equal(retried.status, 202)
	assert.ok(db.getPersistedCase(caseId), "the retried event must have a durable case queue row before acknowledgement")
})

test.after(() => {
	try {
		getCorridorDb().close()
		rmSync(TEST_DB_PATH, { force: true })
		rmSync(`${TEST_DB_PATH}-wal`, { force: true })
		rmSync(`${TEST_DB_PATH}-shm`, { force: true })
	} catch {
		// ignore cleanup
	}
	setImmediate(() => process.exit(0))
})
