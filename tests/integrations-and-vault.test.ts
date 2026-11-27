import assert from "node:assert/strict"
import { createHash, createHmac } from "node:crypto"
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
import { fetchCasesFromIntegration } from "../src/core/integrations/connectors"
import { fetchProvider } from "../src/core/integrations/http"
import { consumeOAuthState, createOAuthAuthorizationUrl, exchangeOAuthCode, refreshOAuthCredentials } from "../src/core/integrations/oauth"
import { runIntegrationSync } from "../src/runtime/workers/sync-worker"
import { runWithDurableCaseRetries } from "../src/runtime/workers/durable-case-queue"
import { backupCorridorDatabase } from "../src/core/db/backup"
import { decryptJson, decryptSecret, encryptJson, encryptSecret, maskSecret, resetVaultKeyCache } from "../src/core/security/vault"
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

test("production vault refuses to generate an unconfigured local key", () => {
	const priorNodeEnv = process.env.NODE_ENV
	const priorVaultKey = process.env.CORRIDOR_VAULT_KEY
	delete process.env.CORRIDOR_VAULT_KEY
	Reflect.set(process.env, "NODE_ENV", "production")
	resetVaultKeyCache()
	try {
		assert.throws(() => encryptSecret("must-not-create-a-production-key"), /Production requires CORRIDOR_VAULT_KEY/)
	} finally {
		if (priorNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV")
		else Reflect.set(process.env, "NODE_ENV", priorNodeEnv)
		if (priorVaultKey === undefined) delete process.env.CORRIDOR_VAULT_KEY
		else process.env.CORRIDOR_VAULT_KEY = priorVaultKey
		resetVaultKeyCache()
	}
})

test("webhook signature verification follows Stripe, Wise RSA, and Corridor schemes", () => {
	const body = JSON.stringify({ event: "payout.paid", amount: 5000 })
	const secret = "whsec_test_secret_123"
	const ts = Math.floor(Date.now() / 1000)

	const stripeSig = createHmac("sha256", secret).update(`${ts}.${body}`, "utf8").digest("hex")
	assert.equal(verifyStripeSignature(body, `t=${ts},v1=${stripeSig}`, secret).valid, true)
	assert.equal(verifyStripeSignature(body, `t=${ts},v1=deadbeef`, secret).valid, false)

	const wiseBody = '{"data":{"resource":{"id":49983981,"profile_id":16055450,"account_id":14124090,"type":"transfer"},"current_state":"incoming_payment_waiting","previous_state":null,"occurred_at":"2021-08-23T10:12:50Z"},"subscription_id":"90aa8e14-4ef1-4a56-861c-f3c9cde097ea","event_type":"transfers#state-change","schema_version":"2.0.0","sent_at":"2021-08-23T10:12:50Z"}'
	const wiseSignature = "wKcKCYXAzxNgiu7xmoDm943NUni7Rz33QN8JkEA9dWSGebgndonabgSj18Y4C08OrwVmueGsED2s00M7DtJVcYKOS1i3G4TMVx+mgM3aL9djMBkQtiYNBFUd6wrPI7ZUNHv/TrlKSjTMc+6JFvUvJ7owY3z85e3I4jLRLJowMFvO8kvCJ60+1pY9wDwZvtZ//WS93LrwGjk9Dvwzpmu0w+P4J75tETT5qC3Uv0y5G2yO8SEoO3yNP/tg/BOli02niHb53vEOUWUb9bly6thnfMoXoiV/osoGxgF20R58RlvkAmezyyl1Sv542TfS2DpiwVnmjjjkCyXeSUcKookYLQ=="
	assert.equal(verifyWiseSignature(wiseBody, wiseSignature).valid, true)
	assert.equal(verifyWiseSignature(`${wiseBody} `, wiseSignature).valid, false)
	assert.equal(verifyWiseSignature(body, "invalid").valid, false)

	const corridorSig = createHmac("sha256", secret).update(body, "utf8").digest("hex")
	assert.equal(verifyCorridorSignature(body, `sha256=${corridorSig}`, secret).valid, true)
	assert.equal(verifyCorridorSignature(body, `sha256=${corridorSig}`, secret, 300, true).valid, false)
	const corridorTimestampSig = createHmac("sha256", secret).update(`${ts}.${body}`, "utf8").digest("hex")
	assert.equal(verifyCorridorSignature(body, `t=${ts},v1=${corridorTimestampSig}`, secret, 300, true).valid, true)
	assert.equal(verifyCorridorSignature(body, `t=${ts - 600},v1=${corridorTimestampSig}`, secret, 300, true).valid, false)

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
	const initialReviewPolicy = db.getCurrentReviewPolicy(DEFAULT_WORKSPACE_ID)

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
	const updatedReviewPolicy = db.getCurrentReviewPolicy(DEFAULT_WORKSPACE_ID)
	assert.notEqual(updatedReviewPolicy.id, initialReviewPolicy.id)
	assert.equal(updatedReviewPolicy.varianceThresholdMinor, 250)
	assert.equal(updatedReviewPolicy.thresholdUnit, "case_settlement_currency_minor")
	db.updateWorkspace(DEFAULT_WORKSPACE_ID, { name: "Acme Operations" })
	assert.equal(db.getCurrentTaxPolicy(DEFAULT_WORKSPACE_ID).id, updatedTaxPolicy.id, "non-tax workspace changes do not create tax versions")
	assert.equal(db.getCurrentReviewPolicy(DEFAULT_WORKSPACE_ID).id, updatedReviewPolicy.id, "non-policy workspace changes do not create review versions")

	const member = db.addTeamMember({
		workspaceId: DEFAULT_WORKSPACE_ID,
		name: "Alice Controller",
		email: "alice@acme.test",
		role: "controller",
	})
	assert.equal(db.listTeamMembers(DEFAULT_WORKSPACE_ID).length, 1)
	assert.equal(db.removeTeamMember(DEFAULT_WORKSPACE_ID, member.id), "removed")
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
	assert.equal(db.listRecentSyncRuns(DEFAULT_WORKSPACE_ID, 5)[0]?.auditStatus, "unknown")
	assert.equal(db.listWorkspaceAuditEvents(DEFAULT_WORKSPACE_ID).find((event) => event.action === "integration.sync.complete")?.metadata.recordsFetched, 4)
	assert.equal(db.verifyWorkspaceAuditChain(DEFAULT_WORKSPACE_ID).valid, true)

	db.saveCase({
		caseId: "sync-audit-status-case",
		title: "Sync audit status fixture",
		channelLabel: "test",
		settlementEvidence: "incomplete",
		wire: { format: "test" },
		createdAt: new Date().toISOString(),
	} as never)
	const trackedRun = db.createSyncRun({ integrationId: integration.id, workspaceId: DEFAULT_WORKSPACE_ID, provider: "wise", trigger: "manual" })
	db.finishSyncRun({ id: trackedRun.id, status: "success", recordsFetched: 1, casesQueued: 1, caseIds: ["sync-audit-status-case"] })
	assert.equal(db.listRecentSyncRuns(DEFAULT_WORKSPACE_ID, 5)[0]?.auditStatus, "queued")
	db.markCaseDeadLetter("sync-audit-status-case", "test failure")
	assert.equal(db.listRecentSyncRuns(DEFAULT_WORKSPACE_ID, 5)[0]?.auditStatus, "failed")

	const interruptedRun = db.createSyncRun({ integrationId: integration.id, workspaceId: DEFAULT_WORKSPACE_ID, provider: "wise", trigger: "cron" })
	assert.equal(db.claimIntegrationSyncLease({ workspaceId: DEFAULT_WORKSPACE_ID, provider: "wise", ownerId: "sync-owner-a", leaseMs: 60_000 }), true)
	assert.equal(db.claimIntegrationSyncLease({ workspaceId: DEFAULT_WORKSPACE_ID, provider: "wise", ownerId: "sync-owner-b", leaseMs: 60_000 }), false)
	assert.equal(db.renewIntegrationSyncLease({ workspaceId: DEFAULT_WORKSPACE_ID, provider: "wise", ownerId: "sync-owner-a", leaseMs: 60_000 }), true)
	db.releaseIntegrationSyncLease({ workspaceId: DEFAULT_WORKSPACE_ID, provider: "wise", ownerId: "sync-owner-a" })
	assert.equal(db.claimIntegrationSyncLease({ workspaceId: DEFAULT_WORKSPACE_ID, provider: "wise", ownerId: "sync-owner-b", leaseMs: 60_000 }), true)
	assert.equal(db.failInterruptedIntegrationSyncRuns(DEFAULT_WORKSPACE_ID, "wise"), 1)
	assert.equal(db.listRecentSyncRuns(DEFAULT_WORKSPACE_ID, 5).find((item) => item.id === interruptedRun.id)?.status, "failed")
	db.releaseIntegrationSyncLease({ workspaceId: DEFAULT_WORKSPACE_ID, provider: "wise", ownerId: "sync-owner-b" })

	db.disconnectIntegration(DEFAULT_WORKSPACE_ID, "wise")
	assert.equal(db.getIntegration(DEFAULT_WORKSPACE_ID, "wise")?.status, "disconnected")
	assert.equal(db.getDecryptedCredentials(DEFAULT_WORKSPACE_ID, "wise"), null)
	db.close()
})

test("team member removal preserves the final active owner", () => {
	const db = new CorridorDatabase(":memory:")
	const owner = db.activateVerifiedTeamMember({
		workspaceId: DEFAULT_WORKSPACE_ID,
		email: "owner@acme.test",
		name: "Workspace Owner",
		identitySub: "cognito-owner",
		bootstrapOwner: true,
	})
	assert.ok(owner)
	assert.equal(db.removeTeamMember(DEFAULT_WORKSPACE_ID, owner.id), "last_owner")
	assert.equal(db.getTeamMemberByIdentitySub(DEFAULT_WORKSPACE_ID, "cognito-owner")?.status, "active")
	assert.equal(db.removeTeamMember(DEFAULT_WORKSPACE_ID, "missing-member"), "not_found")

	db.activateVerifiedTeamMember({
		workspaceId: DEFAULT_WORKSPACE_ID,
		email: "second-owner@acme.test",
		name: "Second Owner",
		identitySub: "cognito-owner-2",
		bootstrapOwner: true,
	})
	assert.equal(db.removeTeamMember(DEFAULT_WORKSPACE_ID, owner.id), "removed")
})

test("workspace secret decryption failures do not silently rotate webhook credentials", () => {
	const db = new CorridorDatabase(":memory:")
	const internal = db as unknown as { db: DatabaseSync }
	internal.db.prepare("UPDATE workspaces SET webhook_signing_secret_enc = ? WHERE id = ?")
		.run("invalid-ciphertext", DEFAULT_WORKSPACE_ID)
	assert.throws(() => db.getWorkspace(DEFAULT_WORKSPACE_ID), /Cannot decrypt webhook signing secret/)
	assert.throws(() => db.getRawWebhookSecret(DEFAULT_WORKSPACE_ID), /Cannot decrypt webhook signing secret/)
	const stored = internal.db.prepare("SELECT webhook_signing_secret_enc FROM workspaces WHERE id = ?")
		.get(DEFAULT_WORKSPACE_ID) as { webhook_signing_secret_enc: string }
	assert.equal(stored.webhook_signing_secret_enc, "invalid-ciphertext")
	db.close()
})

test("SQLite backups include committed WAL records and pass an independent integrity check", () => {
	const sourcePath = resolve(tmpdir(), `corridor-backup-source-${process.pid}-${Date.now()}.db`)
	const backupPath = resolve(tmpdir(), `corridor-backup-copy-${process.pid}-${Date.now()}.db`)
	const db = new CorridorDatabase(sourcePath)
	const settlementCase = {
		caseId: "CASE-BACKUP-01",
		title: "Backup integrity case",
		channelLabel: "test",
		settlementEvidence: "incomplete" as const,
		wire: {
			wireId: "WIRE-BACKUP-01",
			format: "bank_csv" as const,
			valueDate: "2026-11-27",
			settledAmount: { amountMinor: 5000, currency: "USD" },
			senderCharges: [],
			receiverCharges: [],
		},
		createdAt: new Date().toISOString(),
	}
	db.saveCase(settlementCase)
	const raw = JSON.stringify({ invoice: "BACKUP-PRIVATE-01", amount: 5000 })
	const ingestion = db.saveRawIngestion({
		workspaceId: DEFAULT_WORKSPACE_ID,
		sourceChannel: "manual_upload",
		sourceProvider: "test",
		filename: "backup.json",
		format: "json",
		rawContent: raw,
	})
	try {
		const backup = backupCorridorDatabase(sourcePath, backupPath)
		assert.equal(backup.integrity, "ok")
		assert.ok(backup.sizeBytes > 0)
		const restored = new CorridorDatabase(backup.path)
		assert.equal(restored.getPersistedCase(settlementCase.caseId)?.title, settlementCase.title)
		assert.equal(restored.getRawIngestion(ingestion.id)?.rawContent, raw)
		restored.close()
		assert.throws(() => backupCorridorDatabase(sourcePath, backupPath), /already exists/)
	} finally {
		db.close()
		rmSync(sourcePath, { force: true })
		rmSync(`${sourcePath}-wal`, { force: true })
		rmSync(`${sourcePath}-shm`, { force: true })
		rmSync(backupPath, { force: true })
		rmSync(`${backupPath}-wal`, { force: true })
		rmSync(`${backupPath}-shm`, { force: true })
	}
})

test("local case queue uses exclusive claims and recovers expired work", async () => {
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
	assert.equal(db.claimCase(queuedCase.caseId, "worker-one", 5), true)
	assert.equal(db.claimCase(queuedCase.caseId, "worker-two"), false, "a live lease prevents competing workers from starting the case")
	assert.equal(db.listQueuedCases().length, 0, "running work is not also offered as queued work")
	await new Promise((resolve) => setTimeout(resolve, 15))
	assert.deepEqual(db.listQueuedCases().map((item) => item.caseId), [queuedCase.caseId], "expired work becomes eligible for recovery")
	assert.equal(db.claimCase(queuedCase.caseId, "worker-two"), true)
	assert.equal(db.renewCaseLease(queuedCase.caseId, "worker-one"), false, "the former worker cannot renew a reclaimed lease")
	db.markCaseFailed(queuedCase.caseId)
	assert.equal(db.listQueuedCases().length, 0, "failed work is not silently auto retried")
	assert.equal(db.listDeadLetterCases()[0]?.caseId, queuedCase.caseId)
	db.close()
})

test("webhook receipt creation is idempotent and preserves payload conflicts", () => {
	const db = new CorridorDatabase(":memory:")
	const original = db.recordWebhookReceipt({
		provider: "corridor",
		eventId: "evt-idempotency-01",
		sourceChannel: "webhook",
		filename: "event.json",
		format: "json",
		rawContent: "{\"amount\":100}",
	})
	const repeated = db.recordWebhookReceipt({
		provider: "corridor",
		eventId: "evt-idempotency-01",
		sourceChannel: "webhook",
		filename: "event.json",
		format: "json",
		rawContent: "{\"amount\":100}",
	})
	assert.equal(original.duplicate, false)
	assert.equal(repeated.duplicate, true)
	assert.equal(repeated.conflict, false)
	assert.equal(repeated.ingestion.id, original.ingestion.id)
	const conflict = db.recordWebhookReceipt({
		provider: "corridor",
		eventId: "evt-idempotency-01",
		sourceChannel: "webhook",
		filename: "event.json",
		format: "json",
		rawContent: "{\"amount\":101}",
	})
	assert.equal(conflict.duplicate, true)
	assert.equal(conflict.conflict, true)
	assert.equal(db.listRawIngestions({ channel: "webhook" }).length, 1)
	db.close()
})

test("case IDs and raw-ingestion lookups cannot cross workspace boundaries", () => {
	const db = new CorridorDatabase(":memory:")
	const internal = db as unknown as { db: DatabaseSync }
	const now = new Date().toISOString()
	internal.db.prepare(`INSERT INTO workspaces
		(id, name, account_mode, default_currency, tax_country, withholding_tax_bps, variance_threshold_minor,
		inbound_email_address, webhook_signing_secret_enc, require_webhook_signature, created_at, updated_at)
		VALUES (?, ?, 'b2b', 'USD', 'US', 0, 500, ?, ?, 0, ?, ?)`)
		.run("ws-isolation-test", "Isolation Test", "test@inbound.local", encryptSecret("test-secret"), now, now)
	const settlementCase = {
		caseId: "CASE-TENANT-BOUNDARY-01",
		title: "Workspace A case",
		channelLabel: "test",
		settlementEvidence: "incomplete" as const,
		wire: {
			wireId: "WIRE-TENANT-BOUNDARY-01",
			format: "bank_csv" as const,
			valueDate: "2026-11-27",
			settledAmount: { amountMinor: 1000, currency: "USD" },
			senderCharges: [],
			receiverCharges: [],
		},
		createdAt: now,
	}
	db.saveCase(settlementCase)
	assert.throws(() => db.saveCase({ ...settlementCase, title: "Workspace B overwrite" }, "ws-isolation-test"), /already owned by another workspace/)
	assert.equal(db.listPersistedCases(DEFAULT_WORKSPACE_ID)[0]?.title, "Workspace A case")
	const foreignVerdict = { caseId: settlementCase.caseId, completedAt: now } as Parameters<CorridorDatabase["saveAuditVerdict"]>[0]
	assert.throws(() => db.saveAuditVerdict(foreignVerdict, "ws-isolation-test"), /does not belong to workspace/)

	const ingestion = db.saveRawIngestion({
		workspaceId: "ws-isolation-test",
		sourceChannel: "manual_upload",
		sourceProvider: "test",
		filename: "private.json",
		format: "json",
		rawContent: JSON.stringify({ private: true }),
		parseStatus: "failed",
	})
	assert.equal(db.getRawIngestion(ingestion.id, true), null)
	db.updateRawIngestionOutcome({ id: ingestion.id, parseStatus: "parsed" })
	assert.equal(db.getRawIngestion(ingestion.id, true, "ws-isolation-test")?.parseStatus, "failed")
	db.close()
})

test("durable case retries use bounded backoff and expose exhausted jobs for operator replay", async () => {
	const db = new CorridorDatabase(":memory:")
	const settlementCase = {
		caseId: "CASE-RETRY-01",
		title: "Retry and dead letter test",
		channelLabel: "test",
		settlementEvidence: "incomplete" as const,
		wire: {
			wireId: "WIRE-RETRY-01",
			format: "bank_csv" as const,
			valueDate: "2026-11-27",
			settledAmount: { amountMinor: 1000, currency: "USD" },
			senderCharges: [],
			receiverCharges: [],
		},
		createdAt: new Date().toISOString(),
	}
	const verdict = {
		caseId: settlementCase.caseId,
		invoiceId: "INV-RETRY-01",
		wireId: settlementCase.wire.wireId,
		provenance: { appVersion: "test", sourceRevision: "test", workingTree: "clean" as const, auditRulesVersion: "test" },
		status: "EVIDENCE_INCOMPLETE" as const,
		plainEnglishSummary: "Retry queue test verdict",
		numbers: {
			invoicedMinor: 0, invoicedCurrency: "USD", midMarketEquivalentMinor: 0, settledMinor: 1000,
			settledCurrency: "USD", fxSpreadLossMinor: 0, fxSpreadBps: 0, liftingAndRepairFeesMinor: 0,
			platformFeeMinor: 0, withholdingTaxMinor: 0, recoverableFeeMinor: 0, unexplainedVarianceMinor: 0,
		},
		replay: { actualNetMinor: 1000, optimalTransparentNetMinor: 1000, totalLeakMinor: 0, totalLeakBps: 0 },
		sourceRefs: [],
		disclaimer: "Synthetic/public data demonstration only. Not financial or legal advice." as const,
		completedAt: new Date().toISOString(),
	}
	db.saveCase(settlementCase)
	let attempts = 0
	const retryDelays: number[] = []
	const actual = await runWithDurableCaseRetries({
		db,
		caseId: settlementCase.caseId,
		runAttempt: async (workerId) => {
			attempts += 1
			if (attempts < 3) throw new Error(`temporary model gateway failure ${attempts}`)
			db.saveAuditVerdict(verdict, undefined, workerId)
			return verdict
		},
		onRetryScheduled: (_retryAt, delayMs) => retryDelays.push(delayMs),
	})
	assert.equal(actual.caseId, settlementCase.caseId)
	assert.equal(attempts, 3)
	assert.deepEqual(retryDelays, [1000, 5000])
	assert.equal(db.getCaseAttemptCount(settlementCase.caseId), 3)
	assert.equal(db.listQueuedCases().length, 0)
	assert.deepEqual(db.listWorkspaceAuditEvents(DEFAULT_WORKSPACE_ID, 50)
		.filter((event) => event.targetId === settlementCase.caseId)
		.map((event) => event.action).sort(), ["case.audit.complete", "case.queue.claim", "case.queue.claim", "case.queue.claim", "case.queue.retry", "case.queue.retry"].sort())

	const deadLetterCase = { ...settlementCase, caseId: "CASE-DEAD-LETTER-01", title: "Exhausted retry test" }
	db.saveCase(deadLetterCase)
	await assert.rejects(runWithDurableCaseRetries({
		db,
		caseId: deadLetterCase.caseId,
		runAttempt: async () => { throw new Error("permanent provider failure") },
	}))
	assert.equal(db.listDeadLetterCases()[0]?.caseId, deadLetterCase.caseId)
	assert.equal(db.listDeadLetterCases()[0]?.attemptCount, 3)
	assert.match(db.listDeadLetterCases()[0]?.lastError || "", /permanent provider failure/)
	assert.equal(db.retryDeadLetterCase(deadLetterCase.caseId)?.caseId, deadLetterCase.caseId)
	assert.ok(db.listWorkspaceAuditEvents(DEFAULT_WORKSPACE_ID, 50).some((event) => event.action === "case.queue.replay" && event.targetId === deadLetterCase.caseId))
	assert.equal(db.getCaseAttemptCount(deadLetterCase.caseId), 0)
	assert.ok(db.listQueuedCases().some((item) => item.caseId === deadLetterCase.caseId))
	assert.equal(db.verifyWorkspaceAuditChain(DEFAULT_WORKSPACE_ID).valid, true)
	const timeoutCase = { ...settlementCase, caseId: "CASE-TIMEOUT-01", title: "Do not overlap a timed out agent run" }
	db.saveCase(timeoutCase)
	await assert.rejects(runWithDurableCaseRetries({
		db,
		caseId: timeoutCase.caseId,
		runAttempt: async () => { throw new Error("Timed out waiting for audit verdict") },
		shouldRetry: (error) => !(error instanceof Error && error.message.startsWith("Timed out waiting for")),
		sleep: async () => undefined,
	}))
	assert.equal(db.getCaseAttemptCount(timeoutCase.caseId), 1)
	assert.equal(db.listDeadLetterCases()[0]?.caseId, timeoutCase.caseId)
	db.close()
})

test("OAuth authorization state survives restart, expires, and can only be consumed once", () => {
	const dbPath = resolve(tmpdir(), `corridor-oauth-state-${process.pid}-${Date.now()}.db`)
	const firstDb = new CorridorDatabase(dbPath)
	firstDb.storeOAuthAuthorizationState({
		state: "state-restart-test",
		provider: "xero",
		workspaceId: DEFAULT_WORKSPACE_ID,
		codeVerifier: "verifier-test-value",
		expiresAt: new Date(Date.now() + 60_000).toISOString(),
	})
	firstDb.close()

	const reopenedDb = new CorridorDatabase(dbPath)
	assert.deepEqual(reopenedDb.consumeOAuthAuthorizationState("state-restart-test", "xero"), {
		workspaceId: DEFAULT_WORKSPACE_ID,
		codeVerifier: "verifier-test-value",
	})
	assert.equal(reopenedDb.consumeOAuthAuthorizationState("state-restart-test", "xero"), null)
	reopenedDb.storeOAuthAuthorizationState({
		state: "state-expired-test",
		provider: "xero",
		workspaceId: DEFAULT_WORKSPACE_ID,
		expiresAt: new Date(Date.now() - 1000).toISOString(),
	})
	assert.equal(reopenedDb.consumeOAuthAuthorizationState("state-expired-test", "xero"), null)
	reopenedDb.close()
	rmSync(dbPath, { force: true })
})

test("integration token refresh leases coordinate separate SQLite connections and recover after expiry", async () => {
	const dbPath = resolve(tmpdir(), `corridor-refresh-lease-${process.pid}-${Date.now()}.db`)
	const first = new CorridorDatabase(dbPath)
	const second = new CorridorDatabase(dbPath)
	const claim = { workspaceId: DEFAULT_WORKSPACE_ID, provider: "wise", ownerId: "worker-a", leaseMs: 1_000 }
	try {
		assert.equal(first.claimIntegrationRefreshLease(claim), true)
		assert.equal(second.claimIntegrationRefreshLease({ ...claim, ownerId: "worker-b" }), false)
		first.releaseIntegrationRefreshLease({ workspaceId: claim.workspaceId, provider: claim.provider, ownerId: "worker-a" })
		assert.equal(second.claimIntegrationRefreshLease({ ...claim, ownerId: "worker-b" }), true)
		assert.equal(first.claimIntegrationRefreshLease({ ...claim, ownerId: "worker-c" }), false)
		await new Promise((resolve) => setTimeout(resolve, 1_100))
		assert.equal(first.claimIntegrationRefreshLease({ ...claim, ownerId: "worker-c" }), true)
	} finally {
		first.close()
		second.close()
		rmSync(dbPath, { force: true })
	}
})

test("provider sync leases serialize separate SQLite connections and are owner-released", async () => {
	const dbPath = resolve(tmpdir(), `corridor-sync-lease-${process.pid}-${Date.now()}.db`)
	const first = new CorridorDatabase(dbPath)
	const second = new CorridorDatabase(dbPath)
	const claim = { workspaceId: DEFAULT_WORKSPACE_ID, provider: "wise", ownerId: "sync-a", leaseMs: 1_000 }
	try {
		assert.equal(first.claimIntegrationSyncLease(claim), true)
		assert.equal(second.claimIntegrationSyncLease({ ...claim, ownerId: "sync-b" }), false)
		assert.equal(first.renewIntegrationSyncLease(claim), true)
		second.releaseIntegrationSyncLease({ workspaceId: claim.workspaceId, provider: claim.provider, ownerId: "sync-b" })
		assert.equal(second.claimIntegrationSyncLease({ ...claim, ownerId: "sync-b" }), false, "a different owner must not release the active lease")
		first.releaseIntegrationSyncLease(claim)
		assert.equal(second.claimIntegrationSyncLease({ ...claim, ownerId: "sync-b" }), true)
	} finally {
		first.close()
		second.close()
		rmSync(dbPath, { force: true })
	}
})

test("provider HTTP helper aborts a stalled request at its configured timeout", async () => {
	const previousFetch = global.fetch
	let receivedSignal: AbortSignal | undefined
	global.fetch = ((_input, init) => new Promise((_resolve, reject) => {
		receivedSignal = init?.signal as AbortSignal
		receivedSignal.addEventListener("abort", () => reject(receivedSignal?.reason), { once: true })
	})) as typeof fetch
	try {
		await assert.rejects(fetchProvider("https://provider.test/resource", undefined, 5), (error: unknown) => {
			return error instanceof DOMException && error.name === "TimeoutError"
		})
		assert.ok(receivedSignal?.aborted)
	} finally {
		global.fetch = previousFetch
	}
})

test("Xero OAuth uses S256 PKCE and exchanges the persisted verifier", async () => {
	const previousFetch = global.fetch
	const previousClientId = process.env.XERO_CLIENT_ID
	process.env.XERO_CLIENT_ID = "xero-public-client"
	let tokenRequestBody = ""
	let tokenRequestAuthorization = ""
	global.fetch = (async (_input, init) => {
		tokenRequestBody = String(init?.body || "")
		tokenRequestAuthorization = new Headers(init?.headers).get("authorization") || ""
		return new Response(JSON.stringify({ access_token: "xero-access", refresh_token: "xero-refresh", expires_in: 1800 }), { status: 200 })
	}) as typeof fetch
	try {
		const { url: authorizationUrl, state } = createOAuthAuthorizationUrl({
			provider: "xero",
			workspaceId: DEFAULT_WORKSPACE_ID,
			origin: "http://127.0.0.1:3000",
		})
		const authorization = new URL(authorizationUrl)
		assert.equal(authorization.searchParams.get("code_challenge_method"), "S256")
		const { workspaceId, codeVerifier } = consumeOAuthState(state, "xero")
		assert.equal(workspaceId, DEFAULT_WORKSPACE_ID)
		assert.ok(codeVerifier)
		assert.equal(
			authorization.searchParams.get("code_challenge"),
			createHash("sha256").update(codeVerifier, "ascii").digest("base64url"),
		)
		const exchanged = await exchangeOAuthCode({ provider: "xero", code: "authorization-code", origin: "http://127.0.0.1:3000", codeVerifier })
		const tokenBody = new URLSearchParams(tokenRequestBody)
		assert.equal(tokenBody.get("code_verifier"), codeVerifier)
		assert.equal(tokenBody.get("client_id"), "xero-public-client")
		assert.equal(tokenBody.has("client_secret"), false)
		assert.equal(exchanged.credentials.accessToken, "xero-access")
		assert.equal(exchanged.credentials.refreshToken, "xero-refresh")
		const refreshed = await refreshOAuthCredentials("xero", exchanged.credentials)
		assert.equal(tokenRequestAuthorization, `Basic ${Buffer.from("xero-public-client:").toString("base64")}`)
		assert.equal(new URLSearchParams(tokenRequestBody).get("grant_type"), "refresh_token")
		assert.equal(new URLSearchParams(tokenRequestBody).get("refresh_token"), "xero-refresh")
		assert.equal(refreshed.refreshToken, "xero-refresh")
		assert.throws(() => consumeOAuthState(state, "xero"), /already used/)
	} finally {
		global.fetch = previousFetch
		if (previousClientId === undefined) delete process.env.XERO_CLIENT_ID
		else process.env.XERO_CLIENT_ID = previousClientId
	}
})

test("TrueLayer OAuth uses S256 PKCE and persists its verifier for callback exchange", () => {
	const previousClientId = process.env.TRUELAYER_CLIENT_ID
	process.env.TRUELAYER_CLIENT_ID = "truelayer-public-client"
	try {
		const { url, state } = createOAuthAuthorizationUrl({
			provider: "open_banking",
			workspaceId: DEFAULT_WORKSPACE_ID,
			origin: "http://127.0.0.1:3000",
		})
		const authorization = new URL(url)
		assert.equal(authorization.searchParams.get("code_challenge_method"), "S256")
		const { codeVerifier } = consumeOAuthState(state, "open_banking")
		assert.ok(codeVerifier)
		assert.equal(
			authorization.searchParams.get("code_challenge"),
			createHash("sha256").update(codeVerifier, "ascii").digest("base64url"),
		)
	} finally {
		if (previousClientId === undefined) delete process.env.TRUELAYER_CLIENT_ID
		else process.env.TRUELAYER_CLIENT_ID = previousClientId
	}
})

test("QuickBooks token refresh is serialized and the rotated refresh token is persisted before sync", async () => {
	const db = getCorridorDb()
	const previousFetch = global.fetch
	const previousClientId = process.env.QUICKBOOKS_CLIENT_ID
	const previousClientSecret = process.env.QUICKBOOKS_CLIENT_SECRET
	process.env.QUICKBOOKS_CLIENT_ID = "qbo-client-test"
	process.env.QUICKBOOKS_CLIENT_SECRET = "qbo-client-secret-test"
	db.upsertIntegration({
		workspaceId: DEFAULT_WORKSPACE_ID,
		provider: "quickbooks",
		category: "accounting",
		authMode: "oauth2",
		status: "connected",
		credentials: {
			accessToken: "expired-access",
			refreshToken: "old-refresh-token",
			expiresAt: new Date(Date.now() - 1000).toISOString(),
		},
		config: { realmId: "realm-refresh-test" },
	})
	let tokenRequests = 0
	let apiRequests = 0
	global.fetch = (async (input, init) => {
		if (String(input).includes("oauth.platform.intuit.com")) {
			tokenRequests += 1
			assert.equal(new Headers(init?.headers).get("authorization"), `Basic ${Buffer.from("qbo-client-test:qbo-client-secret-test").toString("base64")}`)
			assert.equal(new URLSearchParams(String(init?.body)).get("refresh_token"), "old-refresh-token")
			return new Response(JSON.stringify({ access_token: "new-access-token", refresh_token: "rotated-refresh-token", expires_in: 3600 }), { status: 200 })
		}
		if (String(input).includes("quickbooks.api.intuit.com")) {
			apiRequests += 1
			assert.equal(new Headers(init?.headers).get("authorization"), "Bearer new-access-token")
			return new Response(JSON.stringify({ QueryResponse: { Invoice: [] } }), { status: 200 })
		}
		throw new Error(`Unexpected QuickBooks request: ${String(input)}`)
	}) as typeof fetch
	const orchestrator = { state: { casesById: new Map() } } as unknown as Parameters<typeof runIntegrationSync>[0]["orchestrator"]
	try {
		const results = await Promise.all([
			runIntegrationSync({ provider: "quickbooks", trigger: "manual", workspaceId: DEFAULT_WORKSPACE_ID, orchestrator }),
			runIntegrationSync({ provider: "quickbooks", trigger: "manual", workspaceId: DEFAULT_WORKSPACE_ID, orchestrator }),
		])
		assert.ok(results.every((result) => result.status === "success"))
		assert.equal(tokenRequests, 1)
		assert.equal(apiRequests, 2)
		assert.equal(db.getDecryptedCredentials(DEFAULT_WORKSPACE_ID, "quickbooks")?.accessToken, "new-access-token")
		assert.equal(db.getDecryptedCredentials(DEFAULT_WORKSPACE_ID, "quickbooks")?.refreshToken, "rotated-refresh-token")
	} finally {
		global.fetch = previousFetch
		if (previousClientId === undefined) delete process.env.QUICKBOOKS_CLIENT_ID
		else process.env.QUICKBOOKS_CLIENT_ID = previousClientId
		if (previousClientSecret === undefined) delete process.env.QUICKBOOKS_CLIENT_SECRET
		else process.env.QUICKBOOKS_CLIENT_SECRET = previousClientSecret
		db.disconnectIntegration(DEFAULT_WORKSPACE_ID, "quickbooks")
	}
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
		metadata: { customer: "PRIVATE-CUSTOMER-01" },
		parseStatus: "failed",
		parseError: "PRIVATE-PARSER-DETAIL",
	})
	assert.equal(ingestion.rawContent, raw)
	assert.deepEqual(ingestion.metadata, { customer: "PRIVATE-CUSTOMER-01" })
	assert.equal(ingestion.filename, "private.json")
	assert.equal(ingestion.parseError, "PRIVATE-PARSER-DETAIL")
	db.close()

	const inspection = new DatabaseSync(dbPath)
	const stored = inspection.prepare(`SELECT raw_content, raw_content_encrypted, filename, filename_encrypted,
		metadata_json, metadata_json_encrypted, parse_error, parse_error_encrypted FROM raw_ingestions WHERE id = ?`)
		.get(ingestion.id) as {
			raw_content: string
			raw_content_encrypted: number
			filename: string
			filename_encrypted: number
			metadata_json: string
			metadata_json_encrypted: number
			parse_error: string
			parse_error_encrypted: number
		}
	assert.equal(stored.raw_content_encrypted, 1)
	assert.ok(stored.raw_content.startsWith("v1:"))
	assert.ok(!stored.raw_content.includes("PRIVATE-INV-01"))
	assert.equal(stored.filename_encrypted, 1)
	assert.equal(stored.metadata_json_encrypted, 1)
	assert.equal(stored.parse_error_encrypted, 1)
	assert.ok(!stored.filename.includes("private.json"))
	assert.ok(!stored.metadata_json.includes("PRIVATE-CUSTOMER-01"))
	assert.ok(!stored.parse_error.includes("PRIVATE-PARSER-DETAIL"))
	inspection.prepare(`UPDATE raw_ingestions SET raw_content = ?, raw_content_encrypted = 0,
		filename = ?, filename_encrypted = 0, metadata_json = ?, metadata_json_encrypted = 0,
		parse_error = ?, parse_error_encrypted = 0 WHERE id = ?`)
		.run(raw, "private.json", JSON.stringify({ customer: "PRIVATE-CUSTOMER-01" }), "PRIVATE-PARSER-DETAIL", ingestion.id)
	inspection.close()

	const reopened = new CorridorDatabase(dbPath)
	const migratedIngestion = reopened.getRawIngestion(ingestion.id, true)
	assert.equal(migratedIngestion?.rawContent, raw)
	assert.equal(migratedIngestion?.filename, "private.json")
	assert.deepEqual(migratedIngestion?.metadata, { customer: "PRIVATE-CUSTOMER-01" })
	assert.equal(migratedIngestion?.parseError, "PRIVATE-PARSER-DETAIL")
	reopened.close()
	const migrated = new DatabaseSync(dbPath)
	const migratedRow = migrated.prepare(`SELECT raw_content, raw_content_encrypted, filename_encrypted,
		metadata_json_encrypted, parse_error_encrypted FROM raw_ingestions WHERE id = ?`).get(ingestion.id) as {
		raw_content: string
		raw_content_encrypted: number
		filename_encrypted: number
		metadata_json_encrypted: number
		parse_error_encrypted: number
	}
	assert.equal(migratedRow.raw_content_encrypted, 1)
	assert.equal(migratedRow.filename_encrypted, 1)
	assert.equal(migratedRow.metadata_json_encrypted, 1)
	assert.equal(migratedRow.parse_error_encrypted, 1)
	assert.ok(migratedRow.raw_content.startsWith("v1:"))
	migrated.close()
	rmSync(dbPath, { force: true })
})

