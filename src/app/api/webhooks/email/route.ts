import { NextResponse } from "next/server"
import { DEFAULT_WORKSPACE_ID, getCorridorDb } from "@/core/db/database"
import { parseInboundEmailToCases, type InboundEmailPayload } from "@/core/integrations/email-parser"
import { verifyInboundWebhookRequest } from "@/core/security/webhook-signatures"
import { readRequestTextLimited, RequestBodyTooLargeError } from "@/core/security/request-body"
import { initCorridorOrchestrator } from "@/runtime/orchestrator"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const MAX_EMAIL_WEBHOOK_BODY_BYTES = 10 * 1024 * 1024

export async function POST(request: Request) {
	const db = getCorridorDb()
	let ingestionId: string | undefined

	try {
		const raw = await readRequestTextLimited(request, MAX_EMAIL_WEBHOOK_BODY_BYTES)
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
		const sender = payload.from || payload.From || "unknown-sender"
		const subject = payload.subject || payload.Subject || "Inbound Email"
		const rec = db.saveRawIngestion({
			workspaceId: DEFAULT_WORKSPACE_ID,
			sourceChannel: "email",
			sourceProvider: "email_inbound",
			filename: `${subject.slice(0, 48)}.eml.json`,
			format: "json",
			rawContent: raw,
			metadata: { from: sender, subject },
		})
		ingestionId = rec.id

		const cases = parseInboundEmailToCases(payload)
		db.updateRawIngestionOutcome({
			id: rec.id,
			parseStatus: "parsed",
			caseIds: cases.map((c) => c.caseId),
		})

		const orchestrator = initCorridorOrchestrator()
		void orchestrator.enqueueBatch(cases)

		return NextResponse.json(
			{
				ok: true,
				ingestionId: rec.id,
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
		return NextResponse.json({ ok: false, error: msg, ingestionId }, { status: err instanceof RequestBodyTooLargeError ? 413 : 400 })
	}
}
