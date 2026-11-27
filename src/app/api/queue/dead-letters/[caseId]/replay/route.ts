import { NextResponse } from "next/server"
import { getCorridorDb } from "@/core/db/database"
import { authorizeCorridorRequest, authorizedRequestWorkspaceId } from "@/core/security/authorization"
import { initCorridorOrchestrator } from "@/runtime/orchestrator"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request, context: { params: Promise<{ caseId: string }> }) {
	const denied = await authorizeCorridorRequest(request, "controller")
	if (denied) return denied
	const workspaceId = authorizedRequestWorkspaceId(request)
	const { caseId } = await context.params
	const settlementCase = getCorridorDb().retryDeadLetterCase(caseId, workspaceId)
	if (!settlementCase) {
		return NextResponse.json({ ok: false, error: "Dead letter case not found or already replayed." }, { status: 404 })
	}
	void initCorridorOrchestrator().runCase(settlementCase).catch((error) => {
		console.error(`[CaseQueue] Operator replay failed for ${caseId}:`, error)
	})
	return NextResponse.json({ ok: true, caseId, status: "queued" }, { status: 202 })
}
