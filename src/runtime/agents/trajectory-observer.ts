import {
	createHuman,
	type ModelMessageItem,
	type SituationContext,
	type SituationHandler,
	SituationSpecification,
} from "@mozaik-ai/core"
import { computeRecoverableOurViolationMinor, formatMoney } from "../../core/money"
import { getCorridorDb } from "../../core/db/database"
import { publishCorridorEvent, resolveRuntime } from "../corridor-runtime"
import { getActiveCaseForAgent, getAgentRoleMap } from "./corridor-agents"

function extractStreamDelta(payload: unknown): { answerDelta?: string; reasoningDelta?: string } {
	if (!payload || typeof payload !== "object") return {}
	const p = payload as Record<string, unknown>

	// Handle Mozaik / OpenAI Responses / OpenAI Chat Completions / Gemini / Anthropic stream shapes
	if (typeof p.type === "string") {
		if (p.type.includes("reasoning") && typeof p.delta === "string") {
			return { reasoningDelta: p.delta }
		}
		if (p.type.includes("output_text.delta") && typeof p.delta === "string") {
			return { answerDelta: p.delta }
		}
	}
	if (typeof p.delta === "string") {
		return { answerDelta: p.delta }
	}
	const choices = p.choices as Array<{ delta?: { content?: string; reasoning_content?: string } }> | undefined
	const delta = choices?.[0]?.delta
	if (delta) {
		return {
			answerDelta: typeof delta.content === "string" ? delta.content : undefined,
			reasoningDelta: typeof delta.reasoning_content === "string" ? delta.reasoning_content : undefined,
		}
	}
	return {}
}

function buildOverlapSignals(caseId: string): Array<{ left: string; relation: "contradicts" | "in_sync"; right: string; tone: "bad" | "ok" | "warn" }> {
	const state = resolveRuntime().state
	const c = state.casesById.get(caseId)
	const terms = state.termsByCaseId.get(caseId)
	const fx = state.fxByCaseId.get(caseId)
	const wire = state.wireByCaseId.get(caseId)
	const anomaly = state.anomalyByCaseId.get(caseId)
	const signals: Array<{ left: string; relation: "contradicts" | "in_sync"; right: string; tone: "bad" | "ok" | "warn" }> = []

	if (terms && wire && c) {
		const recoverable = computeRecoverableOurViolationMinor({
			contractedBearer: terms.contractedChargeBearer,
			wireBearer: c.wire.chargeBearer,
			normalizedReceiverChargesMinor: wire.normalizedReceiverFeesMinor,
			normalizedRepairFeeMinor: wire.normalizedRepairFeeMinor,
		})
		if (recoverable > 0) {
			signals.push({
				left: `Terms (${terms.contractedChargeBearer})`,
				relation: "contradicts",
				right: `Wire (-${formatMoney(recoverable, c.wire.settledAmount.currency)})`,
				tone: "bad",
			})
		} else {
			signals.push({
				left: `Terms (${terms.contractedChargeBearer})`,
				relation: "in_sync",
				right: `Wire (${c.wire.chargeBearer ?? terms.contractedChargeBearer})`,
				tone: "ok",
			})
		}
	}

	if (fx) {
		signals.push({
			left: `ECB (${fx.rateRecord.midMarketRate})`,
			relation: fx.fxSpreadBps > 150 ? "contradicts" : "in_sync",
			right: fx.fxSpreadLossMinor > 0 ? `FX Spread (-${formatMoney(fx.fxSpreadLossMinor, fx.rateRecord.to)})` : `Parity OK`,
			tone: fx.fxSpreadBps > 150 ? "warn" : "ok",
		})
	}

	if (anomaly && anomaly.classification === "TRUE_DUPLICATE") {
		signals.push({
			left: `${anomaly.duplicateCount} Wires`,
			relation: "contradicts",
			right: `Duplicate Feed`,
			tone: "bad",
		})
	}

	return signals
}

export function createTrajectoryObserver(agents: Parameters<typeof getAgentRoleMap>[0]) {
	const roleMap = getAgentRoleMap(agents)

	const onInferenceStarted: SituationHandler = {
		specification: new (class extends SituationSpecification {
			isSatisfiedBy(ctx: SituationContext): boolean {
				return ctx.event.type === "inference.started" && roleMap.has(ctx.event.producerId)
			}
		})(),
		processor: {
			apply(ctx: SituationContext): void {
				const info = roleMap.get(ctx.event.producerId)!
				const caseId = getActiveCaseForAgent(ctx.event.producerId) ?? "CASE-001"
				resolveRuntime().state.emitTrajectory({
					caseId,
					kind: "agent.thinking",
					agentName: info.name,
					status: "thinking",
				})
			},
		},
	}

	const onInferenceStream: SituationHandler = {
		specification: new (class extends SituationSpecification {
			isSatisfiedBy(ctx: SituationContext): boolean {
				return ctx.event.type === "inference.stream" && roleMap.has(ctx.event.producerId)
			}
		})(),
		processor: {
			apply(ctx: SituationContext): void {
				const info = roleMap.get(ctx.event.producerId)!
				const caseId = getActiveCaseForAgent(ctx.event.producerId) ?? "CASE-001"
				const { answerDelta, reasoningDelta } = extractStreamDelta(ctx.event.payload)
				const state = resolveRuntime().state

				if (reasoningDelta) {
					state.emitTrajectory({
						caseId,
						kind: "agent.reasoning",
						agentName: info.name,
						text: reasoningDelta,
					})
				}
				if (answerDelta) {
					state.emitTrajectory({
						caseId,
						kind: "agent.stream",
						agentName: info.name,
						text: answerDelta,
					})
				}
			},
		},
	}

	const onModelAnswer: SituationHandler = {
		specification: new (class extends SituationSpecification {
			isSatisfiedBy(ctx: SituationContext): boolean {
				return ctx.event.type === "model.answer" && roleMap.has(ctx.event.producerId)
			}
		})(),
		processor: {
			apply(ctx: SituationContext): void {
				const info = roleMap.get(ctx.event.producerId)!
				const caseId = getActiveCaseForAgent(ctx.event.producerId) ?? "CASE-001"
				const payload = ctx.event.payload as { answer?: ModelMessageItem }
				const answerText = payload.answer?.content?.text ?? ""
				const state = resolveRuntime().state

				state.emitTrajectory({
					caseId,
					kind: "agent.completed",
					agentName: info.name,
					status: "done",
					text: answerText,
				})

				if (info.role !== "auditor") {
					try {
						const rolePayload =
							info.role === "terms"
								? state.termsByCaseId.get(caseId)
								: info.role === "fx"
									? state.fxByCaseId.get(caseId)
									: info.role === "wire"
										? state.wireByCaseId.get(caseId)
										: state.anomalyByCaseId.get(caseId)
						if (rolePayload !== undefined) {
							getCorridorDb().saveCaseCheckpoint({ caseId, role: info.role, payload: rolePayload })
						}
					} catch {
						// Best-effort checkpoint persistence; in-memory state continues cleanly.
					}
					const allDone = state.markRoleComplete(caseId, info.role)
					const overlaps = buildOverlapSignals(caseId)
					if (overlaps.length > 0) {
						state.emitTrajectory({
							caseId,
							kind: "overlap.updated",
							payload: { overlaps },
						})
					}
					if (allDone) {
						publishCorridorEvent("specialist.ready", ctx.participant.getId(), { caseId })
					}
				}
			},
		},
	}

	return createHuman({
		name: "TrajectoryObserver",
		capabilities: ["observe", "sse_stream"],
		handlers: [onInferenceStarted, onInferenceStream, onModelAnswer],
	})
}
