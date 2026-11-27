import { NextResponse } from "next/server"
import { DEFAULT_WORKSPACE_ID } from "@/core/db/database"
import { initCorridorOrchestrator } from "@/runtime/orchestrator"
import { IntegrationSyncBusyError, runIntegrationSync } from "@/runtime/workers/sync-worker"
import { authorizeCorridorRequest } from "@/core/security/authorization"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(
	request: Request,
	context: { params: Promise<{ provider: string }> },
) {
	const denied = await authorizeCorridorRequest(request, "analyst")
	if (denied) return denied
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
		const status = err instanceof IntegrationSyncBusyError ? 409 : 400
		return NextResponse.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			{ status },
		)
	}
}
