import { createHash, randomUUID } from "node:crypto"
import { DEFAULT_WORKSPACE_ID, getCorridorDb } from "../../core/db/database"
import type { IntegrationRecord, SyncRunRecord } from "../../core/db/schema"
import type { IntegrationCredentials } from "../../core/db/schema"
import { fetchCasesFromIntegration, ProviderPageLimitError, ProviderSyncLimitError } from "../../core/integrations/connectors"
import { refreshOAuthCredentials } from "../../core/integrations/oauth"
import type { SettlementCase } from "../../core/types"
import type { CorridorOrchestrator } from "../orchestrator"

const globalWorkerStore = globalThis as typeof globalThis & {
	__corridorSyncWorkerStarted?: boolean
	__corridorSyncIntervalMs?: number
}

const SYNC_LEASE_MS = 60_000
const SYNC_LEASE_RENEW_MS = 15_000
const CURSOR_RECONCILIATION_PROVIDERS = new Set(["stripe", "wise", "quickbooks", "xero"])

export function shouldRunFullProviderReconciliation(
	integration: Pick<IntegrationRecord, "provider" | "lastFullSyncedAt" | "lastFullSyncAttemptAt">,
	nowMs = Date.now(),
): boolean {
	if (!CURSOR_RECONCILIATION_PROVIDERS.has(integration.provider)) return false
	const hours = Number(process.env.PROVIDER_FULL_RECONCILIATION_INTERVAL_HOURS || "168")
	if (!Number.isSafeInteger(hours) || hours < 24 || hours > 720) {
		throw new Error("PROVIDER_FULL_RECONCILIATION_INTERVAL_HOURS must be an integer from 24 to 720.")
	}
	const intervalMs = hours * 60 * 60 * 1000
	const lastFullSyncMs = integration.lastFullSyncedAt ? Date.parse(integration.lastFullSyncedAt) : Number.NaN
	if (Number.isFinite(lastFullSyncMs) && nowMs - lastFullSyncMs < intervalMs) return false
	const lastAttemptMs = integration.lastFullSyncAttemptAt ? Date.parse(integration.lastFullSyncAttemptAt) : Number.NaN
	if (Number.isFinite(lastAttemptMs) && nowMs - lastAttemptMs < intervalMs) return false
	return true
}

export class IntegrationSyncBusyError extends Error {
	constructor(provider: string) {
		super(`A ${provider} sync is already running. Wait for it to finish before retrying.`)
		this.name = "IntegrationSyncBusyError"
	}
}

