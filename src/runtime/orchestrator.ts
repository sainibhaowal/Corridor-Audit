import "dotenv/config"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, statSync, watch } from "node:fs"
import { extname, resolve } from "node:path"
import { getCorridorDb } from "../core/db/database"
import { normalizeInboundPayloadToCases } from "../core/ingest/normalize-upload"
import { MAX_MALWARE_SCAN_BYTES, MalwareScanLimitError, scanFileBytes } from "../core/security/malware-scan"
import { ACTIVE_MODEL_SLOT, DynamicEndpointRouter, resolveInitialProviderConfig } from "../core/llm/providers"
import type { AuditVerdict, SettlementCase } from "../core/types"
import { createCorridorAgents } from "./agents/corridor-agents"
import { createTrajectoryObserver } from "./agents/trajectory-observer"
import { CorridorState, initializeRuntime, join, publishCorridorEvent } from "./corridor-runtime"
import { startBackgroundSyncWorker } from "./workers/sync-worker"
import { runWithDurableCaseRetries } from "./workers/durable-case-queue"
import { resolveInvalidatedPendingApprovals } from "./workers/review-approval-expiry"

export interface CorridorOrchestrator {
	state: CorridorState
	router: DynamicEndpointRouter
	observerId: string
	hotFolder: string
	runCase: (settlementCase: SettlementCase) => Promise<AuditVerdict>
	enqueueBatch: (cases: SettlementCase[]) => Promise<AuditVerdict[]>
}

const globalStore = globalThis as typeof globalThis & {
	__corridorOrchestrator?: CorridorOrchestrator
	__corridorInboxWatcherStarted?: boolean
	__corridorCaseQueueWorkerStarted?: boolean
}

function startCaseQueueWorker(orchestrator: CorridorOrchestrator): void {
	if (globalStore.__corridorCaseQueueWorkerStarted) return
	globalStore.__corridorCaseQueueWorkerStarted = true
	const timer = setInterval(() => {
		resolveInvalidatedPendingApprovals({ db: getCorridorDb(), pendingApprovals: orchestrator.state.pendingApprovals })
		if (orchestrator.router.getPublicStatus().mode === "unconfigured") {
			orchestrator.state.queueStats.waiting = getCorridorDb().countQueuedCases()
			return
		}
		for (const queuedCase of getCorridorDb().listQueuedCases()) {
			void orchestrator.runCase(queuedCase).catch((err) => {
				console.error(`[CaseQueue] Processing failed for ${queuedCase.caseId}:`, err)
			})
		}
	}, 1000)
	timer.unref?.()
}

function startHotFolderWatcher(orchestrator: CorridorOrchestrator): void {
	if (globalStore.__corridorInboxWatcherStarted) return
	globalStore.__corridorInboxWatcherStarted = true

	const hotFolder = orchestrator.hotFolder
	if (!existsSync(hotFolder)) mkdirSync(hotFolder, { recursive: true })
	const seenFiles = new Set<string>()
	try {
		const watcher = watch(hotFolder, (_eventType, filename) => {
			if (!filename || seenFiles.has(filename)) return
			const fullPath = resolve(hotFolder, filename)
			if (!existsSync(fullPath)) return
			seenFiles.add(filename)
			setTimeout(() => void (async () => {
				let ingestionId: string | undefined
				try {
					const ext = extname(filename).toLowerCase()
					if (statSync(fullPath).size > MAX_MALWARE_SCAN_BYTES) throw new MalwareScanLimitError()
					const buf = readFileSync(fullPath)
					const malwareScan = await scanFileBytes(buf)
					const isPdf = ext === ".pdf"
					const rec = getCorridorDb().saveRawIngestion({
						sourceChannel: "hot_folder",
						sourceProvider: "inbox_watcher",
						filename,
						format: ext.replace(/^\./, "") || "auto",
						rawContent: isPdf ? buf.toString("base64") : buf.toString("utf8"),
						isBase64: isPdf,
						metadata: { fullPath, malwareScan: malwareScan.status },
					})
					ingestionId = rec.id
					const cases = normalizeInboundPayloadToCases(
						isPdf
							? { filename, base64: buf.toString("base64"), format: "pdf" }
							: { filename, content: buf.toString("utf8"), format: "auto" },
					)
					getCorridorDb().updateRawIngestionOutcome({
						id: rec.id,
						parseStatus: "parsed",
						caseIds: cases.map((c) => c.caseId),
					})
					void orchestrator.enqueueBatch(cases).catch((err) => {
						console.error(`Hot-folder ingestion ${rec.id} failed during audit processing:`, err)
					})
				} catch (error) {
					const message = error instanceof Error ? error.message : "unknown error"
					if (ingestionId) {
						try {
							getCorridorDb().updateRawIngestionOutcome({ id: ingestionId, parseStatus: "failed", parseError: message })
						} catch (recordError) {
							console.error(`Hot-folder ingestion ${ingestionId} could not record its failure:`, recordError)
						}
					}
					console.error(`Hot-folder file ${filename} was not accepted:`, message)
				}
			})(), 250)
		})
		watcher.unref?.()
	} catch {
		// watch optional on restricted filesystems
	}
}

