import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

const TEST_DB_PATH = resolve(tmpdir(), `corridor-test-${process.pid}-${Date.now()}.db`)
process.env.CORRIDOR_DB_PATH = TEST_DB_PATH

import { GET as listIngestionsRoute } from "../src/app/api/ingestions/route"
import { GET as getIngestionRoute } from "../src/app/api/ingestions/[id]/route"
import { POST as reprocessIngestionRoute } from "../src/app/api/ingestions/[id]/reprocess/route"
import { GET as listIntegrationsRoute } from "../src/app/api/integrations/route"
import { POST as connectIntegrationRoute } from "../src/app/api/integrations/[provider]/connect/route"
import { POST as disconnectIntegrationRoute } from "../src/app/api/integrations/[provider]/disconnect/route"
import { GET as getWorkspaceRoute, POST as postWorkspaceRoute } from "../src/app/api/settings/workspace/route"
import { POST as emailWebhookRoute } from "../src/app/api/webhooks/email/route"
import { POST as inboundWebhookRoute } from "../src/app/api/webhooks/inbound/route"
import { CorridorDatabase, DEFAULT_WORKSPACE_ID, getCorridorDb } from "../src/core/db/database"
import { parseInboundEmailToCases } from "../src/core/integrations/email-parser"
import { decryptJson, decryptSecret, encryptJson, encryptSecret, maskSecret } from "../src/core/security/vault"
import {
	verifyCorridorSignature,
	verifyInboundWebhookRequest,
	verifyStripeSignature,
	verifyWiseSignature,
} from "../src/core/security/webhook-signatures"

test("AES-256-GCM vault encrypts and decrypts secrets and JSON credentials", () => {
	const raw = "sk_live_super_secret_token_123456"
	const enc = encryptSecret(raw)
	assert.ok(enc.startsWith("v1:"))
	assert.notEqual(enc, raw)
	assert.equal(decryptSecret(enc), raw)
	assert.equal(maskSecret(raw), "sk_l••••3456")

	const obj = { apiKey: "rk_123", webhookSecret: "whsec_abc" }
	const encObj = encryptJson(obj)
	assert.deepEqual(decryptJson(encObj), obj)
})

test("HMAC-SHA256 webhook signature verification supports Stripe, Wise, and Corridor signatures", () => {
	const body = JSON.stringify({ event: "payout.paid", amount: 5000 })
	const secret = "whsec_test_secret_123"
	const ts = Math.floor(Date.now() / 1000)

	const stripeSig = createHmac("sha256", secret).update(`${ts}.${body}`, "utf8").digest("hex")
	assert.equal(verifyStripeSignature(body, `t=${ts},v1=${stripeSig}`, secret).valid, true)
	assert.equal(verifyStripeSignature(body, `t=${ts},v1=deadbeef`, secret).valid, false)

	const wiseSig = createHmac("sha256", secret).update(body, "utf8").digest("base64")
	assert.equal(verifyWiseSignature(body, wiseSig, secret).valid, true)
	assert.equal(verifyWiseSignature(body, "invalid", secret).valid, false)

	const corridorSig = createHmac("sha256", secret).update(body, "utf8").digest("hex")
	assert.equal(verifyCorridorSignature(body, `sha256=${corridorSig}`, secret).valid, true)

	const missing = verifyInboundWebhookRequest({
		rawBody: body,
		headers: new Headers(),
		secrets: { corridor: secret },
		requireSignature: true,
	})
	assert.equal(missing.valid, false)
})

