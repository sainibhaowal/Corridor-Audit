import { NextResponse } from "next/server"
import { BUILD_PROVENANCE } from "@/core/build-info"
import { authorizeCorridorRequest } from "@/core/security/authorization"
import { initCorridorOrchestrator } from "@/runtime/orchestrator"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
	const denied = await authorizeCorridorRequest(request, "viewer")
	if (denied) return denied
	const orchestrator = initCorridorOrchestrator()
	return NextResponse.json({
		ok: true,
		runtime: "Mozaik @mozaik-ai/core@6.0.0",
		framework: "Next.js 15 App Router + TypeScript",
		build: BUILD_PROVENANCE,
		provider: orchestrator.router.getPublicStatus(),
		breakpointMode: orchestrator.state.breakpointMode,
		queueStats: orchestrator.state.queueStats,
		hotFolder: orchestrator.hotFolder,
	}, { headers: { "Cache-Control": "no-store" } })
}
