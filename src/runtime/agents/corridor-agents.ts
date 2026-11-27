import {
	Agent,
	createAgent,
	DeveloperMessageItem,
	ModelContext,
	type SituationContext,
	type SituationHandler,
	SituationSpecification,
	type Tool,
} from "@mozaik-ai/core"
import { ACTIVE_MODEL_SLOT } from "../../core/llm/providers"
import { resolveRuntime, runLoop } from "../corridor-runtime"
import { anomalyTools } from "../tools/anomaly-tools"
import { auditTools } from "../tools/audit-tools"
import { fxTools } from "../tools/fx-tools"
import { instrumentTools } from "../tools/instrument"
import { termsTools } from "../tools/terms-tools"
import { wireTools } from "../tools/wire-tools"
import { SettlementGateInterceptionHandler } from "../interception/settlement-gate"
import { AGENT_PROMPTS } from "./agent-prompts"

export type RoleKey = "terms" | "fx" | "wire" | "anomaly"

const activeCaseByAgentId = new Map<string, string>()

export function getAgentRoleMap(agents: {
	termsAgent: Agent
	fxAgent: Agent
	wireAgent: Agent
	anomalyAgent: Agent
	auditorAgent: Agent
}): Map<string, { name: string; role: RoleKey | "auditor" }> {
	return new Map([
		[agents.termsAgent.getId(), { name: "TermsAgent", role: "terms" }],
		[agents.fxAgent.getId(), { name: "FxBenchmarkAgent", role: "fx" }],
		[agents.wireAgent.getId(), { name: "WireDetectiveAgent", role: "wire" }],
		[agents.anomalyAgent.getId(), { name: "DuplicateAnomalyAgent", role: "anomaly" }],
		[agents.auditorAgent.getId(), { name: "AuditorAgent", role: "auditor" }],
	])
}

export function getActiveCaseForAgent(agentId: string): string | undefined {
	return activeCaseByAgentId.get(agentId)
}

function createSpecialistAgent(params: {
	name: string
	role: RoleKey
	instruction: string
	tools: Tool[]
}): Agent {
	const handler: SituationHandler = {
		specification: new (class extends SituationSpecification {
			isSatisfiedBy(ctx: SituationContext): boolean {
				if (ctx.event.type !== "case.queued") return false
				const { caseId } = ctx.event.payload as { caseId: string }
				const state = resolveRuntime().state
				const expected = state.expectedRolesByCaseId.get(caseId)
				if (!expected?.has(params.role)) return false
				return !state.findingsByRole.get(caseId)?.has(params.role)
			}
		})(),
		processor: {
			apply(ctx: SituationContext): void {
				const agent = ctx.participant as Agent
				const { caseId, title } = ctx.event.payload as { caseId: string; title?: string }
				const state = resolveRuntime().state
				activeCaseByAgentId.set(agent.getId(), caseId)

				state.emitTrajectory({
					caseId,
					kind: "agent.started",
					agentName: params.name,
					phase: "PHASE 1 · SPECIALISTS IN PARALLEL",
					status: "running",
				})

				const freshContext = ModelContext.create().addContextItem(
					DeveloperMessageItem.create(agent.getDeveloperMessage()),
				)
				const prompt = `Audit settlement case ${caseId}${title ? ` (${title})` : ""}. Execute your mandatory tool workflow now.`
				runLoop(agent.getId(), prompt, {
					model: ACTIVE_MODEL_SLOT,
					maxOutputTokens: 4096,
					streaming: true,
					context: freshContext,
					tools: agent.getTools(),
				})
			},
		},
	}

	const rerunHandler: SituationHandler = {
		specification: new (class extends SituationSpecification {
			isSatisfiedBy(ctx: SituationContext): boolean {
				if (ctx.event.type !== "specialist.rerun") return false
				const { role } = ctx.event.payload as { role?: string }
				return role === params.role
			}
		})(),
		processor: {
			apply(ctx: SituationContext): void {
				const agent = ctx.participant as Agent
				const { caseId, feedback, attempt } = ctx.event.payload as {
					caseId: string
					feedback?: string
					attempt?: number
				}
				const state = resolveRuntime().state
				activeCaseByAgentId.set(agent.getId(), caseId)
				const rawSnippet = state.casesById.get(caseId)?.wire.rawText?.slice(0, 1200)

				state.emitTrajectory({
					caseId,
					kind: "agent.started",
					agentName: params.name,
					phase: `TARGETED RE-RUN · ATTEMPT ${attempt ?? 1}`,
					status: "running",
				})

				const freshContext = ModelContext.create().addContextItem(
					DeveloperMessageItem.create(agent.getDeveloperMessage()),
				)
				const prompt = [
					`AuditorAgent requested a targeted re-run for settlement case ${caseId}.`,
					feedback ? `Auditor feedback: ${feedback}` : "",
					rawSnippet ? `Raw extracted text excerpt:\n${rawSnippet}` : "",
					`Re-execute your mandatory deterministic tool workflow now to produce an accurate result.`,
				]
					.filter(Boolean)
					.join("\n\n")
				runLoop(agent.getId(), prompt, {
					model: ACTIVE_MODEL_SLOT,
					maxOutputTokens: 4096,
					streaming: true,
					context: freshContext,
					tools: agent.getTools(),
				})
			},
		},
	}

	return createAgent({
		name: params.name,
		capabilities: [params.role],
		instruction: params.instruction,
		tools: instrumentTools(params.name, params.tools),
		handlers: [handler, rerunHandler],
	})
}