test("CorridorDatabase persists workspaces, team members, encrypted integrations, sync runs, and cases", () => {
	const db = new CorridorDatabase(":memory:")
	const ws = db.getWorkspace(DEFAULT_WORKSPACE_ID)
	assert.equal(ws.accountMode, "b2b")
	assert.ok(ws.inboundEmailAddress.includes(DEFAULT_WORKSPACE_ID))
	const initialTaxPolicy = db.getCurrentTaxPolicy(DEFAULT_WORKSPACE_ID)

	const updated = db.updateWorkspace(DEFAULT_WORKSPACE_ID, {
		name: "Acme Global Ops",
		accountMode: "b2c",
		defaultCurrency: "eur",
		taxCountry: "de",
		withholdingTaxBps: 1500,
		varianceThresholdMinor: 250,
	})
	assert.equal(updated.name, "Acme Global Ops")
	assert.equal(updated.accountMode, "b2c")
	assert.equal(updated.defaultCurrency, "EUR")
	assert.equal(updated.taxCountry, "DE")
	assert.equal(updated.withholdingTaxBps, 1500)
	const updatedTaxPolicy = db.getCurrentTaxPolicy(DEFAULT_WORKSPACE_ID)
	assert.notEqual(updatedTaxPolicy.id, initialTaxPolicy.id)
	assert.equal(updatedTaxPolicy.country, "DE")
	assert.equal(updatedTaxPolicy.withholdingTaxBps, 1500)
	db.updateWorkspace(DEFAULT_WORKSPACE_ID, { name: "Acme Operations" })
	assert.equal(db.getCurrentTaxPolicy(DEFAULT_WORKSPACE_ID).id, updatedTaxPolicy.id, "non-tax workspace changes do not create tax versions")

	const member = db.addTeamMember({
		workspaceId: DEFAULT_WORKSPACE_ID,
		name: "Alice Controller",
		email: "alice@acme.test",
		role: "controller",
	})
	assert.equal(db.listTeamMembers(DEFAULT_WORKSPACE_ID).length, 1)
	db.removeTeamMember(DEFAULT_WORKSPACE_ID, member.id)
	assert.equal(db.listTeamMembers(DEFAULT_WORKSPACE_ID).length, 0)

	const integration = db.upsertIntegration({
		workspaceId: DEFAULT_WORKSPACE_ID,
		provider: "wise",
		category: "payouts",
		authMode: "api_token",
		status: "connected",
		accountLabel: "Wise Business",
		credentials: { apiKey: "wise-secret-token" },
	})
	assert.equal(integration.status, "connected")
	assert.equal(db.getDecryptedCredentials(DEFAULT_WORKSPACE_ID, "wise")?.apiKey, "wise-secret-token")

	const syncRun = db.createSyncRun({
		integrationId: integration.id,
		workspaceId: DEFAULT_WORKSPACE_ID,
		provider: "wise",
		trigger: "manual",
	})
	db.finishSyncRun({ id: syncRun.id, status: "success", recordsFetched: 4, casesQueued: 2 })
	assert.equal(db.listRecentSyncRuns(DEFAULT_WORKSPACE_ID, 5)[0]?.casesQueued, 2)

	db.disconnectIntegration(DEFAULT_WORKSPACE_ID, "wise")
	assert.equal(db.getIntegration(DEFAULT_WORKSPACE_ID, "wise")?.status, "disconnected")
	assert.equal(db.getDecryptedCredentials(DEFAULT_WORKSPACE_ID, "wise"), null)
	db.close()
})

test("local case queue survives restart and recovers work interrupted while running", () => {
	const db = new CorridorDatabase(":memory:")
	const queuedCase = {
		caseId: "CASE-RECOVERY-01",
		title: "Restart recovery case",
		channelLabel: "test",
		settlementEvidence: "incomplete" as const,
		wire: {
			wireId: "WIRE-RECOVERY-01",
			format: "bank_csv" as const,
			valueDate: "2026-11-27",
			settledAmount: { amountMinor: 1000, currency: "USD" },
			senderCharges: [],
			receiverCharges: [],
		},
		createdAt: new Date().toISOString(),
	}

	db.saveCase(queuedCase)
	assert.deepEqual(db.listQueuedCases().map((item) => item.caseId), [queuedCase.caseId])
	db.markCaseRunning(queuedCase.caseId)
	assert.equal(db.listQueuedCases().length, 1, "running work is visible for restart recovery")
	db.requeueInterruptedCases()
	assert.deepEqual(db.listQueuedCases().map((item) => item.caseId), [queuedCase.caseId])
	db.markCaseFailed(queuedCase.caseId)
	assert.equal(db.listQueuedCases().length, 0, "failed work is not silently auto retried")
	db.close()
})

