import { NextResponse } from "next/server"
import { DEFAULT_WORKSPACE_ID, getCorridorDb } from "@/core/db/database"
import { parseInboundEmailToCases, type InboundEmailPayload } from "@/core/integrations/email-parser"
import { verifyInboundWebhookRequest } from "@/core/security/webhook-signatures"
import { initCorridorOrchestrator } from "@/runtime/orchestrator"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
	try {
		const raw = await request.text()
		const db = getCorridorDb()
		const workspace = db.getWorkspace(DEFAULT_WORKSPACE_ID)
		const corridorSecret = db.getRawWebhookSecret(DEFAULT_WORKSPACE_ID)

		const sigCheck = verifyInboundWebhookRequest({
			rawBody: raw,
			headers: request.headers,
			secrets: { corridor: corridorSecret },
			requireSignature: workspace.requireWebhookSignature,
		})
		if (!sigCheck.valid) {
			return NextResponse.json(
				{ ok: false, error: sigCheck.reason || "Email webhook signature verification failed." },
				{ status: 401 },
			)
		}

		const payload = JSON.parse(raw) as InboundEmailPayload
		const cases = parseInboundEmailToCases(payload)
		const orchestrator = initCorridorOrchestrator()
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
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			{ status: 400 },
		)
	}
}
