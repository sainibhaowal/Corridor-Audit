import { NextResponse } from "next/server"
import type { ProviderId } from "@/core/llm/providers"
import { initCorridorOrchestrator } from "@/runtime/orchestrator"
import { authorizeCorridorRequest } from "@/core/security/authorization"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
	const denied = await authorizeCorridorRequest(request, "owner")
	if (denied) return denied
	try {
		const body = (await request.json()) as {
			provider?: ProviderId
			modelName?: string
			modelDisplayName?: string
			apiKey?: string
			baseURL?: string
			breakpointMode?: "risk_only" | "step_tool"
		}
		const orchestrator = initCorridorOrchestrator()
		if (body.provider) {
			orchestrator.router.updateConfig({
				provider: body.provider,
				modelName: body.modelName,
				modelDisplayName: body.modelDisplayName,
				apiKey: body.apiKey,
				baseURL: body.baseURL,
			})
		}
		if (body.breakpointMode === "risk_only" || body.breakpointMode === "step_tool") {
			orchestrator.state.breakpointMode = body.breakpointMode
		}
		return NextResponse.json({
			ok: true,
			provider: orchestrator.router.getPublicStatus(),
			breakpointMode: orchestrator.state.breakpointMode,
		})
	} catch (err) {
		return NextResponse.json(
			{ error: err instanceof Error ? err.message : String(err) },
			{ status: 400 },
		)
	}
}
