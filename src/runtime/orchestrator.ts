import "dotenv/config"
import { existsSync, mkdirSync, readFileSync, watch } from "node:fs"
import { extname, resolve } from "node:path"
import { getCorridorDb } from "../core/db/database"
import { normalizeInboundPayloadToCases } from "../core/ingest/normalize-upload"
import { ACTIVE_MODEL_SLOT, DynamicEndpointRouter, resolveInitialProviderConfig } from "../core/llm/providers"
import type { AuditVerdict, SettlementCase } from "../core/types"
import { createCorridorAgents } from "./agents/corridor-agents"
import { createTrajectoryObserver } from "./agents/trajectory-observer"
import { CorridorState, initializeRuntime, join, publishCorridorEvent } from "./corridor-runtime"
import { startBackgroundSyncWorker } from "./workers/sync-worker"

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
			setTimeout(() => {
				try {
					const ext = extname(filename).toLowerCase()
					const buf = readFileSync(fullPath)
					const cases = normalizeInboundPayloadToCases(
						ext === ".pdf"
							? { filename, base64: buf.toString("base64"), format: "pdf" }
							: { filename, content: buf.toString("utf8"), format: "auto" },
					)
					void orchestrator.enqueueBatch(cases)
				} catch {
					// ignore transient partial write errors
				}
			}, 250)
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

	const runSingleCase = async (settlementCase: SettlementCase): Promise<AuditVerdict> => {
		state.registerCase(settlementCase)
		getCorridorDb().saveCase(settlementCase)
		state.queueStats.active += 1
		if (state.queueStats.waiting > 0) state.queueStats.waiting -= 1

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
			const verdict = await state.waitForCaseVerdict(settlementCase.caseId, 180_000)
			getCorridorDb().saveAuditVerdict(verdict)
			state.queueStats.done += 1
			return verdict
		} catch (err) {
			state.queueStats.failed += 1
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
		state.queueStats.waiting += 1
		const task = batchChain.then(() => runSingleCase(settlementCase))
		batchChain = task.catch(() => undefined)
		return task
	}

	const enqueueBatch = async (cases: SettlementCase[]): Promise<AuditVerdict[]> => {
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
	startBackgroundSyncWorker(orchestrator)
	return orchestrator
}