export function createCorridorAgents() {
	const termsAgent = createSpecialistAgent({
		name: "TermsAgent",
		role: "terms",
		instruction: AGENT_PROMPTS.terms,
		tools: termsTools,
	})

	const fxAgent = createSpecialistAgent({
		name: "FxBenchmarkAgent",
		role: "fx",
		instruction: AGENT_PROMPTS.fx,
		tools: fxTools,
	})

	const wireAgent = createSpecialistAgent({
		name: "WireDetectiveAgent",
		role: "wire",
		instruction: AGENT_PROMPTS.wire,
		tools: wireTools,
	})

	const anomalyAgent = createSpecialistAgent({
		name: "DuplicateAnomalyAgent",
		role: "anomaly",
		instruction: AGENT_PROMPTS.anomaly,
		tools: anomalyTools,
	})

	const gateHandler = new SettlementGateInterceptionHandler()

	const onAllSpecialistsReady: SituationHandler = {
		specification: new (class extends SituationSpecification {
			isSatisfiedBy(ctx: SituationContext): boolean {
				if (ctx.event.type !== "specialist.ready") return false
				const { caseId } = ctx.event.payload as { caseId: string }
				const state = resolveRuntime().state
				if (state.auditByCaseId.has(caseId)) return false
				const expected = state.expectedRolesByCaseId.get(caseId)
				const done = state.findingsByRole.get(caseId)
				if (!expected || !done) return false
				for (const role of expected) {
					if (!done.has(role)) return false
				}
				return true
			}
		})(),
		processor: {
			apply(ctx: SituationContext): void {
				const agent = ctx.participant as Agent
				const { caseId } = ctx.event.payload as { caseId: string }
				const state = resolveRuntime().state
				activeCaseByAgentId.set(agent.getId(), caseId)

				state.emitTrajectory({
					caseId,
					kind: "phase.changed",
					phase: "PHASE 2 · CROSS-CHECK & CENT PROOF",
					agentName: "AuditorAgent",
				})
				state.emitTrajectory({
					caseId,
					kind: "agent.started",
					agentName: "AuditorAgent",
					phase: "PHASE 2 · CROSS-CHECK & CENT PROOF",
					status: "running",
				})

				const termsSummary = state.termsByCaseId.get(caseId)?.clauseSummary ?? "ready"
				const fxSummary = state.fxByCaseId.get(caseId)?.agentSummary ?? "ready"
				const wireAssessment = state.wireByCaseId.get(caseId)
				const prompt = `All parallel specialists finished ${caseId}:
- TermsAgent: ${termsSummary}
- FxBenchmarkAgent: ${fxSummary}
- WireDetectiveAgent: wireId=${wireAssessment?.wireId ?? "N/A"}, matchedInvoice=${wireAssessment?.matchedInvoiceId ?? "N/A"}

Run verify_settlement_balance, verify_citations_integrity, simulate_corridor_replay, and finalize_settlement_action for caseId="${caseId}".`

				const freshContext = ModelContext.create().addContextItem(
					DeveloperMessageItem.create(agent.getDeveloperMessage()),
				)
				runLoop(
					agent.getId(),
					prompt,
					{
						model: ACTIVE_MODEL_SLOT,
						maxOutputTokens: 4096,
						streaming: true,
						context: freshContext,
						tools: agent.getTools(),
					},
					gateHandler,
				)
			},
		},
	}

	const auditorAgent = createAgent({
		name: "AuditorAgent",
		capabilities: ["audit", "verify", "reconcile"],
		instruction: AGENT_PROMPTS.auditor,
		tools: instrumentTools("AuditorAgent", auditTools),
		handlers: [onAllSpecialistsReady],
	})

	return {
		termsAgent,
		fxAgent,
		wireAgent,
		anomalyAgent,
		auditorAgent,
	}
}