test("raw ingestion payloads are encrypted in SQLite and decrypt through the vault API", () => {
	const dbPath = resolve(tmpdir(), `corridor-encrypted-vault-${process.pid}-${Date.now()}.db`)
	const raw = JSON.stringify({ invoiceNumber: "PRIVATE-INV-01", amount: 37500 })
	const db = new CorridorDatabase(dbPath)
	const ingestion = db.saveRawIngestion({
		workspaceId: DEFAULT_WORKSPACE_ID,
		sourceChannel: "manual_upload",
		sourceProvider: "test",
		filename: "private.json",
		format: "json",
		rawContent: raw,
	})
	assert.equal(ingestion.rawContent, raw)
	db.close()

	const inspection = new DatabaseSync(dbPath)
	const stored = inspection.prepare("SELECT raw_content, raw_content_encrypted FROM raw_ingestions WHERE id = ?")
		.get(ingestion.id) as { raw_content: string; raw_content_encrypted: number }
	assert.equal(stored.raw_content_encrypted, 1)
	assert.ok(stored.raw_content.startsWith("v1:"))
	assert.ok(!stored.raw_content.includes("PRIVATE-INV-01"))
	inspection.prepare("UPDATE raw_ingestions SET raw_content = ?, raw_content_encrypted = 0 WHERE id = ?")
		.run(raw, ingestion.id)
	inspection.close()

	const reopened = new CorridorDatabase(dbPath)
	assert.equal(reopened.getRawIngestion(ingestion.id, true)?.rawContent, raw)
	reopened.close()
	const migrated = new DatabaseSync(dbPath)
	const migratedRow = migrated.prepare("SELECT raw_content, raw_content_encrypted FROM raw_ingestions WHERE id = ?")
		.get(ingestion.id) as { raw_content: string; raw_content_encrypted: number }
	assert.equal(migratedRow.raw_content_encrypted, 1)
	assert.ok(migratedRow.raw_content.startsWith("v1:"))
	migrated.close()
	rmSync(dbPath, { force: true })
})

test("parseInboundEmailToCases extracts MT103 attachments from inbound email payloads", () => {
	const mt103 = [
		":20:TXN-EMAIL-01",
		":32A:261124USD2500,00",
		":33B:USD2500,00",
		":50K:CLIENT CORP",
		":70:/INV/INV-EMAIL-99",
		":71A:SHA",
	].join("\n")

	const cases = parseInboundEmailToCases({
		from: "billing@client.test",
		subject: "Wire Advice INV-EMAIL-99",
		attachments: [
			{
				filename: "wire-advice.txt",
				contentBase64: Buffer.from(mt103, "utf8").toString("base64"),
			},
		],
	})
	assert.equal(cases.length, 1)
	assert.ok(cases[0]?.channelLabel.includes("billing@client.test"))
	assert.equal(cases[0]?.wire.settledAmount.amountMinor, 250000)
})