async function acquireIntegrationSyncLease(params: {
	db: ReturnType<typeof getCorridorDb>
	workspaceId: string
	provider: string
	ownerId: string
}): Promise<void> {
	const deadline = Date.now() + 30_000
	while (Date.now() < deadline) {
		if (params.db.claimIntegrationSyncLease({ ...params, leaseMs: SYNC_LEASE_MS })) return
		await new Promise((resolve) => setTimeout(resolve, 100))
	}
	throw new IntegrationSyncBusyError(params.provider)
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
	const initialIntegration = db.getIntegration(workspaceId, params.provider)

	if (!initialIntegration || initialIntegration.status === "disconnected") {
		throw new Error(`Integration "${params.provider}" is not connected.`)
	}
	let integration: IntegrationRecord = initialIntegration

	const leaseOwnerId = `sync-${randomUUID()}`
	await acquireIntegrationSyncLease({ db, workspaceId, provider: integration.provider, ownerId: leaseOwnerId })
	let leaseLost = false
	const leaseTimer = setInterval(() => {
		if (!db.renewIntegrationSyncLease({ workspaceId, provider: integration.provider, ownerId: leaseOwnerId, leaseMs: SYNC_LEASE_MS })) {
			leaseLost = true
		}
	}, SYNC_LEASE_RENEW_MS)
	leaseTimer.unref?.()
	const assertLease = () => {
		if (leaseLost || !db.renewIntegrationSyncLease({ workspaceId, provider: integration.provider, ownerId: leaseOwnerId, leaseMs: SYNC_LEASE_MS })) {
			leaseLost = true
			throw new Error(`Sync lease was lost for ${integration.provider}; fetched data was not committed.`)
		}
	}
	let run: SyncRunRecord | undefined
	let fullReconciliationAttemptAt: string | undefined
	let fullReconciliation = false
	try {
		const latestIntegration = db.getIntegration(workspaceId, params.provider)
		if (!latestIntegration || latestIntegration.status === "disconnected") {
			throw new Error(`Integration "${params.provider}" was disconnected before sync started.`)
		}
		integration = latestIntegration
		db.failInterruptedIntegrationSyncRuns(workspaceId, integration.provider)
		run = db.createSyncRun({
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
		const credentials = await credentialsForSync({ db, workspaceId, provider: integration.provider })
		assertLease()
		fullReconciliation = shouldRunFullProviderReconciliation(integration)
		let reconciliationMode: "full" | "incremental" | "incremental_after_full_limit" = fullReconciliation ? "full" : "incremental"
		if (
			!fullReconciliation &&
			!integration.lastSyncedAt &&
			!integration.lastFullSyncedAt &&
			integration.lastFullSyncAttemptAt
		) {
			throw new Error(`The initial ${integration.provider} full sync previously exceeded the page limit and no successful incremental cursor exists. Configure a smaller historical backfill window with the provider before retrying.`)
		}
		const invoiceSourceField = integration.provider === "quickbooks"
			? "quickbooks.invoice"
			: integration.provider === "xero"
				? "xero.invoice"
				: undefined
		const existingCases = invoiceSourceField
			? db.listPersistedCases(workspaceId).filter((settlementCase) =>
				settlementCase.invoice?.sourceRefs?.some((sourceRef) => sourceRef.field === invoiceSourceField),
			)
			: undefined
		let fetched
		try {
			fetched = await fetchCasesFromIntegration({
				integration,
				credentials,
				lastSuccessfulSyncAt: fullReconciliation ? undefined : integration.lastSyncedAt,
				existingCases,
			})
		} catch (error) {
			if (!(error instanceof ProviderPageLimitError) || !fullReconciliation) throw error
			fullReconciliationAttemptAt = new Date().toISOString()
			if (!integration.lastSyncedAt) {
				throw new Error(`${error.message} No earlier successful cursor exists, so incremental continuation is unsafe. Configure a smaller initial backfill window with the provider.`)
			}
			const warning = `${error.message} Incremental sync continued from the last successful cursor; full reconciliation remains incomplete.`
			reconciliationMode = "incremental_after_full_limit"
			fullReconciliation = false
			fetched = await fetchCasesFromIntegration({ integration, credentials, lastSuccessfulSyncAt: integration.lastSyncedAt, existingCases })
			fetched.warnings = [...(fetched.warnings ?? []), warning]
		}
		assertLease()

		const freshCases = prepareChangedCases(fetched.cases, db, workspaceId)
		assertLease()
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
					reconciliationMode,
					...(fetched.warnings?.length ? { mappingWarnings: JSON.stringify(fetched.warnings) } : {}),
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

		assertLease()
		const now = new Date().toISOString()
		db.finishSyncRun({
			id: run.id,
			status: "success",
			recordsFetched: fetched.recordsFetched,
			casesQueued: freshCases.length,
			caseIds: freshCases.map((settlementCase) => settlementCase.caseId),
			error: fetched.warnings?.join(" "),
		})
		db.markIntegrationSyncState({
			integrationId: integration.id,
			status: "connected",
			lastSyncStatus: "success",
			lastError: null,
			lastSyncedAt: now,
			lastFullSyncedAt: fullReconciliation ? now : undefined,
			lastFullSyncAttemptAt: fullReconciliationAttemptAt,
		})

		return {
			...run,
			status: "success",
			auditStatus: freshCases.length === 0 ? "not_queued" : "queued",
			recordsFetched: fetched.recordsFetched,
			casesQueued: freshCases.length,
			error: fetched.warnings?.join(" "),
			finishedAt: now,
		}
	} catch (err) {
		let msg = err instanceof Error ? err.message : String(err)
		if (!run) throw err
		if (err instanceof ProviderSyncLimitError) {
			if (fullReconciliation) fullReconciliationAttemptAt = new Date().toISOString()
			if (!leaseLost) {
				try {
					db.saveRawIngestion({
						workspaceId,
						sourceChannel: "platform_sync",
						sourceProvider: integration.provider,
						filename: `${integration.provider}-sync-${run.id}-limit-evidence.json`,
						format: "json",
						rawContent: err.rawPayload,
						metadata: {
							syncRunId: run.id,
							trigger: run.trigger,
							provider: integration.provider,
							resource: err.resource,
							recordsFetchedBeforeLimit: String(err.recordsFetched),
							evidenceTruncated: String(err.evidenceTruncated),
							partialCasesQueued: "0",
						},
						parseStatus: "failed",
						parseError: msg,
					})
				} catch (evidenceError) {
					const evidenceMessage = evidenceError instanceof Error ? evidenceError.message : String(evidenceError)
					msg = `${msg} Raw limit evidence could not be saved: ${evidenceMessage}`
					console.error(`[SyncWorker] Failed to save bounded limit evidence for ${integration.provider}:`, evidenceError)
				}
			}
		}
		if (leaseLost) {
			return { ...run, status: "failed", auditStatus: "unknown", error: msg, finishedAt: new Date().toISOString() }
		}
		const now = new Date().toISOString()
		db.finishSyncRun({
			id: run.id,
			status: "failed",
			recordsFetched: err instanceof ProviderSyncLimitError ? err.recordsFetched : 0,
			casesQueued: 0,
			error: msg,
		})
		db.markIntegrationSyncState({
			integrationId: integration.id,
			status: "error",
			lastSyncStatus: "failed",
			lastError: msg,
			lastFullSyncAttemptAt: fullReconciliationAttemptAt,
		})

		return {
			...run,
			status: "failed",
			auditStatus: "not_queued",
			error: msg,
			finishedAt: now,
		}
	} finally {
		clearInterval(leaseTimer)
		db.releaseIntegrationSyncLease({ workspaceId, provider: integration.provider, ownerId: leaseOwnerId })
	}
}

export async function runAllConnectedSyncs(
	orchestrator: CorridorOrchestrator,
	workspaceId = DEFAULT_WORKSPACE_ID,
): Promise<SyncRunRecord[]> {
	const db = getCorridorDb()
	const connected = db
		.listIntegrations(workspaceId)
		.filter((i) => (i.status === "connected" || i.status === "syncing") && i.provider !== "email_inbound")

	const results: SyncRunRecord[] = []
	for (const item of connected) {
		try {
			results.push(await runIntegrationSync({
				provider: item.provider,
				trigger: "cron",
				workspaceId,
				orchestrator,
			}))
		} catch (error) {
			if (error instanceof IntegrationSyncBusyError) continue
			throw error
		}
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
