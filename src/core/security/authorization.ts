import { createHash } from "node:crypto"
import { NextResponse } from "next/server"
import { DEFAULT_WORKSPACE_ID, getCorridorDb } from "../db/database"
import { authEnabled, requestCorridorSession, type CorridorRole } from "./auth"

const authorizedWorkspaceByRequest = new WeakMap<Request, string>()

export function authorizedRequestWorkspaceId(request: Request): string {
	const workspaceId = authorizedWorkspaceByRequest.get(request)
	if (!workspaceId) throw new Error("Workspace context is unavailable before request authorization.")
	return workspaceId
}

export async function isCurrentCorridorViewerSession(request: Request): Promise<boolean> {
	if (!authEnabled()) return true
	try {
		const session = await requestCorridorSession(request)
		if (!session) return false
		const db = getCorridorDb()
		const member = db.getTeamMemberByIdentitySub(session.workspaceId, session.sub)
		return Boolean(member && member.role === session.role && db.isAuthSessionActive(session.sessionId, session.sub))
	} catch {
		return false
	}
}

export async function authorizeCorridorRequest(
	request: Request,
	minimumRole: CorridorRole = "viewer",
	options: { workspaceScoped?: boolean } = {},
): Promise<NextResponse | null> {
	const isMutation = request.method !== "GET" && request.method !== "HEAD" && request.method !== "OPTIONS"
	if (isMutation) {
		const origin = request.headers.get("origin")
		const fetchSite = request.headers.get("sec-fetch-site")
		const requestOrigin = new URL(request.url).origin
		if ((origin && origin !== requestOrigin) || fetchSite === "cross-site") {
			return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 })
		}
	}
	if (!authEnabled()) {
		authorizedWorkspaceByRequest.set(request, DEFAULT_WORKSPACE_ID)
		return null
	}
	let session
	try {
		session = await requestCorridorSession(request)
	} catch {
		return NextResponse.json({ error: "Session expired or invalid. Sign in again." }, { status: 401 })
	}
	if (!session) return NextResponse.json({ error: "Authentication required." }, { status: 401 })

	const db = getCorridorDb()
	const member = db.getTeamMemberByIdentitySub(session.workspaceId, session.sub)
	if (!member || member.role !== session.role || !db.isAuthSessionActive(session.sessionId, session.sub)) {
		return NextResponse.json({ error: "Workspace membership changed. Sign in again." }, { status: 401 })
	}
	if (session.workspaceId !== DEFAULT_WORKSPACE_ID && !options.workspaceScoped) {
		return NextResponse.json({ error: "This API route is not yet enabled for the selected workspace." }, { status: 503 })
	}
	const rank: Record<CorridorRole, number> = { viewer: 0, analyst: 1, controller: 2, owner: 3 }
	if (rank[session.role] < rank[minimumRole]) {
		return NextResponse.json({ error: "This workspace role cannot perform that action." }, { status: 403 })
	}
	authorizedWorkspaceByRequest.set(request, session.workspaceId)

	const pathname = new URL(request.url).pathname
	const bucketClass = pathname === "/api/audit/upload"
		? "upload"
		: pathname.endsWith("/sync")
			? "provider_sync"
			: request.method === "GET" || request.method === "HEAD"
				? "read"
				: "mutation"
	const limit = bucketClass === "upload" ? 10 : bucketClass === "provider_sync" ? 6 : bucketClass === "read" ? 120 : 30
	const subjectKey = createHash("sha256").update(`${session.workspaceId}:${session.sub}:${bucketClass}`).digest("hex")
	try {
		const rate = db.consumeApiRateLimit({ bucketKey: subjectKey, limit, windowMs: 60_000 })
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