test("normalized cases, verdicts, and approval payloads encrypt at rest and migrate legacy rows", () => {
	const dbPath = resolve(tmpdir(), `corridor-encrypted-financial-records-${process.pid}-${Date.now()}.db`)
	const db = new CorridorDatabase(dbPath)
	const settlementCase = {
		caseId: "CASE-PRIVATE-AT-REST",
		title: "Private vendor settlement",
		channelLabel: "test",
		settlementEvidence: "incomplete" as const,
		invoice: {
			invoiceId: "PRIVATE-INVOICE-42",
			vendorOrClient: "Private Vendor GmbH",
			issueDate: "2026-11-27",
			dueDate: "2026-12-27",
			expectedAmount: { amountMinor: 125000, currency: "EUR" },
			expectedSettlementCurrency: "EUR",
			contractedChargeBearer: "SHA" as const,
			sourceRefs: [],
		},
		wire: {
			wireId: "PRIVATE-WIRE-42",
			format: "bank_csv" as const,
			valueDate: "2026-11-27",
			settledAmount: { amountMinor: 125000, currency: "EUR" },
			senderCharges: [],
			receiverCharges: [],
		},
		createdAt: new Date().toISOString(),
	}
	const verdict = {
		caseId: settlementCase.caseId,
		invoiceId: "PRIVATE-INVOICE-42",
		wireId: "PRIVATE-WIRE-42",
		provenance: { appVersion: "test", sourceRevision: "test", workingTree: "clean" as const, auditRulesVersion: "test" },
		status: "EVIDENCE_INCOMPLETE" as const,
		plainEnglishSummary: "Private Vendor GmbH record",
		numbers: {
			invoicedMinor: 125000, invoicedCurrency: "EUR", midMarketEquivalentMinor: 125000, settledMinor: 125000,
			settledCurrency: "EUR", fxSpreadLossMinor: 0, fxSpreadBps: 0, liftingAndRepairFeesMinor: 0,
			platformFeeMinor: 0, withholdingTaxMinor: 0, recoverableFeeMinor: 0, unexplainedVarianceMinor: 0,
		},
		replay: { actualNetMinor: 125000, optimalTransparentNetMinor: 125000, totalLeakMinor: 0, totalLeakBps: 0 },
		sourceRefs: [],
		disclaimer: "Synthetic/public data demonstration only. Not financial or legal advice." as const,
		completedAt: new Date().toISOString(),
	}
	const approval = {
		caseId: settlementCase.caseId,
		agentName: "AuditorAgent",
		toolName: "finalize_settlement_action",
		actionType: "FILE_OUR_FEE_DISPUTE",
		question: "Review payment for Private Vendor GmbH",
		proofLine: "Private settlement reference",
		recoverableMinor: 250,
		currency: "EUR",
		argsJson: JSON.stringify({ caseId: settlementCase.caseId }),
		riskLabel: "Medium Risk",
		createdAt: new Date().toISOString(),
	}
	db.saveCase(settlementCase)
	db.saveAuditVerdict(verdict)
	assert.equal(db.listWorkspaceAuditEvents(DEFAULT_WORKSPACE_ID).find((event) => event.action === "case.audit.complete")?.targetId, settlementCase.caseId)
	db.createPendingApproval(approval)
	db.close()

	const inspection = new DatabaseSync(dbPath)
	const storedCase = inspection.prepare("SELECT payload_json, payload_json_encrypted FROM cases WHERE case_id = ?")
		.get(settlementCase.caseId) as { payload_json: string; payload_json_encrypted: number }
	const storedVerdict = inspection.prepare("SELECT verdict_json, verdict_json_encrypted FROM audit_verdicts WHERE case_id = ?")
		.get(settlementCase.caseId) as { verdict_json: string; verdict_json_encrypted: number }
	const storedApproval = inspection.prepare("SELECT pending_json, pending_json_encrypted FROM review_approvals WHERE case_id = ?")
		.get(settlementCase.caseId) as { pending_json: string; pending_json_encrypted: number }
	assert.equal(storedCase.payload_json_encrypted, 1)
	assert.ok(storedCase.payload_json.startsWith("v1:"))
	assert.ok(!storedCase.payload_json.includes("Private Vendor GmbH"))
	assert.equal(storedVerdict.verdict_json_encrypted, 1)
	assert.ok(storedVerdict.verdict_json.startsWith("v1:"))
	assert.ok(!storedVerdict.verdict_json.includes("Private Vendor GmbH"))
	assert.equal(storedApproval.pending_json_encrypted, 1)
	assert.ok(storedApproval.pending_json.startsWith("v1:"))
	assert.ok(!storedApproval.pending_json.includes("Private Vendor GmbH"))
	inspection.prepare("UPDATE cases SET payload_json = ?, payload_json_encrypted = 0 WHERE case_id = ?")
		.run(JSON.stringify(settlementCase), settlementCase.caseId)
	inspection.prepare("UPDATE audit_verdicts SET verdict_json = ?, verdict_json_encrypted = 0 WHERE case_id = ?")
		.run(JSON.stringify(verdict), settlementCase.caseId)
	inspection.prepare("UPDATE review_approvals SET pending_json = ?, pending_json_encrypted = 0 WHERE case_id = ?")
		.run(JSON.stringify(approval), settlementCase.caseId)
	inspection.close()

	const reopened = new CorridorDatabase(dbPath)
	assert.equal(reopened.listPersistedCases()[0]?.invoice?.vendorOrClient, "Private Vendor GmbH")
	assert.equal(reopened.listPersistedVerdicts()[0]?.plainEnglishSummary, "Private Vendor GmbH record")
	reopened.close()
	const migrated = new DatabaseSync(dbPath)
	assert.equal((migrated.prepare("SELECT payload_json_encrypted AS encrypted FROM cases WHERE case_id = ?").get(settlementCase.caseId) as { encrypted: number }).encrypted, 1)
	assert.equal((migrated.prepare("SELECT verdict_json_encrypted AS encrypted FROM audit_verdicts WHERE case_id = ?").get(settlementCase.caseId) as { encrypted: number }).encrypted, 1)
	assert.equal((migrated.prepare("SELECT pending_json_encrypted AS encrypted FROM review_approvals WHERE case_id = ?").get(settlementCase.caseId) as { encrypted: number }).encrypted, 1)
	migrated.close()
	rmSync(dbPath, { force: true })
})

