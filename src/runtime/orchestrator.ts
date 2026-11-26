import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { ACTIVE_MODEL_SLOT, DynamicEndpointRouter, resolveInitialProviderConfig } from "../core/llm/providers"
import type { AuditVerdict, SettlementCase } from "../core/types"
import { createCorridorAgents } from "./agents/corridor-agents"
import { createTrajectoryObserver } from "./agents/trajectory-observer"
import { CorridorState, initializeRuntime, join, publishCorridorEvent } from "./corridor-runtime"

export interface CorridorOrchestrator {
	state: CorridorState
	router: DynamicEndpointRouter
	observerId: string
	runCase: (settlementCase: SettlementCase) => Promise<AuditVerdict>
	enqueueBatch: (cases: SettlementCase[]) => Promise<AuditVerdict[]>
	loadBundledCases: () => SettlementCase[]
}

let singleton: CorridorOrchestrator | null = null

export function initCorridorOrchestrator(options?: { autoApprove?: boolean }): CorridorOrchestrator {
	if (singleton) {
		if (options?.autoApprove !== undefined) {
			singleton.state.autoApproveBreakpoints = options.autoApprove
		}
		return singleton
	}

	const initialConfig = resolveInitialProviderConfig()
	const maxConcurrent = Number(process.env.MAX_CONCURRENT_LLM_CALLS || "3") || 3
	const router = new DynamicEndpointRouter(initialConfig, maxConcurrent)
	const state = new CorridorState()
	state.autoApproveBreakpoints =
		options?.autoApprove ?? process.env.AUTO_APPROVE_BREAKPOINTS === "true"

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

	// Serialize queued batches gracefully so parallel specialists per case stay fast
	// without overwhelming free-tier LLM rate limits.
	let batchChain: Promise<unknown> = Promise.resolve()

	const runSingleCase = async (settlementCase: SettlementCase): Promise<AuditVerdict> => {
		state.registerCase(settlementCase)
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

	const loadBundledCases = (): SettlementCase[] => {
		const path = resolve(process.cwd(), "data/scenarios/black-friday-global-batch.json")
		const parsed = JSON.parse(readFileSync(path, "utf8")) as { cases: SettlementCase[] }
		return parsed.cases
	}

	singleton = {
		state,
		router,
		observerId: observer.getId(),
		runCase,
		enqueueBatch,
		loadBundledCases,
	}
	return singleton
}
