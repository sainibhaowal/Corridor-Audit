import { NextResponse } from "next/server"
import { initCorridorOrchestrator } from "@/runtime/orchestrator"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
	const orchestrator = initCorridorOrchestrator()
	return NextResponse.json({
		ok: true,
		runtime: "Mozaik @mozaik-ai/core@6.0.0",
		framework: "Next.js 15 App Router + TypeScript",
		provider: orchestrator.router.getPublicStatus(),
		breakpointMode: orchestrator.state.breakpointMode,
		queueStats: orchestrator.state.queueStats,
		hotFolder: orchestrator.hotFolder,
	})
}
