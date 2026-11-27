import { NextResponse } from "next/server"
import { DEFAULT_WORKSPACE_ID, getCorridorDb } from "@/core/db/database"
import { parseInboundEmailToCases, validateInboundEmailPayload, type InboundEmailPayload } from "@/core/integrations/email-parser"
import { verifyInboundWebhookRequest } from "@/core/security/webhook-signatures"
import { readRequestTextLimited, RequestBodyTooLargeError } from "@/core/security/request-body"
import { initCorridorOrchestrator } from "@/runtime/orchestrator"
import { deriveWebhookEventId } from "@/core/security/webhook-event-id"
import { MalwareDetectedError, MalwareScannerUnavailableError, MalwareScanLimitError, scanFileBytes } from "@/core/security/malware-scan"
import { randomUUID } from "node:crypto"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const MAX_EMAIL_WEBHOOK_BODY_BYTES = 10 * 1024 * 1024

export async function POST(request: Request) {
	const db = getCorridorDb()
	let ingestionId: string | undefined
	let receiptIdentity: { provider: string; eventId: string } | undefined
	let receiptOwnerId: string | undefined
	let leaseHeartbeat: NodeJS.Timeout | undefined

	try {
		const raw = await readRequestTextLimited(request, MAX_EMAIL_WEBHOOK_BODY_BYTES)
		const workspace = db.getWorkspace(DEFAULT_WORKSPACE_ID)
		const corridorSecret = db.getRawWebhookSecret(DEFAULT_WORKSPACE_ID)

		const sigCheck = verifyInboundWebhookRequest({
			rawBody: raw,
			headers: request.headers,
			secrets: { corridor: corridorSecret },
			requireSignature: workspace.requireWebhookSignature || process.env.NODE_ENV === "production",
			requireTimestampedCorridorSignature: process.env.NODE_ENV === "production",
		})
		if (!sigCheck.valid) {
			return NextResponse.json(
				{ ok: false, error: sigCheck.reason || "Email webhook signature verification failed." },
				{ status: 401 },
			)
		}

		const eventIdentity = deriveWebhookEventId(raw, "email_inbound", true)
		const identity = { provider: "email_inbound", eventId: eventIdentity.eventId }
		receiptIdentity = identity
		let payload: InboundEmailPayload | undefined
		let payloadValidationFailed = false
		try {
			const parsed: unknown = JSON.parse(raw)
			const validation = validateInboundEmailPayload(parsed)
			if (validation.success) payload = validation.data
			else payloadValidationFailed = true
		} catch {
			payloadValidationFailed = true
		}
		const sender = payload?.from || payload?.From || "unknown-sender"
		const subject = payload?.subject || payload?.Subject || "Inbound Email"
		let malwareScanStatus = "not_applicable"
		if (payload) {
			for (const attachment of payload.attachments || payload.Attachments || []) {
				const base64 = attachment.contentBase64 || attachment.Content
				const content = attachment.content
				if (!base64 && !content) continue
				const normalizedBase64 = base64?.replace(/\s/g, "")
				if (normalizedBase64 && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalizedBase64)) {
					throw new Error("Inbound email attachment has invalid base64 encoding.")
				}
				const scan = await scanFileBytes(normalizedBase64 ? Buffer.from(normalizedBase64, "base64") : Buffer.from(content!, "utf8"))
				malwareScanStatus = scan.status
			}
		} else {
			malwareScanStatus = "not_scanned_invalid_payload"
		}
		const receipt = db.recordWebhookReceipt({
			workspaceId: DEFAULT_WORKSPACE_ID,
			...identity,
			sourceChannel: "email",
			filename: `email-${eventIdentity.eventId.slice(-40)}.json`,
			format: "json",
			rawContent: raw,
			metadata: { from: sender, subject, eventIdSource: eventIdentity.source, malwareScan: malwareScanStatus },
		})
		if (receipt.conflict) {
			return NextResponse.json({ ok: false, error: "Email webhook event ID was already received with a different payload." }, { status: 409 })
		}
		if (receipt.duplicate && receipt.status === "queued") {
			return NextResponse.json({ ok: true, duplicate: true, ingestionId: receipt.ingestion.id, eventId: eventIdentity.eventId }, { status: 200 })
		}
		receiptOwnerId = randomUUID()
		const claimed = db.claimWebhookReceipt({ ...identity, ownerId: receiptOwnerId })
		if (!claimed) {
			return NextResponse.json(
				{ ok: false, retryable: true, error: "This email event is still being processed. Retry the delivery shortly.", ingestionId: receipt.ingestion.id, eventId: eventIdentity.eventId },
				{ status: 503, headers: { "Retry-After": "5" } },
			)
		}
		leaseHeartbeat = setInterval(() => {
			try { db.renewWebhookReceiptLease({ ...identity, ownerId: receiptOwnerId! }) } catch { /* Lease expiry permits safe redelivery recovery. */ }
		}, 15_000)
		const rec = receipt.ingestion
		ingestionId = rec.id
		if (!payload || payloadValidationFailed) {
			const message = payloadValidationFailed
				? "Email webhook JSON does not match the supported email payload structure. The signed raw payload was retained for inspection."
				: "Email webhook body is not valid JSON. The signed raw payload was retained for inspection."
			db.failWebhookReceipt({ ...identity, ownerId: receiptOwnerId!, ingestionId: rec.id, parseError: message })
			return NextResponse.json({ ok: false, error: message, ingestionId: rec.id }, { status: 422 })
		}

		let cases: ReturnType<typeof parseInboundEmailToCases>
		try {
			cases = parseInboundEmailToCases(payload)
		} catch (error) {
			const message = error instanceof Error ? error.message : "Email payload could not be parsed."
			db.failWebhookReceipt({ ...identity, ownerId: receiptOwnerId!, ingestionId: rec.id, parseError: message })
			return NextResponse.json({ ok: false, error: message, ingestionId: rec.id }, { status: 422 })
		}
		if (cases.length === 0) {
			const message = "Email payload was stored, but it contained no supported settlement cases."
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
				throw new Error("Email processing lease expired before the event could be queued.")
			}
		})
		const execution = orchestrator.enqueueBatch(cases)
		void execution.catch((err) => {
			console.error(`Email ingestion ${rec.id} failed during audit processing:`, err)
		})

		return NextResponse.json(
			{
				ok: true,
				ingestionId: rec.id,
				eventId: eventIdentity.eventId,
				duplicate: receipt.duplicate,
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
		const status = err instanceof RequestBodyTooLargeError || err instanceof MalwareScanLimitError ? 413 : err instanceof MalwareDetectedError ? 422 : err instanceof MalwareScannerUnavailableError ? 503 : 400
		return NextResponse.json({ ok: false, error: msg, ingestionId }, { status })
	} finally {
		if (leaseHeartbeat) clearInterval(leaseHeartbeat)
	}
}
