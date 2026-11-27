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
			approvalId?: string
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
		const db = getCorridorDb()
		const orchestrator = initCorridorOrchestrator()
		const pending = orchestrator.state.pendingApprovals.get(caseId)
		if (pending && body.approvalId && pending.approvalId !== body.approvalId) {
			return NextResponse.json({ error: "The requested approval is no longer the active review for this case." }, { status: 409 })
		}
		const approvalId = db.resolvePendingApproval({
			workspaceId: DEFAULT_WORKSPACE_ID,
			caseId,
			approvalId: body.approvalId,
			decision: body.decision,
			reason: body.reason,
			reviewerSub: actor.sub,
			reviewerEmail: actor.email,
			reviewerRole: actor.role,
			requireIndependentReviewer: Boolean(session),
		})
		if (approvalId.status === "same_reviewer") {
			return NextResponse.json({ error: "A different authenticated team member must approve a case they did not submit." }, { status: 403 })
		}
		if (approvalId.status === "expired") {
			return NextResponse.json({ error: "This review request expired. Re-run the audit to create a current approval." }, { status: 410 })
		}
		if (approvalId.status === "stale") {
			return NextResponse.json({ error: "Case evidence changed after this approval was requested. Re-run the audit for a current review." }, { status: 409 })
		}
		if (approvalId.status === "not_found") {
			return NextResponse.json({ error: `No pending durable breakpoint for ${caseId}` }, { status: 404 })
		}
		if (pending) pending.resolve({ decision: body.decision, reason: body.reason })
		const replay = !pending ? db.retryDeadLetterCase(caseId, DEFAULT_WORKSPACE_ID) : null
		if (replay) {
			void orchestrator.runCase(replay).catch((error) => {
				console.error(`[CaseQueue] Review decision replay failed for ${caseId}:`, error)
			})
		}
		return NextResponse.json({ ok: true, caseId, approvalId: approvalId.approvalId, decision: body.decision, resumedInProcess: Boolean(pending), replayedDeadLetter: Boolean(replay) }, {
			status: pending ? 200 : 202,
		})
	} catch (err) {
		return NextResponse.json(
			{ error: err instanceof Error ? err.message : String(err) },
			{ status: 400 },
		)
	}
}
