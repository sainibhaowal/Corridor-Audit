import { NextResponse } from "next/server"
import { normalizeInboundPayloadToCases, type UploadPayload } from "@/core/ingest/normalize-upload"
import { initCorridorOrchestrator } from "@/runtime/orchestrator"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
	try {
		const body = (await request.json()) as UploadPayload
		const orchestrator = initCorridorOrchestrator()
		const cases = normalizeInboundPayloadToCases(body)
		void orchestrator.enqueueBatch(cases)
		return NextResponse.json(
			{
				ok: true,
				queuedCount: cases.length,
				caseIds: cases.map((c) => c.caseId),
			},
			{ status: 202 },
		)
	} catch (err) {
		return NextResponse.json(
			{ error: err instanceof Error ? err.message : String(err) },
			{ status: 400 },
		)
	}
}
