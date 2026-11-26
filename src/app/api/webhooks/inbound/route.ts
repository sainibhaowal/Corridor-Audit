import { NextResponse } from "next/server"
import { DEFAULT_WORKSPACE_ID, getCorridorDb } from "@/core/db/database"
import { normalizeInboundPayloadToCases } from "@/core/ingest/normalize-upload"
import { verifyInboundWebhookRequest } from "@/core/security/webhook-signatures"
import { initCorridorOrchestrator } from "@/runtime/orchestrator"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
	const db = getCorridorDb()
	let ingestionId: string | undefined

	try {
		const raw = await request.text()
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

		const rec = db.saveRawIngestion({
			workspaceId: DEFAULT_WORKSPACE_ID,
			sourceChannel: "webhook",
			sourceProvider: sigCheck.scheme === "none" ? "http_webhook" : sigCheck.scheme,
			filename: `webhook-${Date.now()}.json`,
			format: "auto",
			rawContent: raw,
			metadata: {
				verifiedScheme: sigCheck.scheme,
				contentType: request.headers.get("content-type") || "application/json",
			},
		})
		ingestionId = rec.id

		const orchestrator = initCorridorOrchestrator()
		const cases = normalizeInboundPayloadToCases({ content: raw, format: "auto" })
		db.updateRawIngestionOutcome({
			id: rec.id,
			parseStatus: "parsed",
			caseIds: cases.map((c) => c.caseId),
		})

		void orchestrator.enqueueBatch(cases)

		return NextResponse.json(
			{
				ok: true,
				ingestionId: rec.id,
				verifiedScheme: sigCheck.scheme,
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
