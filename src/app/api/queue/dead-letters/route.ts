import { NextResponse } from "next/server"
import { DEFAULT_WORKSPACE_ID, getCorridorDb } from "@/core/db/database"
import { authorizeCorridorRequest } from "@/core/security/authorization"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
	const denied = await authorizeCorridorRequest(request, "controller")
	if (denied) return denied
	const url = new URL(request.url)
	const requestedLimit = Number(url.searchParams.get("limit") || "100")
	if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 500) {
		return NextResponse.json({ ok: false, error: "limit must be an integer from 1 to 500." }, { status: 400 })
	}
	const deadLetters = getCorridorDb().listDeadLetterCases(DEFAULT_WORKSPACE_ID, requestedLimit)
	return NextResponse.json({ ok: true, count: deadLetters.length, deadLetters })
}