test("review decisions persist against the exact breakpoint call and retain human override provenance", () => {
	const db = new CorridorDatabase(":memory:")
	const pending = {
		caseId: "CASE-APPROVAL-01",
		agentName: "AuditorAgent",
		toolName: "finalize_settlement_action",
		actionType: "FILE_OUR_FEE_DISPUTE",
		question: "Approve a fee dispute draft?",
		proofLine: "Observed receiver fee exceeds contract",
		recoverableMinor: 125,
		currency: "USD",
		argsJson: JSON.stringify({ caseId: "CASE-APPROVAL-01", actionType: "FILE_OUR_FEE_DISPUTE" }),
		riskLabel: "Medium Risk",
		createdAt: new Date().toISOString(),
	}
	db.createPendingApproval(pending)
	const rejected = db.resolvePendingApproval({
		caseId: pending.caseId,
		decision: "reject",
		reason: "Keep the relationship, treat this as SHA.",
		reviewerSub: "user-123",
		reviewerEmail: "controller@acme.test",
		reviewerRole: "controller",
	})
	assert.ok(rejected)
	const reviewEvent = db.listWorkspaceAuditEvents(DEFAULT_WORKSPACE_ID).find((event) => event.action === "review.decision")
	assert.equal(reviewEvent?.actorEmail, "controller@acme.test")
	assert.equal(reviewEvent?.metadata.decision, "reject")
	assert.equal(JSON.stringify(reviewEvent).includes("Keep the relationship"), false)
	assert.deepEqual(db.findStoredReviewDecision(pending.caseId, pending.argsJson), {
		approvalId: rejected,
		decision: "reject",
		reason: "Keep the relationship, treat this as SHA.",
	})
	assert.equal(db.findStoredReviewDecision(pending.caseId, `${pending.argsJson} `), null)
	assert.equal(db.findStoredHumanOverride(pending.caseId, "Keep the relationship, treat this as SHA."), true)
	assert.equal(db.findStoredHumanOverride(pending.caseId, "model-invented note"), false)
	db.close()
})

