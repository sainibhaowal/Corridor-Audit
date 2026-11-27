import { NextResponse } from "next/server"
import { DEFAULT_WORKSPACE_ID, getCorridorDb } from "@/core/db/database"
import { authorizeCorridorRequest } from "@/core/security/authorization"
import { initCorridorOrchestrator } from "@/runtime/orchestrator"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request, context: { params: Promise<{ caseId: string }> }) {
	const denied = await authorizeCorridorRequest(request, "controller")
	if (denied) return denied
	const { caseId } = await context.params
	const settlementCase = getCorridorDb().retryDeadLetterCase(caseId, DEFAULT_WORKSPACE_ID)
	if (!settlementCase) {
		return NextResponse.json({ ok: false, error: "Dead letter case not found or already replayed." }, { status: 404 })
	}
	void initCorridorOrchestrator().runCase(settlementCase).catch((error) => {
		console.error(`[CaseQueue] Operator replay failed for ${caseId}:`, error)
	})
	return NextResponse.json({ ok: true, caseId, status: "queued" }, { status: 202 })
}
