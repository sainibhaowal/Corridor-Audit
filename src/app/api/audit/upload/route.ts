import { NextResponse } from "next/server"
import { DEFAULT_WORKSPACE_ID, getCorridorDb } from "@/core/db/database"
import { normalizeInboundPayloadToCases, type UploadPayload } from "@/core/ingest/normalize-upload"
import { initCorridorOrchestrator } from "@/runtime/orchestrator"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
	const db = getCorridorDb()
	let ingestionId: string | undefined

	try {
		const body = (await request.json()) as UploadPayload
		const isBase64 = Boolean(body.base64 && !body.content)
		const rawContent = body.content || body.base64 || ""
		const filename = body.filename || (body.format ? `upload.${body.format}` : "manual-paste.txt")
		const format = body.format || "auto"

		if (rawContent) {
			const rec = db.saveRawIngestion({
				workspaceId: DEFAULT_WORKSPACE_ID,
				sourceChannel: "manual_upload",
				sourceProvider: "browser_upload",
				filename,
				format,
				rawContent,
				isBase64,
				metadata: { filename, format },
			})
			ingestionId = rec.id
		}

		const orchestrator = initCorridorOrchestrator()
		const cases = normalizeInboundPayloadToCases(body)
		if (ingestionId) {
			db.updateRawIngestionOutcome({
				id: ingestionId,
				parseStatus: "parsed",
				caseIds: cases.map((c) => c.caseId),
			})
		}

		void orchestrator.enqueueBatch(cases)
		return NextResponse.json(
			{
				ok: true,
				ingestionId,
				queuedCount: cases.length,
				caseIds: cases.map((c) => c.caseId),
			},
			{ status: 202 },
		)
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		if (ingestionId) {
			db.updateRawIngestionOutcome({
				id: ingestionId,
				parseStatus: "failed",
				parseError: msg,
			})
		}
		return NextResponse.json({ error: msg, ingestionId }, { status: 400 })
	}
}
