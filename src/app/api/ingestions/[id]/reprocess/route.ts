import { NextResponse } from "next/server"
import { getCorridorDb } from "@/core/db/database"
import { normalizeInboundPayloadToCases } from "@/core/ingest/normalize-upload"
import { parseInboundEmailToCases, type InboundEmailPayload } from "@/core/integrations/email-parser"
import { initCorridorOrchestrator } from "@/runtime/orchestrator"
import { authorizeCorridorRequest } from "@/core/security/authorization"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(
	request: Request,
	context: { params: Promise<{ id: string }> },
) {
	const denied = await authorizeCorridorRequest(request, "analyst")
	if (denied) return denied
	const { id } = await context.params
	const db = getCorridorDb()
	const ingestion = db.getRawIngestion(id, true)
	if (!ingestion) {
		return NextResponse.json({ ok: false, error: `Raw ingestion "${id}" not found.` }, { status: 404 })
	}

	try {
		const raw = ingestion.rawContent || ""
		const cases =
			ingestion.sourceChannel === "email"
				? parseInboundEmailToCases(JSON.parse(raw) as InboundEmailPayload)
				: normalizeInboundPayloadToCases({
						filename: ingestion.filename,
						base64: ingestion.isBase64 ? raw : undefined,
						content: ingestion.isBase64 ? undefined : raw,
						format: "auto",
					})

		db.updateRawIngestionOutcome({
			id: ingestion.id,
			parseStatus: "parsed",
			caseIds: cases.map((c) => c.caseId),
		})

		const orchestrator = initCorridorOrchestrator()
		void orchestrator.enqueueBatch(cases).catch((err) => {
			console.error(`Reprocessed ingestion ${id} failed during audit processing:`, err)
		})

		return NextResponse.json(
			{
				ok: true,
				ingestionId: ingestion.id,
				queuedCount: cases.length,
				caseIds: cases.map((c) => c.caseId),
			},
			{ status: 202 },
		)
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		db.updateRawIngestionOutcome({
			id: ingestion.id,
			parseStatus: "failed",
			parseError: msg,
		})
		return NextResponse.json({ ok: false, error: msg }, { status: 400 })
	}
}
