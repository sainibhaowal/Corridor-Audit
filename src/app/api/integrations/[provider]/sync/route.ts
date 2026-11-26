import { NextResponse } from "next/server"
import { DEFAULT_WORKSPACE_ID } from "@/core/db/database"
import { initCorridorOrchestrator } from "@/runtime/orchestrator"
import { runIntegrationSync } from "@/runtime/workers/sync-worker"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(
	_request: Request,
	context: { params: Promise<{ provider: string }> },
) {
	try {
		const { provider } = await context.params
		const orchestrator = initCorridorOrchestrator()
		const run = await runIntegrationSync({
			provider,
			trigger: "manual",
			workspaceId: DEFAULT_WORKSPACE_ID,
			orchestrator,
		})
		return NextResponse.json({ ok: run.status === "success", syncRun: run }, { status: run.status === "success" ? 200 : 502 })
	} catch (err) {
		return NextResponse.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			{ status: 400 },
		)
	}
}
