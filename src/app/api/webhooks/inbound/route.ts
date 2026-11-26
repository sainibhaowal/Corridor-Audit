import { NextResponse } from "next/server"
import { DEFAULT_WORKSPACE_ID, getCorridorDb } from "@/core/db/database"
import { normalizeInboundPayloadToCases } from "@/core/ingest/normalize-upload"
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
		const stripeSecret = db.getDecryptedCredentials(DEFAULT_WORKSPACE_ID, "stripe")?.webhookSecret
		const wiseSecret = db.getDecryptedCredentials(DEFAULT_WORKSPACE_ID, "wise")?.webhookSecret

		const sigCheck = verifyInboundWebhookRequest({
			rawBody: raw,
			headers: request.headers,
			secrets: {
				corridor: corridorSecret,
				stripe: stripeSecret,
				wise: wiseSecret,
			},
			requireSignature: workspace.requireWebhookSignature,
		})

		if (!sigCheck.valid) {
			return NextResponse.json(
				{ ok: false, error: sigCheck.reason || "Webhook signature verification failed." },
				{ status: 401 },
			)
		}

		const orchestrator = initCorridorOrchestrator()
		const cases = normalizeInboundPayloadToCases({ content: raw, format: "auto" })
		void orchestrator.enqueueBatch(cases)

		return NextResponse.json(
			{
				ok: true,
				verifiedScheme: sigCheck.scheme,
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
