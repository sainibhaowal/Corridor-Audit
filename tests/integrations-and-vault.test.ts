import assert from "node:assert/strict"
import { createHash, createHmac } from "node:crypto"
import { rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { createServer } from "node:http"
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
import { CORRIDOR_SCHEMA_SQL } from "../src/core/db/schema"
import { parseInboundEmailToCases } from "../src/core/integrations/email-parser"
import { getWiseEnvironmentConfig } from "../src/core/integrations/wise-environment"
import { deriveWebhookEventId } from "../src/core/security/webhook-event-id"
import { fetchCasesFromIntegration, ProviderSyncLimitError } from "../src/core/integrations/connectors"
import { assertProviderEndpointHostAllowed, assertProviderEndpointResolvesPublicly, fetchProvider, fetchValidatedProviderEndpoint, MAX_GENERIC_PROVIDER_RESPONSE_BYTES, ProviderEndpointResponseLimitError, validateProviderEndpointUrl } from "../src/core/integrations/http"
import { consumeOAuthState, createOAuthAuthorizationUrl, exchangeOAuthCode, refreshOAuthCredentials } from "../src/core/integrations/oauth"
import { runIntegrationSync, shouldRunFullProviderReconciliation } from "../src/runtime/workers/sync-worker"
import { runWithDurableCaseRetries } from "../src/runtime/workers/durable-case-queue"
import { resolveInvalidatedPendingApprovals } from "../src/runtime/workers/review-approval-expiry"
import { CorridorState } from "../src/runtime/corridor-runtime"
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

test("existing SQLite databases add the manual submitter column without replacing case data", () => {
	const dbPath = resolve(tmpdir(), `corridor-submitter-migration-${process.pid}-${Date.now()}.db`)
	const legacySchema = CORRIDOR_SCHEMA_SQL.replace("\tsubmitted_by_sub TEXT,\n", "")
	assert.notEqual(legacySchema, CORRIDOR_SCHEMA_SQL, "the fixture must represent the schema before the new column")
	const legacyDb = new DatabaseSync(dbPath)
	legacyDb.exec(legacySchema)
	legacyDb.close()
	const upgradedDb = new CorridorDatabase(dbPath)
	try {
		const columns = (upgradedDb as unknown as { db: DatabaseSync }).db.prepare("PRAGMA table_info(cases)").all() as Array<{ name: string }>
		assert.ok(columns.some((column) => column.name === "submitted_by_sub"))
	} finally {
		upgradedDb.close()
		rmSync(dbPath, { force: true })
		rmSync(`${dbPath}-wal`, { force: true })
		rmSync(`${dbPath}-shm`, { force: true })
	}
})

test("existing SQLite integrations gain a durable full-reconciliation timestamp", () => {
	const dbPath = resolve(tmpdir(), `corridor-integration-reconcile-migration-${process.pid}-${Date.now()}.db`)
	const legacySchema = CORRIDOR_SCHEMA_SQL
		.replace("\tlast_full_synced_at TEXT,\n", "")
		.replace("\tlast_full_sync_attempt_at TEXT,\n", "")
	assert.notEqual(legacySchema, CORRIDOR_SCHEMA_SQL, "the fixture must represent the previous integrations schema")
	const legacyDb = new DatabaseSync(dbPath)
	legacyDb.exec(legacySchema)
	legacyDb.close()
	const upgradedDb = new CorridorDatabase(dbPath)
	try {
		const columns = (upgradedDb as unknown as { db: DatabaseSync }).db.prepare("PRAGMA table_info(integrations)").all() as Array<{ name: string }>
		assert.ok(columns.some((column) => column.name === "last_full_synced_at"))
		assert.ok(columns.some((column) => column.name === "last_full_sync_attempt_at"))
	} finally {
		upgradedDb.close()
		rmSync(dbPath, { force: true })
		rmSync(`${dbPath}-wal`, { force: true })
		rmSync(`${dbPath}-shm`, { force: true })
	}
})

test("existing SQLite approvals gain evidence binding and expiry fields", () => {
	const dbPath = resolve(tmpdir(), `corridor-review-evidence-migration-${process.pid}-${Date.now()}.db`)
	const legacySchema = CORRIDOR_SCHEMA_SQL
		.replace("\tcase_evidence_sha256 TEXT NOT NULL DEFAULT '',\n", "")
		.replace("\treview_policy_id TEXT NOT NULL DEFAULT '',\n", "")
		.replace("\texpires_at TEXT,\n", "")
	assert.notEqual(legacySchema, CORRIDOR_SCHEMA_SQL, "the fixture must represent the earlier review approval schema")
	const legacyDb = new DatabaseSync(dbPath)
	legacyDb.exec(legacySchema)
	legacyDb.close()
	const upgradedDb = new CorridorDatabase(dbPath)
	try {
		const columns = (upgradedDb as unknown as { db: DatabaseSync }).db.prepare("PRAGMA table_info(review_approvals)").all() as Array<{ name: string }>
		assert.ok(columns.some((column) => column.name === "case_evidence_sha256"))
		assert.ok(columns.some((column) => column.name === "review_policy_id"))
		assert.ok(columns.some((column) => column.name === "expires_at"))
	} finally {
		upgradedDb.close()
		rmSync(dbPath, { force: true })
	}
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
	assert.equal(db.claimWebhookReceipt({ provider: "corridor", eventId: "evt-idempotency-01", ownerId: "webhook-worker-a" }), true)
	assert.equal(db.renewWebhookReceiptLease({ provider: "corridor", eventId: "evt-idempotency-01", ownerId: "webhook-worker-a" }), true)
	assert.equal(db.claimWebhookReceipt({ provider: "corridor", eventId: "evt-idempotency-01", ownerId: "webhook-worker-b" }), false)
	assert.equal(db.markWebhookReceiptStatus({ provider: "corridor", eventId: "evt-idempotency-01", ownerId: "webhook-worker-a", status: "failed" }), true)
	assert.equal(db.claimWebhookReceipt({ provider: "corridor", eventId: "evt-idempotency-01", ownerId: "webhook-worker-b" }), true, "failed deliveries can be retried with a new processing claim")
	const dbInternal = db as unknown as { db: DatabaseSync }
	dbInternal.db.prepare("UPDATE webhook_receipts SET processing_lease_expires_at = ? WHERE provider = ? AND event_id = ?")
		.run(new Date(0).toISOString(), "corridor", "evt-idempotency-01")
	assert.equal(db.claimWebhookReceipt({ provider: "corridor", eventId: "evt-idempotency-01", ownerId: "webhook-worker-c" }), true, "an expired claim can be recovered")
	assert.equal(db.renewWebhookReceiptLease({ provider: "corridor", eventId: "evt-idempotency-01", ownerId: "webhook-worker-b" }), false, "a stale owner cannot renew after takeover")
	assert.equal(db.failWebhookReceipt({ provider: "corridor", eventId: "evt-idempotency-01", ownerId: "webhook-worker-b", ingestionId: original.ingestion.id, parseError: "stale owner" }), false, "a stale owner cannot overwrite parse state")
	assert.equal(db.getRawIngestion(original.ingestion.id)?.parseStatus, "received")
	assert.equal(db.markWebhookReceiptStatus({ provider: "corridor", eventId: "evt-idempotency-01", ownerId: "webhook-worker-b", status: "queued" }), false, "a stale owner cannot finalize a reclaimed event")
	assert.equal(db.markWebhookReceiptStatus({ provider: "corridor", eventId: "evt-idempotency-01", ownerId: "webhook-worker-c", status: "queued" }), true)
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

test("existing webhook receipt tables gain processing lease columns", () => {
	const dbPath = resolve(tmpdir(), `corridor-webhook-lease-migration-${process.pid}-${Date.now()}.db`)
	const legacySchema = CORRIDOR_SCHEMA_SQL
		.replace("\tprocessing_owner TEXT,\n", "")
		.replace("\tprocessing_lease_expires_at TEXT,\n", "")
	assert.notEqual(legacySchema, CORRIDOR_SCHEMA_SQL, "the fixture must represent the earlier webhook receipt schema")
	const legacyDb = new DatabaseSync(dbPath)
	legacyDb.exec(legacySchema)
	legacyDb.close()
	const upgradedDb = new CorridorDatabase(dbPath)
	try {
		const columns = (upgradedDb as unknown as { db: DatabaseSync }).db.prepare("PRAGMA table_info(webhook_receipts)").all() as Array<{ name: string }>
		assert.ok(columns.some((column) => column.name === "processing_owner"))
		assert.ok(columns.some((column) => column.name === "processing_lease_expires_at"))
	} finally {
		upgradedDb.close()
		rmSync(dbPath, { force: true })
	}
})

test("webhook receipt, normalized cases, parse result, and queued state commit atomically", () => {
	const db = new CorridorDatabase(":memory:")
	const event = {
		workspaceId: DEFAULT_WORKSPACE_ID,
		provider: "corridor",
		eventId: "evt-atomic-acceptance-01",
		sourceChannel: "webhook" as const,
		filename: "atomic.json",
		format: "json",
		rawContent: '{"caseId":"CASE-ATOMIC-01"}',
	}
	const receipt = db.recordWebhookReceipt(event)
	const receiptOwnerId = "atomic-webhook-worker"
	assert.equal(db.claimWebhookReceipt({ provider: event.provider, eventId: event.eventId, ownerId: receiptOwnerId }), true)
	const settlementCase = {
		caseId: "CASE-ATOMIC-01",
		title: "Atomic webhook case",
		channelLabel: "webhook",
		settlementEvidence: "incomplete" as const,
		wire: {
			wireId: "WIRE-ATOMIC-01",
			format: "bank_csv" as const,
			valueDate: "2026-11-27",
			settledAmount: { amountMinor: 500, currency: "USD" },
			senderCharges: [],
			receiverCharges: [],
		},
		createdAt: new Date().toISOString(),
	}
	assert.throws(() => db.transaction(() => {
		db.saveCase(settlementCase)
		db.updateRawIngestionOutcome({ id: receipt.ingestion.id, parseStatus: "parsed", caseIds: [settlementCase.caseId] })
		db.markWebhookReceiptStatus({ provider: event.provider, eventId: event.eventId, ownerId: receiptOwnerId, status: "queued" })
		throw new Error("simulated crash before webhook acceptance commit")
	}), /simulated crash/)
	const retry = db.recordWebhookReceipt(event)
	assert.equal(retry.duplicate, true)
	assert.equal(retry.status, "processing")
	assert.equal(retry.ingestion.parseStatus, "received")
	assert.equal(db.getCaseQueueState(settlementCase.caseId), null)
	const retryOwnerId = "atomic-webhook-retry"
	;(db as unknown as { db: DatabaseSync }).db.prepare("UPDATE webhook_receipts SET processing_lease_expires_at = ? WHERE provider = ? AND event_id = ?")
		.run(new Date(0).toISOString(), event.provider, event.eventId)
	assert.equal(db.claimWebhookReceipt({ provider: event.provider, eventId: event.eventId, ownerId: retryOwnerId }), true)
	db.transaction(() => {
		db.saveCase(settlementCase)
		db.updateRawIngestionOutcome({ id: receipt.ingestion.id, parseStatus: "parsed", caseIds: [settlementCase.caseId] })
		db.markWebhookReceiptStatus({ provider: event.provider, eventId: event.eventId, ownerId: retryOwnerId, status: "queued" })
	})
	assert.equal(db.recordWebhookReceipt(event).status, "queued")
	assert.equal(db.getCaseQueueState(settlementCase.caseId)?.status, "queued")
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
	const replayEvent = db.listWorkspaceAuditEvents(DEFAULT_WORKSPACE_ID, 50).find((event) => event.action === "case.queue.replay" && event.targetId === deadLetterCase.caseId)
	assert.equal(replayEvent?.metadata.previousAttempts, 3, "replay audit records the attempt count before it resets")
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

test("provider HTTP helper keeps its timeout when a caller supplies a longer-lived signal", async () => {
	const previousFetch = global.fetch
	let receivedSignal: AbortSignal | undefined
	global.fetch = ((_input, init) => new Promise((_resolve, reject) => {
		receivedSignal = init?.signal as AbortSignal
		receivedSignal.addEventListener("abort", () => reject(receivedSignal?.reason), { once: true })
	})) as typeof fetch
	try {
		await assert.rejects(fetchProvider("https://provider.test/resource", { signal: AbortSignal.timeout(60_000) }, 5), (error: unknown) => {
			return error instanceof DOMException && error.name === "TimeoutError"
		})
		assert.ok(receivedSignal?.aborted)
	} finally {
		global.fetch = previousFetch
	}
})

test("generic provider endpoints reject insecure schemes and private DNS targets", async () => {
	assert.throws(() => validateProviderEndpointUrl("http://api.example.test/records"), /HTTPS/)
	assert.throws(() => validateProviderEndpointUrl("https://127.0.0.1/records", true), /private or reserved/)
	assert.throws(() => validateProviderEndpointUrl("https://api.example.test:8443/records", true), /standard HTTPS port/)
	const publicEndpoint = validateProviderEndpointUrl("https://api.example.test/v1/records", true)
	assert.throws(() => assertProviderEndpointHostAllowed(publicEndpoint, "", true), /disabled in production/)
	assert.throws(() => assertProviderEndpointHostAllowed(publicEndpoint, "other.example.test", true), /not in CORRIDOR_PROVIDER_ENDPOINT_HOSTS/)
	assert.doesNotThrow(() => assertProviderEndpointHostAllowed(publicEndpoint, "api.example.test", true))
	await assert.doesNotReject(assertProviderEndpointResolvesPublicly(publicEndpoint, async () => [{ address: "8.8.8.8", family: 4 }]))
	await assert.rejects(
		assertProviderEndpointResolvesPublicly(publicEndpoint, async () => [{ address: "169.254.169.254", family: 4 }]),
		/private IP addresses|public IP addresses/,
	)
})

test("generic provider requests connect to the public address that passed validation", async () => {
	let port = 0
	let observedRemoteAddress = ""
	let observedHost = ""
	const server = createServer((request, response) => {
		observedRemoteAddress = request.socket.remoteAddress || ""
		observedHost = request.headers.host || ""
		if (request.url === "/slow") {
			const interval = setInterval(() => response.write("x"), 5)
			response.on("close", () => clearInterval(interval))
			return
		}
		response.setHeader("content-type", "application/json")
		response.end(request.url === "/large" ? Buffer.concat([Buffer.from("prefix"), Buffer.alloc(MAX_GENERIC_PROVIDER_RESPONSE_BYTES + 1)]) : JSON.stringify([{ id: "provider-record" }]))
	})
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject)
		server.listen(0, "127.0.0.1", () => {
			const address = server.address()
			if (!address || typeof address === "string") return reject(new Error("Test server did not bind to a TCP port."))
			port = address.port
			resolve()
		})
	})
	try {
		let resolutions = 0
		const response = await fetchValidatedProviderEndpoint(new URL(`http://provider.localhost:${port}/records?since=1`), {
			resolver: async (hostname) => {
				resolutions += 1
				assert.equal(hostname, "provider.localhost")
				return [{ address: "127.0.0.1", family: 4 }]
			},
		})
		assert.equal(response.status, 200)
		assert.deepEqual(await response.json(), [{ id: "provider-record" }])
		assert.equal(resolutions, 1, "the connection reuses the exact resolution that was validated")
		assert.match(observedRemoteAddress, /127\.0\.0\.1|::ffff:127\.0\.0\.1/)
		assert.equal(observedHost, `provider.localhost:${port}`)
		await assert.rejects(fetchCasesFromIntegration({
			integration: {
				id: "int_generic_oversized",
				workspaceId: DEFAULT_WORKSPACE_ID,
				provider: "generic_test",
				category: "accounting",
				authMode: "api_token",
				status: "connected",
				config: { apiBaseUrl: `http://127.0.0.1:${port}/large` },
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			},
			credentials: { apiKey: "generic-provider-token" },
		}), (error: unknown) => error instanceof ProviderSyncLimitError && error.evidenceTruncated && JSON.parse(error.rawPayload).truncatedResponsePrefix.startsWith("prefix"))
		await assert.rejects(fetchValidatedProviderEndpoint(new URL(`http://provider.localhost:${port}/large`), {
			resolver: async () => [{ address: "127.0.0.1", family: 4 }],
		}), (error: unknown) => error instanceof ProviderEndpointResponseLimitError && error.rawPrefix.startsWith("prefix") && Buffer.byteLength(error.rawPrefix) <= MAX_GENERIC_PROVIDER_RESPONSE_BYTES)
		await assert.rejects(fetchValidatedProviderEndpoint(new URL(`http://provider.localhost:${port}/slow`), {
			timeoutMs: 40,
			resolver: async () => [{ address: "127.0.0.1", family: 4 }],
		}), /timed out after 40 ms/)

		await assert.rejects(fetchValidatedProviderEndpoint(new URL("https://api.example.test/records"), {
			resolver: async () => [{ address: "169.254.169.254", family: 4 }],
		}), /public IP addresses/)
	} finally {
		await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
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

test("QuickBooks and Wise authorization exchanges authenticate with HTTP Basic", async () => {
	const previousFetch = global.fetch
	const previousQuickBooksId = process.env.QUICKBOOKS_CLIENT_ID
	const previousQuickBooksSecret = process.env.QUICKBOOKS_CLIENT_SECRET
	const previousWiseId = process.env.WISE_SANDBOX_CLIENT_ID
	const previousWiseSecret = process.env.WISE_SANDBOX_CLIENT_SECRET
	const previousWiseEnvironment = process.env.WISE_API_ENVIRONMENT
	const previousWiseProductionId = process.env.WISE_PRODUCTION_CLIENT_ID
	const previousWiseProductionSecret = process.env.WISE_PRODUCTION_CLIENT_SECRET
	process.env.QUICKBOOKS_CLIENT_ID = "qbo-oauth-client"
	process.env.QUICKBOOKS_CLIENT_SECRET = "qbo-oauth-secret"
	process.env.WISE_API_ENVIRONMENT = "sandbox"
	process.env.WISE_SANDBOX_CLIENT_ID = "wise-oauth-client"
	process.env.WISE_SANDBOX_CLIENT_SECRET = "wise-oauth-secret"
	const requests: Array<{ url: string; body: string; authorization: string }> = []
	global.fetch = (async (input, init) => {
		requests.push({
			url: String(input),
			body: String(init?.body || ""),
			authorization: new Headers(init?.headers).get("authorization") || "",
		})
		return new Response(JSON.stringify({ access_token: "provider-access", refresh_token: "provider-refresh", expires_in: 3600 }), { status: 200 })
	}) as typeof fetch
	try {
		for (const [provider, clientId, clientSecret] of [
			["quickbooks", "qbo-oauth-client", "qbo-oauth-secret"],
			["wise", "wise-oauth-client", "wise-oauth-secret"],
		] as const) {
			const exchanged = await exchangeOAuthCode({ provider, code: "authorization-code", origin: "http://127.0.0.1:3000" })
			assert.equal(exchanged.credentials.accessToken, "provider-access")
			const request = requests.at(-1)!
			assert.equal(request.authorization, `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`)
			const body = new URLSearchParams(request.body)
			assert.equal(body.get("grant_type"), "authorization_code")
			assert.equal(body.get("code"), "authorization-code")
			assert.equal(body.has("client_id"), false)
			assert.equal(body.has("client_secret"), false)
			if (provider === "wise") {
				assert.equal(request.url, "https://api.wise-sandbox.com/2026Q4/oauth/token")
				assert.equal(getWiseEnvironmentConfig().authorizationUrl, "https://wise-sandbox.com/oauth/authorize/")
			}
		}
		process.env.WISE_API_ENVIRONMENT = "production"
		process.env.WISE_PRODUCTION_CLIENT_ID = "wise-live-client"
		process.env.WISE_PRODUCTION_CLIENT_SECRET = "wise-live-secret"
		assert.equal(getWiseEnvironmentConfig().apiBaseUrl, "https://api.wise.com/2026Q4")
		assert.equal(getWiseEnvironmentConfig().authorizationUrl, "https://wise.com/oauth/authorize/")
	} finally {
		global.fetch = previousFetch
		if (previousQuickBooksId === undefined) delete process.env.QUICKBOOKS_CLIENT_ID
		else process.env.QUICKBOOKS_CLIENT_ID = previousQuickBooksId
		if (previousQuickBooksSecret === undefined) delete process.env.QUICKBOOKS_CLIENT_SECRET
		else process.env.QUICKBOOKS_CLIENT_SECRET = previousQuickBooksSecret
		if (previousWiseId === undefined) delete process.env.WISE_SANDBOX_CLIENT_ID
		else process.env.WISE_SANDBOX_CLIENT_ID = previousWiseId
		if (previousWiseSecret === undefined) delete process.env.WISE_SANDBOX_CLIENT_SECRET
		else process.env.WISE_SANDBOX_CLIENT_SECRET = previousWiseSecret
		if (previousWiseEnvironment === undefined) delete process.env.WISE_API_ENVIRONMENT
		else process.env.WISE_API_ENVIRONMENT = previousWiseEnvironment
		if (previousWiseProductionId === undefined) delete process.env.WISE_PRODUCTION_CLIENT_ID
		else process.env.WISE_PRODUCTION_CLIENT_ID = previousWiseProductionId
		if (previousWiseProductionSecret === undefined) delete process.env.WISE_PRODUCTION_CLIENT_SECRET
		else process.env.WISE_PRODUCTION_CLIENT_SECRET = previousWiseProductionSecret
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
		assert.equal(apiRequests, 4)
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
	const approvalId = db.createPendingApproval(approval)
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
	assert.deepEqual(reopened.listPendingApprovals(), [{ ...approval, approvalId }])
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
	const settlementCase = {
		caseId: "CASE-APPROVAL-01",
		title: "Review maker checker case",
		channelLabel: "manual_upload",
		settlementEvidence: "incomplete" as const,
		wire: {
			wireId: "WIRE-APPROVAL-01",
			format: "bank_csv" as const,
			valueDate: "2026-11-27",
			settledAmount: { amountMinor: 125, currency: "USD" },
			senderCharges: [],
			receiverCharges: [],
		},
		createdAt: new Date().toISOString(),
	}
	db.saveCase(settlementCase, DEFAULT_WORKSPACE_ID, "submitter-123")
	db.saveCase(settlementCase)
	assert.equal((db as unknown as { db: DatabaseSync }).db.prepare("SELECT submitted_by_sub FROM cases WHERE case_id = ?")
		.get(settlementCase.caseId)?.submitted_by_sub, "submitter-123", "case updates preserve the original authenticated submitter")
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
	const approvalId = db.createPendingApproval(pending)
	assert.equal(db.createPendingApproval(pending), approvalId, "replaying the same paused call reuses its pending approval")
	assert.deepEqual(db.listPendingApprovals(DEFAULT_WORKSPACE_ID), [{ ...pending, approvalId }])
	assert.deepEqual(db.resolvePendingApproval({
		caseId: pending.caseId,
		approvalId: "approval-for-another-request",
		decision: "approve",
		reviewerSub: "wrong-reviewer",
		reviewerEmail: "wrong@example.test",
		reviewerRole: "controller",
	}), { status: "not_found" }, "a decision cannot resolve a different approval for the same case")
	assert.equal(db.listPendingApprovals(DEFAULT_WORKSPACE_ID).length, 1)
	assert.deepEqual(db.resolvePendingApproval({
		caseId: pending.caseId,
		approvalId,
		decision: "approve",
		reviewerSub: "submitter-123",
		reviewerEmail: "maker@acme.test",
		reviewerRole: "controller",
		requireIndependentReviewer: true,
	}), { status: "same_reviewer" }, "an authenticated submitter cannot approve their own case")
	assert.equal(db.listPendingApprovals(DEFAULT_WORKSPACE_ID).length, 1, "rejected self-approval leaves the request pending")
	const rejected = db.resolvePendingApproval({
		caseId: pending.caseId,
		approvalId,
		decision: "reject",
		reason: "Keep the relationship, treat this as SHA.",
		reviewerSub: "user-123",
		reviewerEmail: "controller@acme.test",
		reviewerRole: "controller",
	})
	assert.deepEqual(rejected, { status: "resolved", approvalId })
	assert.deepEqual(db.listPendingApprovals(DEFAULT_WORKSPACE_ID), [])
	const reviewEvent = db.listWorkspaceAuditEvents(DEFAULT_WORKSPACE_ID).find((event) => event.action === "review.decision")
	assert.equal(reviewEvent?.actorEmail, "controller@acme.test")
	assert.equal(reviewEvent?.metadata.decision, "reject")
	assert.equal(JSON.stringify(reviewEvent).includes("Keep the relationship"), false)
	assert.deepEqual(db.findStoredReviewDecision(pending.caseId, pending.argsJson), {
		approvalId: rejected.approvalId,
		decision: "reject",
		reason: "Keep the relationship, treat this as SHA.",
	})
	assert.equal(db.findStoredReviewDecision(pending.caseId, `${pending.argsJson} `), null)
	assert.equal(db.findStoredHumanOverride(pending.caseId, "Keep the relationship, treat this as SHA."), true)
	assert.equal(db.findStoredHumanOverride(pending.caseId, "model-invented note"), false)
	const secondApproval = db.createPendingApproval({ ...pending, createdAt: new Date().toISOString() })
	assert.deepEqual(db.resolvePendingApproval({
		caseId: pending.caseId,
		approvalId: secondApproval,
		decision: "approve",
		reviewerSub: "independent-controller",
		reviewerEmail: "checker@acme.test",
		reviewerRole: "controller",
		requireIndependentReviewer: true,
	}), { status: "resolved", approvalId: secondApproval }, "an independent authenticated reviewer can approve")
	db.saveCase({ ...settlementCase, title: "Revised evidence" })
	assert.equal(db.findStoredReviewDecision(pending.caseId, pending.argsJson), null, "a prior decision cannot be reused after case evidence changes")
	assert.equal(db.findStoredHumanOverride(pending.caseId, "Keep the relationship, treat this as SHA."), false, "an old override does not carry to revised evidence")
	const staleApproval = db.createPendingApproval({ ...pending, argsJson: JSON.stringify({ caseId: pending.caseId, revision: 1 }), createdAt: new Date().toISOString() })
	db.saveCase({ ...settlementCase, title: "Further revised evidence" })
	assert.deepEqual(db.resolvePendingApproval({
		caseId: pending.caseId, approvalId: staleApproval, decision: "approve", reviewerSub: "independent-controller",
		reviewerEmail: "checker@acme.test", reviewerRole: "controller",
	}), { status: "stale" }, "changed evidence invalidates a still-pending decision")
	const expiringApproval = db.createPendingApproval({ ...pending, argsJson: JSON.stringify({ caseId: pending.caseId, revision: 2 }), createdAt: new Date().toISOString() })
	;(db as unknown as { db: DatabaseSync }).db.prepare("UPDATE review_approvals SET expires_at = ? WHERE id = ?")
		.run(new Date(0).toISOString(), expiringApproval)
	assert.deepEqual(db.resolvePendingApproval({
		caseId: pending.caseId, approvalId: expiringApproval, decision: "approve", reviewerSub: "independent-controller",
		reviewerEmail: "checker@acme.test", reviewerRole: "controller",
	}), { status: "expired" }, "expired review requests cannot be approved")
	const policyApproval = db.createPendingApproval({ ...pending, argsJson: JSON.stringify({ caseId: pending.caseId, revision: 3 }), createdAt: new Date().toISOString() })
	db.updateWorkspace(DEFAULT_WORKSPACE_ID, { varianceThresholdMinor: 501 })
	assert.deepEqual(db.resolvePendingApproval({
		caseId: pending.caseId, approvalId: policyApproval, decision: "approve", reviewerSub: "independent-controller",
		reviewerEmail: "checker@acme.test", reviewerRole: "controller",
	}), { status: "stale" }, "a changed review policy invalidates the pending decision")
	const runtimeApprovalId = db.createPendingApproval({ ...pending, argsJson: JSON.stringify({ caseId: pending.caseId, revision: 4 }), createdAt: new Date().toISOString() })
	let invalidatedDecision: { decision: string; reason?: string } | undefined
	const pendingApprovals = new Map([[pending.caseId, {
		approvalId: runtimeApprovalId,
		resolve: (decision: { decision: "approve" | "reject" | "stop"; reason?: string }) => { invalidatedDecision = decision },
	}]])
	db.updateWorkspace(DEFAULT_WORKSPACE_ID, { varianceThresholdMinor: 502 })
	assert.equal(resolveInvalidatedPendingApprovals({ db, pendingApprovals }), 1)
	assert.equal(invalidatedDecision?.decision, "stop", "the active local gate is released after its policy changes")
	assert.match(invalidatedDecision?.reason || "", /Re-run the audit/)
	assert.equal(db.listPendingApprovals(DEFAULT_WORKSPACE_ID).length, 0)
	db.close()
})

test("pending human review pauses the case verdict timeout until a decision arrives", async () => {
	const state = new CorridorState()
	const caseId = "CASE-REVIEW-WAIT-01"
	const wait = state.waitForCaseVerdict(caseId, 5, () => state.pendingApprovals.has(caseId))
	state.pendingApprovals.set(caseId, {
		caseId,
		agentName: "AuditorAgent",
		toolName: "finalize_settlement_action",
		actionType: "FILE_OUR_FEE_DISPUTE",
		question: "Review this action?",
		proofLine: "Test evidence",
		recoverableMinor: 100,
		currency: "USD",
		argsJson: "{}",
		riskLabel: "Review",
		createdAt: new Date().toISOString(),
		resolve: () => undefined,
	})
	await new Promise((resolve) => setTimeout(resolve, 30))
	const verdict = { caseId } as import("../src/core/types").AuditVerdict
	state.resolveCaseWaiters(caseId, verdict)
	assert.equal(await wait, verdict)
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
			const invoiceRaw = JSON.stringify(item.payload)
			const paymentRaw = item.provider === "quickbooks"
				? JSON.stringify({ QueryResponse: { Payment: [] } })
				: JSON.stringify({ Payments: [] })
			global.fetch = (async (input) => new Response(String(input).includes("Payment") ? paymentRaw : invoiceRaw, { status: 200 })) as typeof fetch
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
			assert.deepEqual(JSON.parse(result.rawPayload || "{}").pageResponses, [invoiceRaw, paymentRaw])
			assert.equal(result.cases[0]?.settlementEvidence, "estimated")
			assert.equal(result.cases[0]?.wire.settledAmount.amountMinor, 0)
			assert.match(result.cases[0]?.evidenceGap || "", /no linked accounting payment application/)
		}
	} finally {
		global.fetch = previousFetch
	}
})

test("oversized provider sync fails without queueing and retains bounded failed evidence", async () => {
	const db = getCorridorDb()
	const previousFetch = global.fetch
	const previousInterval = process.env.PROVIDER_FULL_RECONCILIATION_INTERVAL_HOURS
	process.env.PROVIDER_FULL_RECONCILIATION_INTERVAL_HOURS = "168"
	const integration = db.upsertIntegration({
		workspaceId: DEFAULT_WORKSPACE_ID,
		provider: "stripe",
		category: "payouts",
		authMode: "api_token",
		status: "connected",
		credentials: { apiKey: "stripe-oversized-sync-test" },
	})
	const priorSyncAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
	const priorFullSyncAt = new Date().toISOString()
	db.markIntegrationSyncState({
		integrationId: integration.id,
		status: "connected",
		lastSyncStatus: "success",
		lastSyncedAt: priorSyncAt,
		lastFullSyncedAt: priorFullSyncAt,
	})
	let queuedBatchCount = 0
	const orchestrator = {
		state: { casesById: new Map() },
		enqueueBatch: async () => { queuedBatchCount += 1 },
	} as unknown as Parameters<typeof runIntegrationSync>[0]["orchestrator"]
	global.fetch = (async () => new Response("x".repeat(10 * 1024 * 1024 + 1), { status: 200 })) as typeof fetch
	try {
		const result = await runIntegrationSync({ provider: "stripe", workspaceId: DEFAULT_WORKSPACE_ID, orchestrator })
		assert.equal(result.status, "failed")
		assert.equal(result.casesQueued, 0)
		assert.match(result.error || "", /local safety limit/)
		assert.equal(queuedBatchCount, 0)
		const updatedIntegration = db.getIntegration(DEFAULT_WORKSPACE_ID, "stripe")
		assert.equal(updatedIntegration?.lastSyncedAt, priorSyncAt)
		assert.equal(updatedIntegration?.lastFullSyncedAt, priorFullSyncAt)
		const rawMetadata = db.listRawIngestions({ workspaceId: DEFAULT_WORKSPACE_ID, channel: "platform_sync", limit: 5 })
		const limitEvidence = rawMetadata.find((item) => item.filename.includes("oversized-sync-test") || item.parseError?.includes("local safety limit"))
		assert.ok(limitEvidence)
		assert.equal(limitEvidence?.parseStatus, "failed")
		assert.equal(limitEvidence?.metadata.evidenceTruncated, "true")
		assert.equal(limitEvidence?.metadata.partialCasesQueued, "0")
		assert.ok((limitEvidence?.sizeBytes ?? Number.POSITIVE_INFINITY) <= 10 * 1024 * 1024 + 1024)
		const fullEvidence = db.getRawIngestion(limitEvidence!.id, true, DEFAULT_WORKSPACE_ID)
		assert.match(fullEvidence?.rawContent || "", /truncatedResponsePrefix/)
	} finally {
		global.fetch = previousFetch
		if (previousInterval === undefined) delete process.env.PROVIDER_FULL_RECONCILIATION_INTERVAL_HOURS
		else process.env.PROVIDER_FULL_RECONCILIATION_INTERVAL_HOURS = previousInterval
		db.disconnectIntegration(DEFAULT_WORKSPACE_ID, "stripe")
		db.markIntegrationSyncState({
			integrationId: integration.id,
			status: "disconnected",
			lastFullSyncAttemptAt: new Date(0).toISOString(),
		})
	}
})

test("provider sync follows Stripe, Wise, QuickBooks, and Xero page cursors", async () => {
	const previousFetch = global.fetch
	const previousWiseEnvironment = process.env.WISE_API_ENVIRONMENT
	process.env.WISE_API_ENVIRONMENT = "sandbox"
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
		if (url.includes("api.wise-sandbox.com")) return new Response(requests.filter((item) => item.includes("api.wise-sandbox.com")).length === 1 ? wiseFirst : wiseLast, { status: 200 })
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
		assert.ok(requests.some((url) => url.includes("https://api.wise-sandbox.com/2026Q4/transfers")))
		assert.ok(requests.some((url) => url.includes("offset=100")))

		const quickBooks = await fetchCasesFromIntegration({ integration: integration("quickbooks", { realmId: "realm-1" }), credentials: { accessToken: "qbo-test" } })
		assert.equal(quickBooks.recordsFetched, 1001)
		assert.equal(requests.filter((url) => url.includes("quickbooks.api.intuit.com")).length, 3)
		assert.ok(requests.some((url) => decodeURIComponent(url).includes("STARTPOSITION 1001")))

		const xero = await fetchCasesFromIntegration({ integration: integration("xero", { tenantId: "tenant-1" }), credentials: { accessToken: "xero-test" } })
		assert.equal(xero.recordsFetched, 1001)
		assert.equal(requests.filter((url) => url.includes("api.xero.com")).length, 3)
		assert.ok(requests.some((url) => url.includes("page=2&pageSize=1000")))
	} finally {
		global.fetch = previousFetch
		if (previousWiseEnvironment === undefined) delete process.env.WISE_API_ENVIRONMENT
		else process.env.WISE_API_ENVIRONMENT = previousWiseEnvironment
	}
})

test("QuickBooks and Xero payment applications stay separate from bank settlement evidence", async () => {
	const previousFetch = global.fetch
	let includeInvoicePages = true
	let resolveLinkedInvoiceLookups = false
	global.fetch = (async (input) => {
		const url = String(input)
		if (url.includes("quickbooks.api.intuit.com")) {
			const query = decodeURIComponent(new URL(url).searchParams.get("query") || "")
			if (resolveLinkedInvoiceLookups && query.includes("Id IN")) {
				return new Response(JSON.stringify({ QueryResponse: { Invoice: [{
					Id: "qbo-invoice-1", DocNumber: "QBO-INV-1", TotalAmt: 250, CurrencyRef: { value: "USD" }, TxnDate: "2026-11-20",
				}, {
					Id: "other-invoice", DocNumber: "QBO-INV-2", TotalAmt: 20, CurrencyRef: { value: "USD" }, TxnDate: "2026-11-21",
				}] } }), { status: 200 })
			}
			if (query.includes("Id IN")) return new Response(JSON.stringify({ QueryResponse: { Invoice: [] } }), { status: 200 })
			if (query.includes("FROM Invoice")) {
				return new Response(JSON.stringify({ QueryResponse: { Invoice: includeInvoicePages ? [{
					Id: "qbo-invoice-1",
					DocNumber: "QBO-INV-1",
					TotalAmt: 250,
					CurrencyRef: { value: "USD" },
					TxnDate: "2026-11-20",
			}] : [] } }), { status: 200 })
			}
			return new Response(JSON.stringify({ QueryResponse: { Payment: [{
				Id: "qbo-payment-1",
				TxnDate: "2026-11-26",
				CurrencyRef: { value: "USD" },
				Line: [{ Amount: 100.25, LinkedTxn: [{ TxnId: "qbo-invoice-1", TxnType: "Invoice" }] }],
			}, {
				Id: "qbo-payment-2",
				TxnDate: "2026-11-26",
				CurrencyRef: { value: "USD" },
				Line: [{ Amount: 20, LinkedTxn: [{ TxnId: "qbo-invoice-1", TxnType: "Invoice" }, { TxnId: "other-invoice", TxnType: "Invoice" }] }],
			}] } }), { status: 200 })
		}
		if (url.includes("api.xero.com")) {
			if (url.includes("/Invoices?")) {
				if (resolveLinkedInvoiceLookups && new URL(url).searchParams.has("IDs")) {
					return new Response(JSON.stringify({ Invoices: [{
						InvoiceID: "xero-invoice-1", InvoiceNumber: "XERO-INV-1", Total: 120, CurrencyCode: "EUR", DateString: "2026-11-20",
					}] }), { status: 200 })
				}
				return new Response(JSON.stringify({ Invoices: includeInvoicePages ? [{
					InvoiceID: "xero-invoice-1",
					InvoiceNumber: "XERO-INV-1",
					Total: 120,
					CurrencyCode: "EUR",
					DateString: "2026-11-20",
			}] : [] }), { status: 200 })
			}
			return new Response(JSON.stringify({ Payments: [{
				PaymentID: "xero-payment-1",
				DateString: "2026-11-26",
				Amount: 40.5,
				Status: "AUTHORISED",
				IsReconciled: false,
				Invoice: { InvoiceID: "xero-invoice-1" },
			}, {
				PaymentID: "xero-payment-voided",
				DateString: "2026-11-25",
				Amount: 12,
				Status: "DELETED",
				Invoice: { InvoiceID: "xero-invoice-1" },
			}] }), { status: 200 })
		}
		throw new Error(`Unexpected accounting provider request: ${url}`)
	}) as typeof fetch
	const integration = (provider: "quickbooks" | "xero", config: Record<string, string>) => ({
		id: `int_${provider}_payment_mapping`,
		workspaceId: DEFAULT_WORKSPACE_ID,
		provider,
		category: "accounting" as const,
		authMode: "oauth2" as const,
		status: "connected" as const,
		config,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	})
	try {
		const quickBooks = await fetchCasesFromIntegration({
			integration: integration("quickbooks", { realmId: "realm-payment-test" }),
			credentials: { accessToken: "qbo-test" },
		})
		assert.equal(quickBooks.recordsFetched, 3)
		assert.match(quickBooks.warnings?.[0] || "", /invoice records that were not retrieved/)
		assert.equal(quickBooks.cases[0]?.settlementEvidence, "incomplete")
		assert.equal(quickBooks.cases[0]?.wire.settledAmount.amountMinor, 0)
		assert.equal(quickBooks.cases[0]?.accountingPayments?.[0]?.amount?.amountMinor, 10025)
		assert.match(quickBooks.cases[0]?.accountingPayments?.[1]?.mappingIssue || "", /multiple invoice records/)
		assert.equal(quickBooks.cases[0]?.accountingPayments?.[1]?.amount, undefined)
		assert.match(quickBooks.cases[0]?.evidenceGap || "", /do not independently confirm bank settlement/)

		const xero = await fetchCasesFromIntegration({
			integration: integration("xero", { tenantId: "tenant-payment-test" }),
			credentials: { accessToken: "xero-test" },
		})
		assert.equal(xero.recordsFetched, 3)
		assert.equal(xero.cases[0]?.settlementEvidence, "incomplete")
		assert.equal(xero.cases[0]?.wire.settledAmount.amountMinor, 0)
		assert.equal(xero.cases[0]?.accountingPayments?.[0]?.amount?.amountMinor, 4050)
		assert.equal(xero.cases[0]?.accountingPayments?.[0]?.reconciled, false)
		assert.match(xero.cases[0]?.accountingPayments?.[1]?.mappingIssue || "", /DELETED/)
		assert.equal(xero.cases[0]?.accountingPayments?.[1]?.amount, undefined)
		assert.match(xero.cases[0]?.evidenceGap || "", /do not independently confirm bank settlement/)

		includeInvoicePages = false
		resolveLinkedInvoiceLookups = true
		const lookedUpQuickBooks = await fetchCasesFromIntegration({
			integration: integration("quickbooks", { realmId: "realm-payment-test" }),
			credentials: { accessToken: "qbo-test" },
			lastSuccessfulSyncAt: "2026-11-27T12:00:00.000Z",
		})
		assert.equal(lookedUpQuickBooks.cases.length, 2)
		assert.equal(lookedUpQuickBooks.warnings, undefined)
		assert.equal(lookedUpQuickBooks.cases.find((item) => item.caseId === "QBO-QBO-INV-2")?.accountingPayments?.length, 1)
		assert.match(lookedUpQuickBooks.rawPayload || "", /other-invoice/)

		const lookedUpXero = await fetchCasesFromIntegration({
			integration: integration("xero", { tenantId: "tenant-payment-test" }),
			credentials: { accessToken: "xero-test" },
			lastSuccessfulSyncAt: "2026-11-27T12:00:00.000Z",
		})
		assert.equal(lookedUpXero.cases.length, 1)
		assert.equal(lookedUpXero.warnings, undefined)
		assert.equal(lookedUpXero.cases[0]?.accountingPayments?.length, 2)
		assert.match(lookedUpXero.rawPayload || "", /xero-invoice-1/)
		includeInvoicePages = true
		resolveLinkedInvoiceLookups = false
		const db = getCorridorDb()
		db.saveCase(quickBooks.cases[0]!)
		assert.equal(db.getPersistedCase(quickBooks.cases[0]!.caseId)?.accountingPayments?.[1]?.mappingIssue, quickBooks.cases[0]?.accountingPayments?.[1]?.mappingIssue)

		includeInvoicePages = false
		const cursor = "2026-11-27T12:00:00.000Z"
		const quickBooksIncremental = await fetchCasesFromIntegration({
			integration: integration("quickbooks", { realmId: "realm-payment-test" }),
			credentials: { accessToken: "qbo-test" },
			lastSuccessfulSyncAt: cursor,
			existingCases: [quickBooks.cases[0]!],
		})
		assert.equal(quickBooksIncremental.cases.length, 1)
		assert.equal(quickBooksIncremental.cases[0]?.caseId, quickBooks.cases[0]?.caseId)
		assert.equal(quickBooksIncremental.cases[0]?.accountingPayments?.length, 2)
		assert.match(quickBooksIncremental.cases[0]?.evidenceGap || "", /earlier local sync/)

		const xeroIncremental = await fetchCasesFromIntegration({
			integration: integration("xero", { tenantId: "tenant-payment-test" }),
			credentials: { accessToken: "xero-test" },
			lastSuccessfulSyncAt: cursor,
			existingCases: [xero.cases[0]!],
		})
		assert.equal(xeroIncremental.cases.length, 1)
		assert.equal(xeroIncremental.cases[0]?.caseId, xero.cases[0]?.caseId)
		assert.equal(xeroIncremental.cases[0]?.accountingPayments?.length, 2)
		assert.match(xeroIncremental.cases[0]?.evidenceGap || "", /earlier local sync/)
	} finally {
		global.fetch = previousFetch
	}
})

test("Stripe, Wise, and Xero incremental sync cursors use a five-minute overlap", async () => {
	const previousFetch = global.fetch
	const previousWiseEnvironment = process.env.WISE_API_ENVIRONMENT
	process.env.WISE_API_ENVIRONMENT = "sandbox"
	const requests: Array<{ url: URL; headers: Headers }> = []
	global.fetch = (async (input, init) => {
		requests.push({ url: new URL(String(input)), headers: new Headers(init?.headers) })
		const url = String(input)
		return new Response(url.includes("stripe.com")
			? JSON.stringify({ data: [], has_more: false })
			: url.includes("api.wise-sandbox.com")
				? JSON.stringify([])
				: JSON.stringify({ Invoices: [] }), { status: 200 })
	}) as typeof fetch
	const lastSuccessfulSyncAt = "2026-11-27T12:00:00.000Z"
	const integration = (provider: "stripe" | "wise" | "xero", config: Record<string, string> = {}) => ({
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
			integration: integration("wise", { profileId: "profile-cursor" }), credentials: { apiKey: "wise-test" }, lastSuccessfulSyncAt,
		})
		await fetchCasesFromIntegration({
			integration: integration("xero", { tenantId: "tenant-cursor" }), credentials: { accessToken: "xero-test" }, lastSuccessfulSyncAt,
		})
		const stripeSince = new Date(Date.parse(lastSuccessfulSyncAt) - 5 * 60 * 1000)
		assert.equal(requests[0]?.url.searchParams.get("created[gte]"), String(Math.floor(stripeSince.getTime() / 1000)))
		assert.equal(requests[1]?.url.searchParams.get("createdDateStart"), stripeSince.toISOString())
		assert.equal(requests[1]?.url.origin, "https://api.wise-sandbox.com")
		assert.equal(requests[1]?.url.pathname, "/2026Q4/transfers")
		assert.equal(requests[2]?.headers.get("If-Modified-Since"), stripeSince.toISOString().slice(0, 19))
	} finally {
		global.fetch = previousFetch
		if (previousWiseEnvironment === undefined) delete process.env.WISE_API_ENVIRONMENT
		else process.env.WISE_API_ENVIRONMENT = previousWiseEnvironment
	}
})

test("cursor providers perform a durable full reconciliation before resuming incremental sync", async () => {
	const db = getCorridorDb()
	const previousFetch = global.fetch
	const previousInterval = process.env.PROVIDER_FULL_RECONCILIATION_INTERVAL_HOURS
	const requestedUrls: URL[] = []
	process.env.PROVIDER_FULL_RECONCILIATION_INTERVAL_HOURS = "168"
	global.fetch = (async (input) => {
		const url = new URL(String(input))
		requestedUrls.push(url)
		return new Response(JSON.stringify([]), { status: 200 })
	}) as typeof fetch
	const integration = db.upsertIntegration({
		workspaceId: DEFAULT_WORKSPACE_ID,
		provider: "wise",
		category: "payouts",
		authMode: "api_token",
		status: "connected",
		credentials: { apiKey: "wise-reconcile-test" },
		config: { profileId: "profile-reconcile-test" },
	})
	const quickBooksIntegration = db.upsertIntegration({
		workspaceId: DEFAULT_WORKSPACE_ID,
		provider: "quickbooks",
		category: "accounting",
		authMode: "api_token",
		status: "connected",
		credentials: { accessToken: "quickbooks-reconcile-test" },
		config: { realmId: "realm-reconcile-test" },
	})
	const oldSyncAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
	db.markIntegrationSyncState({
		integrationId: integration.id,
		status: "connected",
		lastSyncStatus: "success",
		lastSyncedAt: oldSyncAt,
		lastFullSyncedAt: oldSyncAt,
	})
	db.markIntegrationSyncState({
		integrationId: quickBooksIntegration.id,
		status: "connected",
		lastSyncStatus: "success",
		lastSyncedAt: oldSyncAt,
		lastFullSyncedAt: oldSyncAt,
	})
	const orchestrator = { state: { casesById: new Map() } } as unknown as Parameters<typeof runIntegrationSync>[0]["orchestrator"]
	try {
		const fullRun = await runIntegrationSync({ provider: "wise", workspaceId: DEFAULT_WORKSPACE_ID, orchestrator })
		assert.equal(fullRun.status, "success")
		assert.equal(requestedUrls[0]?.searchParams.has("createdDateStart"), false)
		const fullSyncAt = db.getIntegration(DEFAULT_WORKSPACE_ID, "wise")?.lastFullSyncedAt
		assert.ok(fullSyncAt && Date.parse(fullSyncAt) > Date.parse(oldSyncAt))

		const incrementalRun = await runIntegrationSync({ provider: "wise", workspaceId: DEFAULT_WORKSPACE_ID, orchestrator })
		assert.equal(incrementalRun.status, "success")
		assert.ok(requestedUrls[1]?.searchParams.has("createdDateStart"))
		assert.equal(db.getIntegration(DEFAULT_WORKSPACE_ID, "wise")?.lastFullSyncedAt, fullSyncAt)

		const quickBooksFull = await runIntegrationSync({ provider: "quickbooks", workspaceId: DEFAULT_WORKSPACE_ID, orchestrator })
		assert.equal(quickBooksFull.status, "success")
		assert.equal(requestedUrls.length, 4)
		assert.doesNotMatch(requestedUrls[2]?.searchParams.get("query") || "", /WHERE MetaData\.LastUpdatedTime/)
		assert.doesNotMatch(requestedUrls[3]?.searchParams.get("query") || "", /WHERE MetaData\.LastUpdatedTime/)
		const quickBooksFullSyncAt = db.getIntegration(DEFAULT_WORKSPACE_ID, "quickbooks")?.lastFullSyncedAt
		assert.ok(quickBooksFullSyncAt && Date.parse(quickBooksFullSyncAt) > Date.parse(oldSyncAt))

		const quickBooksIncremental = await runIntegrationSync({ provider: "quickbooks", workspaceId: DEFAULT_WORKSPACE_ID, orchestrator })
		assert.equal(quickBooksIncremental.status, "success")
		assert.equal(requestedUrls.length, 6)
		assert.match(requestedUrls[4]?.searchParams.get("query") || "", /WHERE MetaData\.LastUpdatedTime/)
		assert.match(requestedUrls[5]?.searchParams.get("query") || "", /WHERE MetaData\.LastUpdatedTime/)
		assert.equal(db.getIntegration(DEFAULT_WORKSPACE_ID, "quickbooks")?.lastFullSyncedAt, quickBooksFullSyncAt)
	} finally {
		global.fetch = previousFetch
		if (previousInterval === undefined) delete process.env.PROVIDER_FULL_RECONCILIATION_INTERVAL_HOURS
		else process.env.PROVIDER_FULL_RECONCILIATION_INTERVAL_HOURS = previousInterval
		db.disconnectIntegration(DEFAULT_WORKSPACE_ID, "wise")
		db.disconnectIntegration(DEFAULT_WORKSPACE_ID, "quickbooks")
	}
})

test("a page-limited full sync warns, resumes from the cursor, and backs off the next full attempt", async () => {
	const db = getCorridorDb()
	const previousFetch = global.fetch
	const previousInterval = process.env.PROVIDER_FULL_RECONCILIATION_INTERVAL_HOURS
	const requests: URL[] = []
	process.env.PROVIDER_FULL_RECONCILIATION_INTERVAL_HOURS = "168"
	global.fetch = (async (input) => {
		const url = new URL(String(input))
		requests.push(url)
		if (url.searchParams.has("created[gte]")) {
			return new Response(JSON.stringify({ data: [], has_more: false }), { status: 200 })
		}
		return new Response(JSON.stringify({ data: [{ id: `po-page-${requests.length}`, created: 1790000000, amount: 1000, currency: "usd", description: "Test payout" }], has_more: true }), { status: 200 })
	}) as typeof fetch
	const integration = db.upsertIntegration({
		workspaceId: DEFAULT_WORKSPACE_ID,
		provider: "stripe",
		category: "payouts",
		authMode: "api_token",
		status: "connected",
		credentials: { apiKey: "stripe-full-limit-test" },
	})
	const oldSyncAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
	db.markIntegrationSyncState({
		integrationId: integration.id,
		status: "connected",
		lastSyncStatus: "success",
		lastSyncedAt: oldSyncAt,
		lastFullSyncedAt: oldSyncAt,
	})
	const orchestrator = { state: { casesById: new Map() } } as unknown as Parameters<typeof runIntegrationSync>[0]["orchestrator"]
	try {
		const deferred = await runIntegrationSync({ provider: "stripe", workspaceId: DEFAULT_WORKSPACE_ID, orchestrator })
		assert.equal(deferred.status, "success")
		assert.match(deferred.error || "", /full reconciliation remains incomplete/)
		assert.equal(requests.length, 101)
		assert.equal(requests[100]?.searchParams.has("created[gte]"), true)
		const afterFallback = db.getIntegration(DEFAULT_WORKSPACE_ID, "stripe")
		assert.equal(afterFallback?.lastFullSyncedAt, oldSyncAt)
		assert.ok(afterFallback?.lastFullSyncAttemptAt)

		const incremental = await runIntegrationSync({ provider: "stripe", workspaceId: DEFAULT_WORKSPACE_ID, orchestrator })
		assert.equal(incremental.status, "success")
		assert.equal(requests.length, 102, "the next scheduled run resumes incrementally instead of repeating the oversized full scan")
		assert.equal(requests[101]?.searchParams.has("created[gte]"), true)
	} finally {
		global.fetch = previousFetch
		if (previousInterval === undefined) delete process.env.PROVIDER_FULL_RECONCILIATION_INTERVAL_HOURS
		else process.env.PROVIDER_FULL_RECONCILIATION_INTERVAL_HOURS = previousInterval
		db.disconnectIntegration(DEFAULT_WORKSPACE_ID, "stripe")
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
		assert.equal(requests.length, 2)
		assert.ok(decodeURIComponent(requests[0]!.searchParams.get("query")!).includes("WHERE MetaData.LastUpdatedTime > '2026-11-27T11:55:00.000Z'"))
		assert.ok(decodeURIComponent(requests[0]!.searchParams.get("query")!).includes("ORDERBY MetaData.LastUpdatedTime DESC"))
		assert.ok(decodeURIComponent(requests[1]!.searchParams.get("query")!).includes("SELECT * FROM Payment"))
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
		if (fetchCount <= 2) assert.equal(new Headers(init?.headers).has("If-Modified-Since"), false)
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

test("Xero incremental payment updates attach to an invoice persisted by an earlier sync", async () => {
	const db = getCorridorDb()
	const previousFetch = global.fetch
	db.upsertIntegration({
		workspaceId: DEFAULT_WORKSPACE_ID,
		provider: "xero",
		category: "accounting",
		authMode: "oauth2",
		status: "connected",
		credentials: { accessToken: "xero-historical-payment-test" },
		config: { tenantId: "tenant-historical-payment-test" },
	})
	let invoiceSyncCount = 0
	let paymentSyncCount = 0
	global.fetch = (async (input) => {
		const url = String(input)
		if (url.includes("/Invoices?")) {
			invoiceSyncCount += 1
			return new Response(JSON.stringify({ Invoices: invoiceSyncCount === 1 ? [{
				InvoiceID: "xero-historical-invoice-01",
				InvoiceNumber: "INV-HIST-01",
				Total: 75,
				CurrencyCode: "EUR",
				DateString: "2026-11-20",
			}] : [] }), { status: 200 })
		}
		if (url.includes("/Payments?")) {
			paymentSyncCount += 1
			return new Response(JSON.stringify({ Payments: paymentSyncCount === 1 ? [] : [{
				PaymentID: "xero-historical-payment-01",
				DateString: "2026-11-26",
				Amount: 75,
				Status: "AUTHORISED",
				IsReconciled: true,
				Invoice: { InvoiceID: "xero-historical-invoice-01" },
			}] }), { status: 200 })
		}
		throw new Error(`Unexpected Xero request: ${url}`)
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
		const incremental = await runIntegrationSync({ provider: "xero", workspaceId: DEFAULT_WORKSPACE_ID, orchestrator })
		assert.equal(incremental.status, "success")
		assert.equal(incremental.casesQueued, 1)
		const linkedRevision = db.listPersistedCases().find((settlementCase) =>
			settlementCase.sourceRevisionOf === "XERO-INV-HIST-01" &&
			settlementCase.accountingPayments?.some((application) => application.paymentId === "xero-historical-payment-01"),
		)
		assert.equal(linkedRevision?.settlementEvidence, "incomplete")
		assert.equal(linkedRevision?.accountingPayments?.[0]?.amount?.amountMinor, 7500)
		assert.equal(linkedRevision?.wire.settledAmount.amountMinor, 0)
		assert.match(linkedRevision?.evidenceGap || "", /earlier local sync/)
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
		integrations: Array<{ provider: string; dataReceived: string; adapter: { mode: string; scope: string }; connection: { status: string } }>
	}
	assert.equal(listJson.ok, true)
	assert.equal(listJson.integrations.find((i) => i.provider === "stripe")?.connection.status, "connected")
	assert.equal(listJson.integrations.find((i) => i.provider === "stripe")?.adapter.mode, "native_provider_api")
	assert.match(listJson.integrations.find((i) => i.provider === "payoneer")?.adapter.scope || "", /Vendor specific pagination.*not implemented/)
	assert.match(listJson.integrations.find((i) => i.provider === "quickbooks")?.dataReceived || "", /Invoice number.*total/)
	assert.match(listJson.integrations.find((i) => i.provider === "email_inbound")?.adapter.scope || "", /mailbox.*configured separately/)

	const missingEndpoint = await connectIntegrationRoute(
		new Request("http://127.0.0.1/api/integrations/payoneer/connect", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ authMode: "api_token", apiKey: "test-token", config: { accountId: "account-01" } }),
		}),
		{ params: Promise.resolve({ provider: "payoneer" }) },
	)
	assert.equal(missingEndpoint.status, 400, "generic connector cannot be saved without its required endpoint")
	const insecureEndpoint = await connectIntegrationRoute(
		new Request("http://127.0.0.1/api/integrations/payoneer/connect", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ authMode: "api_token", apiKey: "test-token", config: { accountId: "account-01", apiBaseUrl: "http://api.example.test/records" } }),
		}),
		{ params: Promise.resolve({ provider: "payoneer" }) },
	)
	assert.equal(insecureEndpoint.status, 400, "generic connector refuses an insecure remote endpoint")

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
	const addedMember = await postWorkspaceRoute(
		new Request("http://127.0.0.1/api/settings/workspace", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "add_member", memberEmail: "pilot.analyst@acme.test", memberName: "Pilot Analyst", memberRole: "analyst" }),
		}),
	)
	assert.equal(addedMember.status, 200)
	const duplicateMember = await postWorkspaceRoute(
		new Request("http://127.0.0.1/api/settings/workspace", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "add_member", memberEmail: "PILOT.ANALYST@acme.test", memberName: "Pilot Analyst", memberRole: "viewer" }),
		}),
	)
	assert.equal(duplicateMember.status, 409, "duplicate email is rejected without creating another membership")
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
	const busyWebhookPayload = JSON.stringify({ id: "evt-WH-BUSY-01", caseId: "WH-BUSY-01", title: "Busy webhook" })
	const busyWebhookIdentity = deriveWebhookEventId(busyWebhookPayload, "corridor")
	const db = getCorridorDb()
	db.recordWebhookReceipt({
		workspaceId: DEFAULT_WORKSPACE_ID,
		provider: "corridor",
		eventId: busyWebhookIdentity.eventId,
		sourceChannel: "webhook",
		filename: "busy-webhook.json",
		format: "auto",
		rawContent: busyWebhookPayload,
	})
	assert.equal(db.claimWebhookReceipt({ provider: "corridor", eventId: busyWebhookIdentity.eventId, ownerId: "active-webhook-worker" }), true)
	const busyWebhookSignature = createHmac("sha256", secret).update(busyWebhookPayload, "utf8").digest("hex")
	const busyWebhookRes = await inboundWebhookRoute(new Request("http://127.0.0.1/api/webhooks/inbound", {
		method: "POST",
		headers: { "Content-Type": "application/json", "x-corridor-signature": `sha256=${busyWebhookSignature}` },
		body: busyWebhookPayload,
	}))
	assert.equal(busyWebhookRes.status, 503, "an active receipt must not be acknowledged as accepted work")
	assert.equal(busyWebhookRes.headers.get("retry-after"), "5")
	assert.equal((await busyWebhookRes.json()).retryable, true)
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
	const busyEmailBody = JSON.stringify({ from: "ap@vendor.test", subject: "Busy email", textBody: ":20:TXN-MAIL-BUSY\n:32A:261124EUR1200,00\n:71A:SHA" })
	const busyEmailIdentity = deriveWebhookEventId(busyEmailBody, "email_inbound", true)
	getCorridorDb().recordWebhookReceipt({
		workspaceId: DEFAULT_WORKSPACE_ID,
		provider: "email_inbound",
		eventId: busyEmailIdentity.eventId,
		sourceChannel: "email",
		filename: "busy-email.json",
		format: "json",
		rawContent: busyEmailBody,
	})
	assert.equal(getCorridorDb().claimWebhookReceipt({ provider: "email_inbound", eventId: busyEmailIdentity.eventId, ownerId: "active-email-worker" }), true)
	const busyEmailSignature = createHmac("sha256", secret).update(busyEmailBody, "utf8").digest("hex")
	const busyEmailRes = await emailWebhookRoute(new Request("http://127.0.0.1/api/webhooks/email", {
		method: "POST",
		headers: { "Content-Type": "application/json", "x-corridor-signature": `sha256=${busyEmailSignature}` },
		body: busyEmailBody,
	}))
	assert.equal(busyEmailRes.status, 503, "an active email receipt must be retried rather than acknowledged early")
	assert.equal(busyEmailRes.headers.get("retry-after"), "5")
	assert.equal((await busyEmailRes.json()).retryable, true)
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
