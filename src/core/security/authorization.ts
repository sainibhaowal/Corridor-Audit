import { NextResponse } from "next/server"
import { DEFAULT_WORKSPACE_ID, getCorridorDb } from "../db/database"
import { authEnabled, requestCorridorSession, type CorridorRole } from "./auth"

export async function authorizeCorridorRequest(
	request: Request,
	minimumRole: CorridorRole = "viewer",
): Promise<NextResponse | null> {
	if (!authEnabled()) return null
	let session
	try {
		session = await requestCorridorSession(request)
	} catch {
		return NextResponse.json({ error: "Session expired or invalid. Sign in again." }, { status: 401 })
	}
	if (!session) return NextResponse.json({ error: "Authentication required." }, { status: 401 })

	const member = getCorridorDb()
		.listTeamMembers(DEFAULT_WORKSPACE_ID)
		.find((row) => row.email === session.email && row.status === "active")
	if (!member || member.role !== session.role) {
		return NextResponse.json({ error: "Workspace membership changed. Sign in again." }, { status: 401 })
	}
	const origin = request.headers.get("origin")
	const requestOrigin = new URL(request.url).origin
	if (request.method !== "GET" && request.method !== "HEAD" && origin && origin !== requestOrigin) {
		return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 })
	}
	const rank: Record<CorridorRole, number> = { viewer: 0, analyst: 1, controller: 2, owner: 3 }
	if (rank[session.role] < rank[minimumRole]) {
		return NextResponse.json({ error: "This workspace role cannot perform that action." }, { status: 403 })
	}
	return null
}