export function initCorridorOrchestrator(options?: { autoApprove?: boolean }): CorridorOrchestrator {
	const existing = globalStore.__corridorOrchestrator
	if (existing) {
		if (options?.autoApprove !== undefined) {
			existing.state.autoApproveBreakpoints = options.autoApprove
		}
		return existing
	}

	const initialConfig = resolveInitialProviderConfig()
	const maxConcurrent = Number(process.env.MAX_CONCURRENT_LLM_CALLS || "3") || 3
	const router = new DynamicEndpointRouter(initialConfig, maxConcurrent)
	const state = new CorridorState()
	state.autoApproveBreakpoints =
		options?.autoApprove ?? process.env.AUTO_APPROVE_BREAKPOINTS === "true"

	const db = getCorridorDb()
	const workerId = `local-${randomUUID()}`
	for (const persistedCase of db.listPersistedCases()) {
		state.casesById.set(persistedCase.caseId, persistedCase)
	}
	for (const persistedVerdict of db.listPersistedVerdicts()) {
		state.auditByCaseId.set(persistedVerdict.caseId, persistedVerdict)
	}

	initializeRuntime({
		state,
		inferenceRunnerConfig: {
			supportedModels: router.createSupportedModelsList(),
			runner: router,
		},
	})

	const agents = createCorridorAgents()
	const observer = createTrajectoryObserver(agents)

	join(observer)
	join(agents.termsAgent)
	join(agents.fxAgent)
	join(agents.wireAgent)
	join(agents.anomalyAgent)
	join(agents.auditorAgent)

	// Serialize queued cases cleanly so parallel specialists per case run concurrently
	// without colliding on free-tier LLM rate limits.
	let batchChain: Promise<unknown> = Promise.resolve()
	const caseTasks = new Map<string, Promise<AuditVerdict>>()

	const runSingleCase = async (settlementCase: SettlementCase, claimedBy: string): Promise<AuditVerdict> => {
		state.registerCase(settlementCase)
		state.queueStats.active += 1

		state.emitTrajectory({
			caseId: settlementCase.caseId,
			kind: "phase.changed",
			phase: "PHASE 1 · SPECIALISTS IN PARALLEL",
			payload: {
				caseInfo: {
					caseId: settlementCase.caseId,
					title: settlementCase.title,
					channelLabel: settlementCase.channelLabel,
					corridor: `${settlementCase.invoice?.expectedAmount.currency ?? settlementCase.wire.instructedAmount?.currency ?? "USD"} → ${settlementCase.wire.settledAmount.currency}`,
					expectedRoles: [...(state.expectedRolesByCaseId.get(settlementCase.caseId) ?? [])],
				},
			},
		})

		state.emitTrajectory({
			caseId: settlementCase.caseId,
			kind: "case.queued",
			text: `Mozaik queued ${settlementCase.caseId}: launching ${[...(state.expectedRolesByCaseId.get(settlementCase.caseId) ?? [])].length} parallel agents...`,
		})

		publishCorridorEvent("case.queued", observer.getId(), {
			caseId: settlementCase.caseId,
			title: settlementCase.title,
			model: ACTIVE_MODEL_SLOT,
		})

		try {
			const verdict = await state.waitForCaseVerdict(
				settlementCase.caseId,
				180_000,
				() => state.pendingApprovals.has(settlementCase.caseId),
			)
			getCorridorDb().saveAuditVerdict(verdict, undefined, claimedBy)
			state.queueStats.done += 1
			return verdict
		} catch (err) {
			state.emitTrajectory({
				caseId: settlementCase.caseId,
				kind: "error",
				text: err instanceof Error ? err.message : String(err),
			})
			throw err
		} finally {
			if (state.queueStats.active > 0) state.queueStats.active -= 1
		}
	}

	const runCase = (settlementCase: SettlementCase): Promise<AuditVerdict> => {
		const active = caseTasks.get(settlementCase.caseId)
		if (active) return active
		const completed = state.auditByCaseId.get(settlementCase.caseId)
		if (completed) return Promise.resolve(completed)
		// Persist before scheduling so accepted local work survives a process restart.
		getCorridorDb().saveCase(settlementCase)
		if (router.getPublicStatus().mode === "unconfigured") {
			state.casesById.set(settlementCase.caseId, settlementCase)
			state.queueStats.waiting = getCorridorDb().countQueuedCases()
			return Promise.reject(new Error("Configure an LLM provider before running queued settlement audits."))
		}
		state.queueStats.waiting += 1
		const task = batchChain.then(() => runWithDurableCaseRetries({
			db: getCorridorDb(),
			caseId: settlementCase.caseId,
			workerId,
			runAttempt: (claimedBy) => runSingleCase(settlementCase, claimedBy),
			shouldRetry: (error) => !(error instanceof Error && error.message.startsWith("Timed out waiting for")),
			onAttemptStart: () => {
				if (state.queueStats.waiting > 0) state.queueStats.waiting -= 1
			},
			onRetryScheduled: () => { state.queueStats.waiting += 1 },
			onDeadLetter: () => { state.queueStats.failed += 1 },
		}))
		const tracked = task.finally(() => {
			if (caseTasks.get(settlementCase.caseId) === tracked) caseTasks.delete(settlementCase.caseId)
		})
		caseTasks.set(settlementCase.caseId, tracked)
		batchChain = tracked.catch(() => undefined)
		return tracked
	}

	const enqueueBatch = (cases: SettlementCase[]): Promise<AuditVerdict[]> => {
		if (router.getPublicStatus().mode === "unconfigured") {
			const db = getCorridorDb()
			for (const settlementCase of cases) {
				db.saveCase(settlementCase)
				state.casesById.set(settlementCase.caseId, settlementCase)
			}
			state.queueStats.waiting = db.countQueuedCases()
			return Promise.resolve([])
		}
		const promises = cases.map((c) => runCase(c))
		return Promise.all(promises)
	}

	const hotFolder = process.env.HOT_FOLDER
		? resolve(process.cwd(), process.env.HOT_FOLDER)
		: resolve(process.cwd(), "data/inbox")

	const orchestrator: CorridorOrchestrator = {
		state,
		router,
		observerId: observer.getId(),
		hotFolder,
		runCase,
		enqueueBatch,
	}

	globalStore.__corridorOrchestrator = orchestrator
	startHotFolderWatcher(orchestrator)
	startCaseQueueWorker(orchestrator)
	startBackgroundSyncWorker(orchestrator)
	if (router.getPublicStatus().mode === "unconfigured") {
		state.queueStats.waiting = db.countQueuedCases()
	} else {
		for (const queuedCase of db.listQueuedCases()) {
			void runCase(queuedCase).catch((err) => {
				console.error(`Failed to resume queued case ${queuedCase.caseId}:`, err)
			})
		}
	}
	return orchestrator
}
