import { NextResponse } from "next/server"
import { DEFAULT_WORKSPACE_ID, getCorridorDb } from "@/core/db/database"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
	const url = new URL(request.url)
	const channel = url.searchParams.get("channel") || "all"
	const limit = Number(url.searchParams.get("limit") || "100") || 100

	const db = getCorridorDb()
	const stats = db.getRawIngestionStats(DEFAULT_WORKSPACE_ID)
	const ingestions = db.listRawIngestions({
		workspaceId: DEFAULT_WORKSPACE_ID,
		channel,
		limit,
	})

	return NextResponse.json({
		ok: true,
		stats,
		ingestions,
	})
}