test("provider sync retains original API payloads and converts Wise currencies to minor units", async () => {
	const previousFetch = global.fetch
	const stripeRaw = JSON.stringify({ data: [{ id: "po_test_1", amount: 1099, currency: "usd", arrival_date: 1795737600 }] })
	global.fetch = (async () => new Response(stripeRaw, { status: 200 })) as typeof fetch
	try {
	const stripe = await fetchCasesFromIntegration({
		integration: {
			id: "int_stripe_test",
			workspaceId: DEFAULT_WORKSPACE_ID,
			provider: "stripe",
			category: "payouts",
			authMode: "api_token",
			status: "connected",
			config: {},
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		},
		credentials: { apiKey: "sk_test" },
	})
	assert.equal(stripe.rawPayload, stripeRaw)
	assert.equal(stripe.cases[0]?.wire.settledAmount.amountMinor, 1099)

	const wiseResponses = [
		JSON.stringify([{ id: 123 }]),
		JSON.stringify([{
			id: 456,
			sourceCurrency: "JPY",
			sourceValue: 1200,
			targetCurrency: "KWD",
			targetValue: 4.321,
			rate: 0.0036,
			created: "2026-11-27T10:00:00Z",
		}]),
	]
	let responseIndex = 0
	global.fetch = (async () => new Response(wiseResponses[responseIndex++], { status: 200 })) as typeof fetch
		const wise = await fetchCasesFromIntegration({
			integration: {
				id: "int_wise_test",
				workspaceId: DEFAULT_WORKSPACE_ID,
				provider: "wise",
				category: "payouts",
				authMode: "api_token",
				status: "connected",
				config: {},
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			},
			credentials: { apiKey: "wise_test" },
		})
		assert.deepEqual(JSON.parse(wise.rawPayload || "{}").pageResponses, wiseResponses)
		assert.equal(wise.cases[0]?.wire.instructedAmount?.amountMinor, 1200)
		assert.equal(wise.cases[0]?.wire.settledAmount.amountMinor, 4321)

		const accountingIntegrations: Array<{ provider: string; config: Record<string, string>; payload: Record<string, unknown> }> = [
			{
				provider: "quickbooks",
				config: { realmId: "realm-test" },
				payload: { QueryResponse: { Invoice: [{ Id: "qbo-1", DocNumber: "INV-1", TotalAmt: 120, TxnDate: "2026-11-27", CurrencyRef: { value: "USD" } }] } },
			},
			{
				provider: "xero",
				config: { tenantId: "tenant-test" },
				payload: { Invoices: [{ InvoiceID: "xero-1", InvoiceNumber: "INV-2", Total: 85, DateString: "2026-11-27", CurrencyCode: "EUR" }] },
			},
		]
		for (const item of accountingIntegrations) {
			const rawPayload = JSON.stringify(item.payload)
			global.fetch = (async () => new Response(rawPayload, { status: 200 })) as typeof fetch
			const result = await fetchCasesFromIntegration({
				integration: {
					id: `int_${item.provider}_test`,
					workspaceId: DEFAULT_WORKSPACE_ID,
					provider: item.provider,
					category: "accounting",
					authMode: "oauth2",
					status: "connected",
					config: item.config,
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				},
				credentials: { accessToken: "accounting-test" },
			})
			assert.equal(result.rawPayload, rawPayload)
			assert.equal(result.cases[0]?.settlementEvidence, "estimated")
			assert.equal(result.cases[0]?.wire.settledAmount.amountMinor, 0)
			assert.match(result.cases[0]?.evidenceGap || "", /did not fetch a matching payment/)
		}
	} finally {
		global.fetch = previousFetch
	}
})

