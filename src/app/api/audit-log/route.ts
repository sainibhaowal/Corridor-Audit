import { NextResponse } from "next/server"
import { getCorridorDb } from "@/core/db/database"
import { authEnabled, requestCorridorSession } from "@/core/security/auth"
import { authorizeCorridorRequest, authorizedRequestWorkspaceId } from "@/core/security/authorization"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
	const denied = await authorizeCorridorRequest(request, "viewer", { workspaceScoped: true })
	if (denied) return denied
	const workspaceId = authorizedRequestWorkspaceId(request)
	const session = authEnabled() ? await requestCorridorSession(request) : null
	if (session && !["owner", "controller"].includes(session.role)) {
		return NextResponse.json({ ok: false, error: "Only workspace owners and controllers can inspect the audit log." }, { status: 403 })
	}
	const url = new URL(request.url)
	const requestedLimit = Number(url.searchParams.get("limit") || 100)
	if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 500) {
		return NextResponse.json({ ok: false, error: "Limit must be an integer from 1 to 500." }, { status: 400 })
	}
	const db = getCorridorDb()
	return NextResponse.json({
		ok: true,
		events: db.listWorkspaceAuditEvents(workspaceId, requestedLimit),
		chain: db.verifyWorkspaceAuditChain(workspaceId),
	})
}
