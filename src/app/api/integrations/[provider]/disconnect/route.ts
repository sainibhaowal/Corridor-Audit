import { NextResponse } from "next/server"
import { DEFAULT_WORKSPACE_ID, getCorridorDb } from "@/core/db/database"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(
	_request: Request,
	context: { params: Promise<{ provider: string }> },
) {
	const { provider } = await context.params
	const db = getCorridorDb()
	db.disconnectIntegration(DEFAULT_WORKSPACE_ID, provider)
	return NextResponse.json({ ok: true, provider, status: "disconnected" })
}