test("provider sync follows Stripe, Wise, QuickBooks, and Xero page cursors", async () => {
	const previousFetch = global.fetch
	const requests: string[] = []
	const stripeFirst = JSON.stringify({
		data: Array.from({ length: 100 }, (_, index) => ({
			id: `po_${index}`,
			amount: 100,
			currency: "usd",
			arrival_date: 1795737600,
			created: 1795737600,
		})),
		has_more: true,
	})
	const stripeLast = JSON.stringify({ data: [{ id: "po_last", amount: 200, currency: "usd", arrival_date: 1795737600, created: 1795737600 }], has_more: false })
	const wiseFirst = JSON.stringify(Array.from({ length: 100 }, (_, index) => ({
		id: index + 1,
		sourceCurrency: "USD",
		sourceValue: 10,
		targetCurrency: "EUR",
		targetValue: 9,
		rate: 0.9,
		created: "2026-11-27T10:00:00Z",
	})))
	const wiseLast = JSON.stringify([{ id: 101, sourceCurrency: "USD", sourceValue: 10, targetCurrency: "EUR", targetValue: 9, rate: 0.9, created: "2026-11-27T10:00:00Z" }])
	const qboInvoices = Array.from({ length: 1000 }, (_, index) => ({ Id: `qbo-${index}`, TotalAmt: 10, CurrencyRef: { value: "USD" } }))
	const xeroInvoices = Array.from({ length: 1000 }, (_, index) => ({ InvoiceID: `xero-${index}`, Total: 10, CurrencyCode: "EUR" }))
	global.fetch = (async (input) => {
		const url = String(input)
		requests.push(url)
		if (url.includes("stripe.com")) return new Response(requests.filter((item) => item.includes("stripe.com")).length === 1 ? stripeFirst : stripeLast, { status: 200 })
		if (url.includes("transferwise.com")) return new Response(requests.filter((item) => item.includes("transferwise.com")).length === 1 ? wiseFirst : wiseLast, { status: 200 })
		if (url.includes("quickbooks.api.intuit.com")) {
			const firstPage = decodeURIComponent(url).includes("STARTPOSITION 1 MAXRESULTS")
			return new Response(JSON.stringify({ QueryResponse: { Invoice: firstPage ? qboInvoices : [{ Id: "qbo-last", TotalAmt: 20, CurrencyRef: { value: "USD" } }] } }), { status: 200 })
		}
		if (url.includes("api.xero.com")) {
			return new Response(JSON.stringify({ Invoices: url.includes("page=1&") ? xeroInvoices : [{ InvoiceID: "xero-last", Total: 20, CurrencyCode: "EUR" }] }), { status: 200 })
		}
		throw new Error(`Unexpected provider request: ${url}`)
	}) as typeof fetch

	const integration = (provider: "stripe" | "wise" | "quickbooks" | "xero", config: Record<string, string> = {}) => ({
		id: `int_${provider}_paging`,
		workspaceId: DEFAULT_WORKSPACE_ID,
		provider,
		category: provider === "quickbooks" || provider === "xero" ? "accounting" as const : "payouts" as const,
		authMode: provider === "quickbooks" || provider === "xero" ? "oauth2" as const : "api_token" as const,
		status: "connected" as const,
		config,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	})

	try {
		const stripe = await fetchCasesFromIntegration({ integration: integration("stripe"), credentials: { apiKey: "stripe-test" } })
		assert.equal(stripe.recordsFetched, 101)
		assert.equal(stripe.cases.length, 101)
		assert.equal(requests.filter((url) => url.includes("stripe.com")).length, 2)
		assert.ok(requests.some((url) => url.includes("starting_after=po_99")))

		const wise = await fetchCasesFromIntegration({ integration: integration("wise", { profileId: "profile-1" }), credentials: { apiKey: "wise-test" } })
		assert.equal(wise.recordsFetched, 101)
		assert.equal(wise.cases.length, 101)
		assert.ok(requests.some((url) => url.includes("offset=100")))

		const quickBooks = await fetchCasesFromIntegration({ integration: integration("quickbooks", { realmId: "realm-1" }), credentials: { accessToken: "qbo-test" } })
		assert.equal(quickBooks.recordsFetched, 1001)
		assert.equal(requests.filter((url) => url.includes("quickbooks.api.intuit.com")).length, 2)
		assert.ok(requests.some((url) => decodeURIComponent(url).includes("STARTPOSITION 1001")))

		const xero = await fetchCasesFromIntegration({ integration: integration("xero", { tenantId: "tenant-1" }), credentials: { accessToken: "xero-test" } })
		assert.equal(xero.recordsFetched, 1001)
		assert.equal(requests.filter((url) => url.includes("api.xero.com")).length, 2)
		assert.ok(requests.some((url) => url.includes("page=2&pageSize=1000")))
	} finally {
		global.fetch = previousFetch
	}
})

