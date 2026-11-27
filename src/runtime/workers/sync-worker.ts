import { createHash, randomUUID } from "node:crypto"
import { DEFAULT_WORKSPACE_ID, getCorridorDb } from "../../core/db/database"
import type { SyncRunRecord } from "../../core/db/schema"
import type { IntegrationCredentials } from "../../core/db/schema"
import { fetchCasesFromIntegration } from "../../core/integrations/connectors"
import { refreshOAuthCredentials } from "../../core/integrations/oauth"
import type { SettlementCase } from "../../core/types"
import type { CorridorOrchestrator } from "../orchestrator"

const globalWorkerStore = globalThis as typeof globalThis & {
	__corridorSyncWorkerStarted?: boolean
	__corridorSyncIntervalMs?: number
}

function caseSnapshot(settlementCase: SettlementCase): string {
	const { createdAt: _createdAt, ...stable } = settlementCase
	return JSON.stringify(stable)
}

function prepareChangedCases(
	cases: SettlementCase[],
	db: ReturnType<typeof getCorridorDb>,
	workspaceId: string,
): SettlementCase[] {
	const prepared: SettlementCase[] = []
	for (const settlementCase of cases) {
		const existing = db.getPersistedCase(settlementCase.caseId, workspaceId)
		if (!existing) {
			prepared.push(settlementCase)
			continue
		}
		if (caseSnapshot(existing) === caseSnapshot(settlementCase)) continue

		const revisionHash = createHash("sha256").update(caseSnapshot(settlementCase), "utf8").digest("hex").slice(0, 12)
		const revisionCase: SettlementCase = {
			...settlementCase,
			caseId: `${settlementCase.caseId}-R${revisionHash}`,
			title: `${settlementCase.title} (source revision)`,
			sourceRevisionOf: existing.sourceRevisionOf || settlementCase.caseId,
		}
		const priorRevision = db.getPersistedCase(revisionCase.caseId, workspaceId)
		if (!priorRevision || caseSnapshot(priorRevision) !== caseSnapshot(revisionCase)) prepared.push(revisionCase)
	}
	return prepared
}

async function credentialsForSync(params: {
	db: ReturnType<typeof getCorridorDb>
	workspaceId: string
	provider: string
}): Promise<IntegrationCredentials | null> {
	const current = params.db.getDecryptedCredentials(params.workspaceId, params.provider)
	if (!current?.expiresAt || Date.parse(current.expiresAt) > Date.now() + 120_000) return current
	if (!current.refreshToken) throw new Error(`OAuth access token for ${params.provider} is expired and has no refresh token. Reconnect this integration.`)

	const ownerId = `refresh-${randomUUID()}`
	const waitDeadline = Date.now() + 50_000
	while (Date.now() < waitDeadline) {
		const latest = params.db.getDecryptedCredentials(params.workspaceId, params.provider)
		if (!latest) throw new Error(`Credentials for ${params.provider} were removed during token refresh.`)
		if (!latest.expiresAt || Date.parse(latest.expiresAt) > Date.now() + 120_000) return latest

		const acquired = params.db.claimIntegrationRefreshLease({
			workspaceId: params.workspaceId,
			provider: params.provider,
			ownerId,
			leaseMs: 45_000,
		})
		if (acquired) {
			try {
				const beforeRefresh = params.db.getDecryptedCredentials(params.workspaceId, params.provider)
				if (!beforeRefresh) throw new Error(`Credentials for ${params.provider} were removed during token refresh.`)
				if (!beforeRefresh.expiresAt || Date.parse(beforeRefresh.expiresAt) > Date.now() + 120_000) return beforeRefresh
				if (!beforeRefresh.refreshToken) throw new Error(`OAuth access token for ${params.provider} is expired and has no refresh token. Reconnect this integration.`)
				const updated = await refreshOAuthCredentials(params.provider, beforeRefresh)
				params.db.updateIntegrationCredentials(params.workspaceId, params.provider, updated)
				return updated
			} finally {
				params.db.releaseIntegrationRefreshLease({ workspaceId: params.workspaceId, provider: params.provider, ownerId })
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 100))
	}
	throw new Error(`Timed out waiting for another worker to refresh the ${params.provider} OAuth credentials.`)
}

