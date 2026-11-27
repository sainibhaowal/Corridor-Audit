import { NextResponse } from "next/server"
import { DEFAULT_WORKSPACE_ID, getCorridorDb } from "@/core/db/database"
import { authorizeCorridorRequest } from "@/core/security/authorization"
import { authEnabled, requestCorridorSession } from "@/core/security/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(
	request: Request,
	context: { params: Promise<{ provider: string }> },
) {
	const denied = await authorizeCorridorRequest(request, "controller")
	if (denied) return denied
	const { provider } = await context.params
	const db = getCorridorDb()
	const session = authEnabled() ? await requestCorridorSession(request) : null
	db.transaction(() => {
		const disconnected = db.disconnectIntegration(DEFAULT_WORKSPACE_ID, provider)
		if (disconnected) db.appendWorkspaceAuditEvent({ workspaceId: DEFAULT_WORKSPACE_ID, actorType: session ? "user" : "local", actorId: session?.sub, actorEmail: session?.email, actorRole: session?.role, action: "integration.disconnect", targetType: "integration", targetId: provider, requestId: request.headers.get("x-request-id") || undefined })
	})
	return NextResponse.json({ ok: true, provider, status: "disconnected" })
}