test("Stripe and Xero incremental sync cursors use a five-minute overlap", async () => {
	const previousFetch = global.fetch
	const requests: Array<{ url: URL; headers: Headers }> = []
	global.fetch = (async (input, init) => {
		requests.push({ url: new URL(String(input)), headers: new Headers(init?.headers) })
		return new Response(String(input).includes("stripe.com")
			? JSON.stringify({ data: [], has_more: false })
			: JSON.stringify({ Invoices: [] }), { status: 200 })
	}) as typeof fetch
	const lastSuccessfulSyncAt = "2026-11-27T12:00:00.000Z"
	const integration = (provider: "stripe" | "xero", config: Record<string, string> = {}) => ({
		id: `int_${provider}_cursor`,
		workspaceId: DEFAULT_WORKSPACE_ID,
		provider,
		category: provider === "xero" ? "accounting" as const : "payouts" as const,
		authMode: provider === "xero" ? "oauth2" as const : "api_token" as const,
		status: "connected" as const,
		config,
		createdAt: lastSuccessfulSyncAt,
		updatedAt: lastSuccessfulSyncAt,
	})
	try {
		await fetchCasesFromIntegration({
			integration: integration("stripe"), credentials: { apiKey: "stripe-test" }, lastSuccessfulSyncAt,
		})
		await fetchCasesFromIntegration({
			integration: integration("xero", { tenantId: "tenant-cursor" }), credentials: { accessToken: "xero-test" }, lastSuccessfulSyncAt,
		})
		const stripeSince = new Date(Date.parse(lastSuccessfulSyncAt) - 5 * 60 * 1000)
		assert.equal(requests[0]?.url.searchParams.get("created[gte]"), String(Math.floor(stripeSince.getTime() / 1000)))
		assert.equal(requests[1]?.headers.get("If-Modified-Since"), stripeSince.toISOString().slice(0, 19))
	} finally {
		global.fetch = previousFetch
	}
})

