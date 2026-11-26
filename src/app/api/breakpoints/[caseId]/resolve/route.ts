import { NextResponse } from "next/server"
import { initCorridorOrchestrator } from "@/runtime/orchestrator"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(
	request: Request,
	context: { params: Promise<{ caseId: string }> },
) {
	try {
		const { caseId: rawId } = await context.params
		const caseId = decodeURIComponent(rawId)
		const body = (await request.json()) as {
			decision: "approve" | "reject" | "stop"
			reason?: string
		}
		const orchestrator = initCorridorOrchestrator()
		const pending = orchestrator.state.pendingApprovals.get(caseId)
		if (!pending) {
			return NextResponse.json(
				{ error: `No paused breakpoint active for ${caseId}` },
				{ status: 404 },
			)
		}
		pending.resolve({ decision: body.decision, reason: body.reason })
		return NextResponse.json({ ok: true, caseId, decision: body.decision })
	} catch (err) {
		return NextResponse.json(
			{ error: err instanceof Error ? err.message : String(err) },
			{ status: 400 },
		)
	}
}
