import { DEFAULT_WORKSPACE_ID, getCorridorDb } from "../../core/db/database"
import type { SyncRunRecord } from "../../core/db/schema"
import type { IntegrationCredentials } from "../../core/db/schema"
import { fetchCasesFromIntegration } from "../../core/integrations/connectors"
import { refreshOAuthCredentials } from "../../core/integrations/oauth"
import type { CorridorOrchestrator } from "../orchestrator"

const globalWorkerStore = globalThis as typeof globalThis & {
	__corridorSyncWorkerStarted?: boolean
	__corridorSyncIntervalMs?: number
	__corridorOAuthRefreshes?: Map<string, Promise<IntegrationCredentials>>
}

async function credentialsForSync(params: {
	db: ReturnType<typeof getCorridorDb>
	workspaceId: string
	provider: string
}): Promise<IntegrationCredentials | null> {
	const credentials = params.db.getDecryptedCredentials(params.workspaceId, params.provider)
	if (!credentials?.expiresAt || Date.parse(credentials.expiresAt) > Date.now() + 120_000) return credentials
	if (!credentials.refreshToken) throw new Error(`OAuth access token for ${params.provider} is expired and has no refresh token. Reconnect this integration.`)

	const refreshes = globalWorkerStore.__corridorOAuthRefreshes ??= new Map()
	const key = `${params.workspaceId}:${params.provider}`
	let refresh = refreshes.get(key)
	if (!refresh) {
		refresh = refreshOAuthCredentials(params.provider, credentials)
		refreshes.set(key, refresh)
	}
	try {
		const updated = await refresh
		params.db.updateIntegrationCredentials(params.workspaceId, params.provider, updated)
		return updated
	} finally {
		if (refreshes.get(key) === refresh) refreshes.delete(key)
	}
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
		const fetched = await fetchCasesFromIntegration({ integration, credentials })

		const freshCases = fetched.cases.filter((c) => !params.orchestrator.state.casesById.has(c.caseId))
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
				caseIds: fetched.cases.map((c) => c.caseId),
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