test("QuickBooks incremental invoice sync filters on MetaData.LastUpdatedTime with overlap", async () => {
	const previousFetch = global.fetch
	const requests: URL[] = []
	global.fetch = (async (input) => {
		requests.push(new URL(String(input)))
		return new Response(JSON.stringify({ QueryResponse: { Invoice: [] } }), { status: 200 })
	}) as typeof fetch
	try {
		const integration = {
			id: "int_qbo_cursor",
			workspaceId: DEFAULT_WORKSPACE_ID,
			provider: "quickbooks",
			category: "accounting" as const,
			authMode: "oauth2" as const,
			status: "connected" as const,
			config: { realmId: "realm-cursor" },
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		}
		const fetched = await fetchCasesFromIntegration({
			integration,
			credentials: { accessToken: "qbo-test" },
			lastSuccessfulSyncAt: "2026-11-27T12:00:00.000Z",
		})
		assert.equal(fetched.recordsFetched, 0)
		assert.equal(requests.length, 1)
		assert.ok(decodeURIComponent(requests[0]!.searchParams.get("query")!).includes("WHERE MetaData.LastUpdatedTime > '2026-11-27T11:55:00.000Z'"))
		assert.ok(decodeURIComponent(requests[0]!.searchParams.get("query")!).includes("ORDERBY MetaData.LastUpdatedTime DESC"))
	} finally {
		global.fetch = previousFetch
	}
})

