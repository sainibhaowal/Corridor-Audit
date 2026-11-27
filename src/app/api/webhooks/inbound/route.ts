import { NextResponse } from "next/server"
import { DEFAULT_WORKSPACE_ID, getCorridorDb } from "@/core/db/database"
import { normalizeInboundPayloadToCases } from "@/core/ingest/normalize-upload"
import { verifyInboundWebhookRequest } from "@/core/security/webhook-signatures"
import { readRequestTextLimited, RequestBodyTooLargeError } from "@/core/security/request-body"
import { initCorridorOrchestrator } from "@/runtime/orchestrator"
import { deriveWebhookEventId } from "@/core/security/webhook-event-id"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024

export async function POST(request: Request) {
	const db = getCorridorDb()
	let ingestionId: string | undefined
	let receiptIdentity: { provider: string; eventId: string } | undefined

	try {
		const raw = await readRequestTextLimited(request, MAX_WEBHOOK_BODY_BYTES)
		const workspace = db.getWorkspace(DEFAULT_WORKSPACE_ID)
		const corridorSecret = db.getRawWebhookSecret(DEFAULT_WORKSPACE_ID)
		const stripeSecret = db.getDecryptedCredentials(DEFAULT_WORKSPACE_ID, "stripe")?.webhookSecret

		const sigCheck = verifyInboundWebhookRequest({
			rawBody: raw,
			headers: request.headers,
			secrets: {
				corridor: corridorSecret,
				stripe: stripeSecret,
			},
			requireSignature: workspace.requireWebhookSignature || process.env.NODE_ENV === "production",
			requireTimestampedCorridorSignature: process.env.NODE_ENV === "production",
		})

		if (!sigCheck.valid) {
			return NextResponse.json(
				{ ok: false, error: sigCheck.reason || "Webhook signature verification failed." },
				{ status: 401 },
			)
		}

		const provider = sigCheck.scheme === "none" ? "http_webhook" : sigCheck.scheme
		const eventIdentity = deriveWebhookEventId(raw, provider)
		const identity = { provider, eventId: eventIdentity.eventId }
		receiptIdentity = identity
		const receipt = db.recordWebhookReceipt({
			workspaceId: DEFAULT_WORKSPACE_ID,
			...identity,
			sourceChannel: "webhook",
			filename: `webhook-${eventIdentity.eventId.slice(-40)}.json`,
			format: "auto",
			rawContent: raw,
			metadata: {
				verifiedScheme: sigCheck.scheme,
				eventIdSource: eventIdentity.source,
				contentType: request.headers.get("content-type") || "application/json",
			},
		})
		if (receipt.conflict) {
			return NextResponse.json({ ok: false, error: "Webhook event ID was already received with a different payload." }, { status: 409 })
		}
		if (receipt.duplicate && receipt.status === "queued") {
			return NextResponse.json({ ok: true, duplicate: true, ingestionId: receipt.ingestion.id, eventId: eventIdentity.eventId }, { status: 200 })
		}
		const rec = receipt.ingestion
		ingestionId = rec.id

		let cases: ReturnType<typeof normalizeInboundPayloadToCases>
		try {
			cases = normalizeInboundPayloadToCases({ content: raw, format: "auto" })
		} catch (error) {
			const message = error instanceof Error ? error.message : "Webhook payload could not be parsed."
			db.updateRawIngestionOutcome({ id: rec.id, parseStatus: "failed", parseError: message })
			db.markWebhookReceiptStatus({ ...identity, status: "failed" })
			return NextResponse.json({ ok: false, error: message, ingestionId: rec.id }, { status: 422 })
		}
		if (cases.length === 0) {
			const message = "Webhook payload was stored, but it contained no supported settlement cases."
			db.updateRawIngestionOutcome({ id: rec.id, parseStatus: "failed", parseError: message })
			db.markWebhookReceiptStatus({ ...identity, status: "failed" })
			return NextResponse.json({ ok: false, error: message, ingestionId: rec.id }, { status: 422 })
		}
		const orchestrator = initCorridorOrchestrator()
		db.updateRawIngestionOutcome({
			id: rec.id,
			parseStatus: "parsed",
			caseIds: cases.map((c) => c.caseId),
		})

		const execution = orchestrator.enqueueBatch(cases)
		db.markWebhookReceiptStatus({ ...identity, status: "queued" })
		db.appendWorkspaceAuditEvent({ workspaceId: DEFAULT_WORKSPACE_ID, actorType: "system", action: "webhook.accepted", targetType: "webhook_event", targetId: eventIdentity.eventId, requestId: request.headers.get("x-request-id") || undefined, metadata: { provider, verified: sigCheck.scheme !== "none", queuedCount: cases.length } })
		void execution.catch((err) => {
			db.markWebhookReceiptStatus({ ...identity, status: "failed" })
			console.error(`Webhook ingestion ${rec.id} failed during audit processing:`, err)
		})

		return NextResponse.json(
			{
				ok: true,
				ingestionId: rec.id,
				eventId: eventIdentity.eventId,
				duplicate: receipt.duplicate,
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
		if (receiptIdentity) db.markWebhookReceiptStatus({ ...receiptIdentity, status: "failed" })
		return NextResponse.json({ error: msg, ingestionId }, { status: err instanceof RequestBodyTooLargeError ? 413 : 400 })
	}
}
