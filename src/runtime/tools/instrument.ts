import type { Tool } from "@mozaik-ai/core"
import { resolveRuntime } from "../corridor-runtime"

/**
 * Wraps any deterministic tool so every invocation streams exact start/end
 * timing, input JSON, output JSON, and SourceRefs to the UI Middle Panel.
 */
export function instrumentTools(agentName: string, tools: Tool[]): Tool[] {
	return tools.map((tool) => ({
		...tool,
		invoke: async (args: unknown) => {
			const state = resolveRuntime().state
			const obj = (args && typeof args === "object" ? args : {}) as { caseId?: string }
			const caseId = obj.caseId || [...state.casesById.keys()].at(-1) || "CASE-001"
			const callId = `${tool.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
			const argsJson = JSON.stringify(args)
			const startedAt = Date.now()

			state.emitTrajectory({
				caseId,
				kind: "tool.started",
				agentName,
				toolName: tool.name,
				callId,
				argsJson,
				status: "running",
			})

			try {
				const result = await tool.invoke(args)
				const durationMs = Math.max(1, Date.now() - startedAt)
				const resObj = (result && typeof result === "object" ? result : {}) as {
					sourceRefs?: unknown[]
					error?: string
				}

				state.emitTrajectory({
					caseId,
					kind: "tool.completed",
					agentName,
					toolName: tool.name,
					callId,
					durationMs,
					status: resObj.error ? "error" : "ok",
					argsJson,
					resultJson: JSON.stringify(result),
					sourceRefs: Array.isArray(resObj.sourceRefs) ? (resObj.sourceRefs as never[]) : undefined,
				})
				return result
			} catch (err) {
				const durationMs = Math.max(1, Date.now() - startedAt)
				state.emitTrajectory({
					caseId,
					kind: "tool.completed",
					agentName,
					toolName: tool.name,
					callId,
					durationMs,
					status: "error",
					argsJson,
					resultJson: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
				})
				throw err
			}
		},
	}))
}
