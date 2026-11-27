import { NextResponse } from "next/server"
import { getCorridorDb } from "@/core/db/database"
import { authorizeCorridorRequest, authorizedRequestWorkspaceId } from "@/core/security/authorization"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
	request: Request,
	context: { params: Promise<{ id: string }> },
) {
	const denied = await authorizeCorridorRequest(request, "viewer", { workspaceScoped: true })
	if (denied) return denied
	const workspaceId = authorizedRequestWorkspaceId(request)
	const { id } = await context.params
	const url = new URL(request.url)
	const download = url.searchParams.get("download") === "1"

	const db = getCorridorDb()
	const ingestion = db.getRawIngestion(id, true, workspaceId)
	if (!ingestion) {
		return NextResponse.json({ ok: false, error: `Raw ingestion "${id}" not found.` }, { status: 404 })
	}

	if (download) {
		const raw = ingestion.rawContent || ""
		const body = ingestion.isBase64 ? Buffer.from(raw, "base64") : Buffer.from(raw, "utf8")
		const safeName = ingestion.filename.replace(/[^a-zA-Z0-9._-]/g, "_")
		return new NextResponse(body, {
			status: 200,
			headers: {
				"Content-Type": ingestion.isBase64 ? "application/octet-stream" : "text/plain; charset=utf-8",
				"Content-Disposition": `attachment; filename="${safeName}"`,
			},
		})
	}

	return NextResponse.json({ ok: true, ingestion })
}
