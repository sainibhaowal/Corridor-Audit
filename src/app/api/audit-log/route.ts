import { NextResponse } from "next/server"
import { DEFAULT_WORKSPACE_ID, getCorridorDb } from "@/core/db/database"
import { authEnabled, requestCorridorSession } from "@/core/security/auth"
import { authorizeCorridorRequest } from "@/core/security/authorization"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
	const denied = await authorizeCorridorRequest(request, "viewer")
	if (denied) return denied
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
		events: db.listWorkspaceAuditEvents(DEFAULT_WORKSPACE_ID, requestedLimit),
		chain: db.verifyWorkspaceAuditChain(DEFAULT_WORKSPACE_ID),
	})
}
