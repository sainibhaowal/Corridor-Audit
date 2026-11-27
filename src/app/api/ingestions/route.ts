import { NextResponse } from "next/server"
import { getCorridorDb } from "@/core/db/database"
import { authorizeCorridorRequest, authorizedRequestWorkspaceId } from "@/core/security/authorization"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
	const denied = await authorizeCorridorRequest(request, "viewer", { workspaceScoped: true })
	if (denied) return denied
	const workspaceId = authorizedRequestWorkspaceId(request)
	const url = new URL(request.url)
	const channel = url.searchParams.get("channel") || "all"
	const limit = Number(url.searchParams.get("limit") || "100") || 100

	const db = getCorridorDb()
	const stats = db.getRawIngestionStats(workspaceId)
	const ingestions = db.listRawIngestions({
		workspaceId,
		channel,
		limit,
	})

	return NextResponse.json({
		ok: true,
		stats,
		ingestions,
	})
}