test("Integration, Email Webhook, Signed Inbound Webhook, and Workspace APIs work end-to-end", async () => {
	// 1. Connect & disconnect Stripe via API routes
	const connectRes = await connectIntegrationRoute(
		new Request("http://127.0.0.1/api/integrations/stripe/connect", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				authMode: "api_token",
				apiKey: "rk_test_123456789",
				accountLabel: "Stripe Main",
			}),
		}),
		{ params: Promise.resolve({ provider: "stripe" }) },
	)
	assert.equal(connectRes.status, 200)

	const listRes = await listIntegrationsRoute(new Request("http://127.0.0.1/api/integrations"))
	const listJson = (await listRes.json()) as {
		ok: boolean
		integrations: Array<{ provider: string; connection: { status: string } }>
	}
	assert.equal(listJson.ok, true)
	assert.equal(listJson.integrations.find((i) => i.provider === "stripe")?.connection.status, "connected")

	const disconnectRes = await disconnectIntegrationRoute(
		new Request("http://127.0.0.1/api/integrations/stripe/disconnect", { method: "POST" }),
		{ params: Promise.resolve({ provider: "stripe" }) },
	)
	assert.equal(disconnectRes.status, 200)

	// 2. Workspace settings & webhook signature enforcement
	const wsGet = await getWorkspaceRoute(new Request("http://127.0.0.1/api/settings/workspace"))
	assert.equal(wsGet.status, 200)
	const invalidTaxProfile = await postWorkspaceRoute(
		new Request("http://127.0.0.1/api/settings/workspace", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "update_workspace", taxCountry: "Germany", withholdingTaxBps: 15_001 }),
		}),
	)
	assert.equal(invalidTaxProfile.status, 400)

	const wsPost = await postWorkspaceRoute(
		new Request("http://127.0.0.1/api/settings/workspace", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				action: "update_workspace",
				requireWebhookSignature: true,
			}),
		}),
	)
	assert.equal(wsPost.status, 200)

	const payload = JSON.stringify({
		caseId: "WH-SIGNED-01",
		title: "Signed Webhook Case",
		sourceType: "webhook",
		wire: {
			wireId: "W-SIGNED-01",
			transactionRef: "TXN-SIGNED-01",
			format: "bank_csv",
			valueDate: "2026-11-24",
			settledAmount: { amountMinor: 150000, currency: "USD" },
			chargeBearer: "SHA",
			senderCharges: [],
			receiverCharges: [],
			sourceRefs: [],
		},
	})

	const unsignedRes = await inboundWebhookRoute(
		new Request("http://127.0.0.1/api/webhooks/inbound", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: payload,
		}),
	)
	assert.equal(unsignedRes.status, 401)

	const secret = getCorridorDb().getRawWebhookSecret(DEFAULT_WORKSPACE_ID)
	const sig = createHmac("sha256", secret).update(payload, "utf8").digest("hex")
	const signedRes = await inboundWebhookRoute(
		new Request("http://127.0.0.1/api/webhooks/inbound", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-corridor-signature": `sha256=${sig}`,
			},
			body: payload,
		}),
	)
	assert.equal(signedRes.status, 202)

	// 3. Signed Email Webhook
	const emailBody = JSON.stringify({
		from: "ap@vendor.test",
		subject: "Invoice Payment",
		textBody: ":20:TXN-MAIL-01\n:32A:261124EUR1200,00\n:71A:SHA",
	})
	const emailSig = createHmac("sha256", secret).update(emailBody, "utf8").digest("hex")
	const emailRes = await emailWebhookRoute(
		new Request("http://127.0.0.1/api/webhooks/email", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-corridor-signature": `sha256=${emailSig}`,
			},
			body: emailBody,
		}),
	)
	assert.equal(emailRes.status, 202)

	// Reset requireWebhookSignature back to false so other tests remain unaffected
	await postWorkspaceRoute(
		new Request("http://127.0.0.1/api/settings/workspace", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				action: "update_workspace",
				requireWebhookSignature: false,
			}),
		}),
	)
})

test("Raw Data Vault persists raw payloads and supports inspect, download, and reprocess", async () => {
	const listRes = await listIngestionsRoute(new Request("http://127.0.0.1/api/ingestions"))
	assert.equal(listRes.status, 200)
	const listJson = (await listRes.json()) as {
		ok: boolean
		stats: { total: number; webhook: number; email: number }
		ingestions: Array<{ id: string; sha256: string; caseIds: string[] }>
	}
	assert.equal(listJson.ok, true)
	assert.ok(listJson.stats.total >= 2)
	assert.ok(listJson.stats.webhook >= 1)
	assert.ok(listJson.stats.email >= 1)

	const targetId = listJson.ingestions[0]!.id
	const detailRes = await getIngestionRoute(
		new Request(`http://127.0.0.1/api/ingestions/${targetId}`),
		{ params: Promise.resolve({ id: targetId }) },
	)
	assert.equal(detailRes.status, 200)
	const detailJson = (await detailRes.json()) as { ok: boolean; ingestion: { rawContent: string; sha256: string } }
	assert.equal(detailJson.ok, true)
	assert.ok(detailJson.ingestion.rawContent.length > 0)
	assert.equal(detailJson.ingestion.sha256.length, 64)

	const dlRes = await getIngestionRoute(
		new Request(`http://127.0.0.1/api/ingestions/${targetId}?download=1`),
		{ params: Promise.resolve({ id: targetId }) },
	)
	assert.equal(dlRes.status, 200)
	assert.ok(dlRes.headers.get("content-disposition")?.includes("attachment"))

	const reprocessRes = await reprocessIngestionRoute(
		new Request(`http://127.0.0.1/api/ingestions/${targetId}/reprocess`, { method: "POST" }),
		{ params: Promise.resolve({ id: targetId }) },
	)
	assert.equal(reprocessRes.status, 202)
})

test.after(() => {
	try {
		getCorridorDb().close()
		rmSync(TEST_DB_PATH, { force: true })
		rmSync(`${TEST_DB_PATH}-wal`, { force: true })
		rmSync(`${TEST_DB_PATH}-shm`, { force: true })
	} catch {
		// ignore cleanup errors
	}
	setImmediate(() => process.exit(0))
})