test("changed Xero invoice data creates an immutable source revision case", async () => {
	const db = getCorridorDb()
	const previousFetch = global.fetch
	db.upsertIntegration({
		workspaceId: DEFAULT_WORKSPACE_ID,
		provider: "xero",
		category: "accounting",
		authMode: "oauth2",
		status: "connected",
		credentials: { accessToken: "xero-cursor-test" },
		config: { tenantId: "tenant-revision-test" },
	})
	let amount = 100
	let fetchCount = 0
	global.fetch = (async (_input, init) => {
		fetchCount += 1
		if (fetchCount === 1) assert.equal(new Headers(init?.headers).has("If-Modified-Since"), false)
		else assert.equal(new Headers(init?.headers).has("If-Modified-Since"), true)
		return new Response(JSON.stringify({ Invoices: [{
			InvoiceID: "xero-source-revision-01",
			InvoiceNumber: "INV-REVISION-01",
			Total: amount,
			CurrencyCode: "EUR",
			DateString: "2026-11-27",
			Contact: { Name: "Revision Test Vendor" },
		}] }), { status: 200 })
	}) as typeof fetch
	const orchestrator = {
		state: { casesById: new Map() },
		enqueueBatch: async (cases: import("../src/core/types").SettlementCase[]) => {
			for (const settlementCase of cases) db.saveCase(settlementCase)
			return []
		},
	} as unknown as Parameters<typeof runIntegrationSync>[0]["orchestrator"]
	try {
		const initial = await runIntegrationSync({ provider: "xero", workspaceId: DEFAULT_WORKSPACE_ID, orchestrator })
		assert.equal(initial.status, "success")
		assert.equal(initial.casesQueued, 1)
		amount = 125
		const changed = await runIntegrationSync({ provider: "xero", workspaceId: DEFAULT_WORKSPACE_ID, orchestrator })
		assert.equal(changed.status, "success")
		assert.equal(changed.casesQueued, 1)
		const repeated = await runIntegrationSync({ provider: "xero", workspaceId: DEFAULT_WORKSPACE_ID, orchestrator })
		assert.equal(repeated.status, "success")
		assert.equal(repeated.casesQueued, 0, "replaying an unchanged cursor window must not create duplicate revisions")
		const cases = db.listPersistedCases().filter((item) => item.caseId.startsWith("XERO-INV-REVISION-01"))
		assert.equal(cases.length, 2)
		const revision = cases.find((item) => item.sourceRevisionOf === "XERO-INV-REVISION-01")
		assert.equal(revision?.invoice?.expectedAmount.amountMinor, 12500)
	} finally {
		global.fetch = previousFetch
		db.disconnectIntegration(DEFAULT_WORKSPACE_ID, "xero")
	}
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
	const invalidMemberRole = await postWorkspaceRoute(
		new Request("http://127.0.0.1/api/settings/workspace", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "add_member", memberEmail: "bad-role@acme.test", memberName: "Bad Role", memberRole: "superadmin" }),
		}),
	)
	assert.equal(invalidMemberRole.status, 400)
	const missingMemberId = await postWorkspaceRoute(
		new Request("http://127.0.0.1/api/settings/workspace", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "remove_member", requireWebhookSignature: false }),
		}),
	)
	assert.equal(missingMemberId.status, 400)

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
		id: "evt-WH-SIGNED-01",
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
	const duplicateWebhookRes = await inboundWebhookRoute(
		new Request("http://127.0.0.1/api/webhooks/inbound", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-corridor-signature": `sha256=${sig}`,
			},
			body: payload,
		}),
	)
	assert.equal(duplicateWebhookRes.status, 200)
	assert.equal((await duplicateWebhookRes.json()).duplicate, true)
	const conflictingPayload = payload.replace("Signed Webhook Case", "Changed Webhook Case")
	const conflictingSig = createHmac("sha256", secret).update(conflictingPayload, "utf8").digest("hex")
	const conflictingWebhookRes = await inboundWebhookRoute(
		new Request("http://127.0.0.1/api/webhooks/inbound", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-corridor-signature": `sha256=${conflictingSig}`,
			},
			body: conflictingPayload,
		}),
	)
	assert.equal(conflictingWebhookRes.status, 409, "reused event IDs with changed payloads must be rejected")
	const unsupportedPayload = JSON.stringify({ id: "evt-WH-UNSUPPORTED-01", type: "customer.updated" })
	const unsupportedSig = createHmac("sha256", secret).update(unsupportedPayload, "utf8").digest("hex")
	const unsupportedWebhookRes = await inboundWebhookRoute(
		new Request("http://127.0.0.1/api/webhooks/inbound", {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-corridor-signature": `sha256=${unsupportedSig}` },
			body: unsupportedPayload,
		}),
	)
	assert.equal(unsupportedWebhookRes.status, 422, "unsupported signed events are stored as failed evidence, not acknowledged as queued")

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
	const duplicateEmailRes = await emailWebhookRoute(
		new Request("http://127.0.0.1/api/webhooks/email", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-corridor-signature": `sha256=${emailSig}`,
			},
			body: emailBody,
		}),
	)
	assert.equal(duplicateEmailRes.status, 200)
	const malformedEmail = "{not-json"
	const malformedEmailSig = createHmac("sha256", secret).update(malformedEmail, "utf8").digest("hex")
	const malformedEmailRes = await emailWebhookRoute(
		new Request("http://127.0.0.1/api/webhooks/email", {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-corridor-signature": `sha256=${malformedEmailSig}` },
			body: malformedEmail,
		}),
	)
	assert.equal(malformedEmailRes.status, 422, "signed malformed email payloads are retained and reported as parse failures")
	const invalidEmailShape = JSON.stringify({ from: 17, attachments: "not-an-array" })
	const invalidEmailShapeSig = createHmac("sha256", secret).update(invalidEmailShape, "utf8").digest("hex")
	const invalidEmailShapeRes = await emailWebhookRoute(
		new Request("http://127.0.0.1/api/webhooks/email", {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-corridor-signature": `sha256=${invalidEmailShapeSig}` },
			body: invalidEmailShape,
		}),
	)
	assert.equal(invalidEmailShapeRes.status, 422, "signed email JSON with an invalid envelope is rejected after being retained")
	const invalidEmailShapeJson = await invalidEmailShapeRes.json() as { ingestionId?: string }
	assert.ok(invalidEmailShapeJson.ingestionId)
	assert.equal(getCorridorDb().getRawIngestion(invalidEmailShapeJson.ingestionId!)?.parseStatus, "failed")

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
	const ingestionEvents = getCorridorDb().listWorkspaceAuditEvents(DEFAULT_WORKSPACE_ID, 100)
	assert.ok(ingestionEvents.some((event) => event.action === "ingestion.received"))
	assert.ok(ingestionEvents.some((event) => event.action === "ingestion.parse.complete"))
	assert.ok(ingestionEvents.some((event) => event.action === "webhook.status.queued"))

	const targetId = listJson.ingestions.find((ingestion) => ingestion.caseIds.length > 0)!.id
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
