import { createHash } from "node:crypto"
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

	const member = getCorridorDb().getTeamMemberByIdentitySub(DEFAULT_WORKSPACE_ID, session.sub)
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

	const pathname = new URL(request.url).pathname
	const bucketClass = pathname === "/api/audit/upload"
		? "upload"
		: pathname.endsWith("/sync")
			? "provider_sync"
			: request.method === "GET" || request.method === "HEAD"
				? "read"
				: "mutation"
	const limit = bucketClass === "upload" ? 10 : bucketClass === "provider_sync" ? 6 : bucketClass === "read" ? 120 : 30
	const subjectKey = createHash("sha256").update(`${DEFAULT_WORKSPACE_ID}:${session.sub}:${bucketClass}`).digest("hex")
	try {
		const rate = getCorridorDb().consumeApiRateLimit({ bucketKey: subjectKey, limit, windowMs: 60_000 })
		if (!rate.allowed) {
			return NextResponse.json(
				{ error: "Request limit reached. Wait before trying again." },
				{ status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds), "X-RateLimit-Limit": String(limit), "X-RateLimit-Remaining": "0" } },
			)
		}
	} catch {
		return NextResponse.json({ error: "Request protection is temporarily unavailable." }, { status: 503 })
	}
	return null
}
