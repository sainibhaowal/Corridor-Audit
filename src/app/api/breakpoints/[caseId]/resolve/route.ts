import { NextResponse } from "next/server"
import { initCorridorOrchestrator } from "@/runtime/orchestrator"
import { authorizeCorridorRequest } from "@/core/security/authorization"
import { authEnabled, requestCorridorSession } from "@/core/security/auth"
import { DEFAULT_WORKSPACE_ID, getCorridorDb } from "@/core/db/database"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(
	request: Request,
	context: { params: Promise<{ caseId: string }> },
) {
	const denied = await authorizeCorridorRequest(request, "controller")
	if (denied) return denied
	try {
		const { caseId: rawId } = await context.params
		const caseId = decodeURIComponent(rawId)
		const body = (await request.json()) as {
			decision: "approve" | "reject" | "stop"
			reason?: string
		}
		if (!(body.decision === "approve" || body.decision === "reject" || body.decision === "stop")) {
			return NextResponse.json({ error: "Decision must be approve, reject, or stop." }, { status: 400 })
		}
		const session = authEnabled() ? await requestCorridorSession(request) : null
		const actor = session
			? { sub: session.sub, email: session.email, role: session.role }
			: { sub: "local-operator", email: "local-operator", role: "owner" }
		const approvalId = getCorridorDb().resolvePendingApproval({
			workspaceId: DEFAULT_WORKSPACE_ID,
			caseId,
			decision: body.decision,
			reason: body.reason,
			reviewerSub: actor.sub,
			reviewerEmail: actor.email,
			reviewerRole: actor.role,
		})
		if (!approvalId) {
			return NextResponse.json({ error: `No pending durable breakpoint for ${caseId}` }, { status: 404 })
		}
		const orchestrator = initCorridorOrchestrator()
		const pending = orchestrator.state.pendingApprovals.get(caseId)
		if (pending) pending.resolve({ decision: body.decision, reason: body.reason })
		return NextResponse.json({ ok: true, caseId, approvalId, decision: body.decision, resumedInProcess: Boolean(pending) }, {
			status: pending ? 200 : 202,
		})
	} catch (err) {
		return NextResponse.json(
			{ error: err instanceof Error ? err.message : String(err) },
			{ status: 400 },
		)
	}
}
