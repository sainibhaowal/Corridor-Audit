import { NextResponse } from "next/server"
import { DEFAULT_WORKSPACE_ID, getCorridorDb } from "@/core/db/database"
import { normalizeInboundPayloadToCases } from "@/core/ingest/normalize-upload"
import { verifyInboundWebhookRequest } from "@/core/security/webhook-signatures"
import { readRequestTextLimited, RequestBodyTooLargeError } from "@/core/security/request-body"
import { initCorridorOrchestrator } from "@/runtime/orchestrator"
import { deriveWebhookEventId } from "@/core/security/webhook-event-id"
import { randomUUID } from "node:crypto"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024

export async function POST(request: Request) {
	const db = getCorridorDb()
	let ingestionId: string | undefined
	let receiptIdentity: { provider: string; eventId: string } | undefined
	let receiptOwnerId: string | undefined
	let leaseHeartbeat: NodeJS.Timeout | undefined

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
		receiptOwnerId = randomUUID()
		const claimed = db.claimWebhookReceipt({ ...identity, ownerId: receiptOwnerId })
		if (!claimed) {
			return NextResponse.json({ ok: true, duplicate: true, processing: true, ingestionId: receipt.ingestion.id, eventId: eventIdentity.eventId }, { status: 202 })
		}
		leaseHeartbeat = setInterval(() => {
			try { db.renewWebhookReceiptLease({ ...identity, ownerId: receiptOwnerId! }) } catch { /* Lease expiry permits safe redelivery recovery. */ }
		}, 15_000)
		const rec = receipt.ingestion
		ingestionId = rec.id

		let cases: ReturnType<typeof normalizeInboundPayloadToCases>
		try {
			cases = normalizeInboundPayloadToCases({ content: raw, format: "auto" })
		} catch (error) {
			const message = error instanceof Error ? error.message : "Webhook payload could not be parsed."
			db.failWebhookReceipt({ ...identity, ownerId: receiptOwnerId!, ingestionId: rec.id, parseError: message })
			return NextResponse.json({ ok: false, error: message, ingestionId: rec.id }, { status: 422 })
		}
		if (cases.length === 0) {
			const message = "Webhook payload was stored, but it contained no supported settlement cases."
			db.failWebhookReceipt({ ...identity, ownerId: receiptOwnerId!, ingestionId: rec.id, parseError: message })
			return NextResponse.json({ ok: false, error: message, ingestionId: rec.id }, { status: 422 })
		}
		const orchestrator = initCorridorOrchestrator()
		db.transaction(() => {
			for (const settlementCase of cases) db.saveCase(settlementCase, DEFAULT_WORKSPACE_ID)
			db.updateRawIngestionOutcome({
				id: rec.id,
				parseStatus: "parsed",
				caseIds: cases.map((c) => c.caseId),
			})
			if (!db.markWebhookReceiptStatus({ ...identity, ownerId: receiptOwnerId!, status: "queued" })) {
				throw new Error("Webhook processing lease expired before the event could be queued.")
			}
		})

		const execution = orchestrator.enqueueBatch(cases)
		void execution.catch((err) => {
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
		if (receiptIdentity && receiptOwnerId && ingestionId) {
			db.failWebhookReceipt({ ...receiptIdentity, ownerId: receiptOwnerId, ingestionId, parseError: msg })
		}
		return NextResponse.json({ error: msg, ingestionId }, { status: err instanceof RequestBodyTooLargeError ? 413 : 400 })
	} finally {
		if (leaseHeartbeat) clearInterval(leaseHeartbeat)
	}
}
