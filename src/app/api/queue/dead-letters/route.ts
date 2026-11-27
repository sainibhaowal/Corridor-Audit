import { NextResponse } from "next/server"
import { getCorridorDb } from "@/core/db/database"
import { authorizeCorridorRequest, authorizedRequestWorkspaceId } from "@/core/security/authorization"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
	const denied = await authorizeCorridorRequest(request, "controller", { workspaceScoped: true })
	if (denied) return denied
	const workspaceId = authorizedRequestWorkspaceId(request)
	const url = new URL(request.url)
	const requestedLimit = Number(url.searchParams.get("limit") || "100")
	if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 500) {
		return NextResponse.json({ ok: false, error: "limit must be an integer from 1 to 500." }, { status: 400 })
	}
	const deadLetters = getCorridorDb().listDeadLetterCases(workspaceId, requestedLimit)
	return NextResponse.json({ ok: true, count: deadLetters.length, deadLetters })
}