export async function runIntegrationSync(params: {
	provider: string
	trigger?: "manual" | "cron" | "webhook"
	workspaceId?: string
	orchestrator: CorridorOrchestrator
}): Promise<SyncRunRecord> {
	const db = getCorridorDb()
	const workspaceId = params.workspaceId || DEFAULT_WORKSPACE_ID
	const integration = db.getIntegration(workspaceId, params.provider)

	if (!integration || integration.status === "disconnected") {
		throw new Error(`Integration "${params.provider}" is not connected.`)
	}

	const run = db.createSyncRun({
		integrationId: integration.id,
		workspaceId,
		provider: integration.provider,
		trigger: params.trigger ?? "manual",
	})

	db.markIntegrationSyncState({
		integrationId: integration.id,
		status: "syncing",
		lastError: null,
	})

	try {
		const credentials = await credentialsForSync({ db, workspaceId, provider: integration.provider })
		const fetched = await fetchCasesFromIntegration({ integration, credentials, lastSuccessfulSyncAt: integration.lastSyncedAt })

		const freshCases = prepareChangedCases(fetched.cases, db, workspaceId)
		if (fetched.rawPayload !== undefined) {
			db.saveRawIngestion({
				workspaceId,
				sourceChannel: "platform_sync",
				sourceProvider: integration.provider,
				filename: `${integration.provider}-sync-${run.id}.json`,
				format: "json",
				rawContent: fetched.rawPayload,
				metadata: {
					syncRunId: run.id,
					trigger: run.trigger,
					provider: integration.provider,
					recordsFetched: String(fetched.recordsFetched),
					mappingCaseCount: String(fetched.cases.length),
				},
				parseStatus: "parsed",
				caseIds: freshCases.map((c) => c.caseId),
			})
		} else if (freshCases.length > 0) {
			db.saveRawIngestion({
				workspaceId,
				sourceChannel: "platform_sync",
				sourceProvider: integration.provider,
				filename: `${integration.provider}-sync-${run.id}.json`,
				format: "json",
				rawContent: JSON.stringify(freshCases, null, 2),
				metadata: { syncRunId: run.id, trigger: run.trigger, provider: integration.provider },
				parseStatus: "parsed",
				caseIds: freshCases.map((c) => c.caseId),
			})
		}
		if (freshCases.length > 0) {
			void params.orchestrator.enqueueBatch(freshCases).catch((err) => {
				console.error(`[SyncWorker] Batch error for ${integration.provider}:`, err)
			})
		}

		const now = new Date().toISOString()
		db.finishSyncRun({
			id: run.id,
			status: "success",
			recordsFetched: fetched.recordsFetched,
			casesQueued: freshCases.length,
		})
		db.markIntegrationSyncState({
			integrationId: integration.id,
			status: "connected",
			lastSyncStatus: "success",
			lastError: null,
			lastSyncedAt: now,
		})

		return {
			...run,
			status: "success",
			recordsFetched: fetched.recordsFetched,
			casesQueued: freshCases.length,
			finishedAt: now,
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		const now = new Date().toISOString()
		db.finishSyncRun({
			id: run.id,
			status: "failed",
			recordsFetched: 0,
			casesQueued: 0,
			error: msg,
		})
		db.markIntegrationSyncState({
			integrationId: integration.id,
			status: "error",
			lastSyncStatus: "failed",
			lastError: msg,
		})

		return {
			...run,
			status: "failed",
			error: msg,
			finishedAt: now,
		}
	}
}

export async function runAllConnectedSyncs(
	orchestrator: CorridorOrchestrator,
	workspaceId = DEFAULT_WORKSPACE_ID,
): Promise<SyncRunRecord[]> {
	const db = getCorridorDb()
	const connected = db
		.listIntegrations(workspaceId)
		.filter((i) => i.status === "connected" && i.provider !== "email_inbound")

	const results: SyncRunRecord[] = []
	for (const item of connected) {
		results.push(
			await runIntegrationSync({
				provider: item.provider,
				trigger: "cron",
				workspaceId,
				orchestrator,
			}),
		)
	}
	return results
}

export function startBackgroundSyncWorker(orchestrator: CorridorOrchestrator): void {
	if (globalWorkerStore.__corridorSyncWorkerStarted) return
	globalWorkerStore.__corridorSyncWorkerStarted = true

	const intervalMs = Math.max(30_000, Number(process.env.SYNC_INTERVAL_MS || "300000") || 300_000)
	globalWorkerStore.__corridorSyncIntervalMs = intervalMs

	const timer = setInterval(() => {
		void runAllConnectedSyncs(orchestrator).catch((err) => {
			console.error("[SyncWorker] Cron tick failed:", err)
		})
	}, intervalMs)
	timer.unref?.()
}
