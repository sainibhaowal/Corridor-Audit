import { NextResponse } from "next/server"
import { DEFAULT_WORKSPACE_ID, getCorridorDb } from "@/core/db/database"
import { parseInboundEmailToCases, type InboundEmailPayload } from "@/core/integrations/email-parser"
import { verifyInboundWebhookRequest } from "@/core/security/webhook-signatures"
import { readRequestTextLimited, RequestBodyTooLargeError } from "@/core/security/request-body"
import { initCorridorOrchestrator } from "@/runtime/orchestrator"
import { deriveWebhookEventId } from "@/core/security/webhook-event-id"
import { MalwareDetectedError, MalwareScannerUnavailableError, MalwareScanLimitError, scanFileBytes } from "@/core/security/malware-scan"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const MAX_EMAIL_WEBHOOK_BODY_BYTES = 10 * 1024 * 1024

export async function POST(request: Request) {
	const db = getCorridorDb()
	let ingestionId: string | undefined
	let receiptIdentity: { provider: string; eventId: string } | undefined

	try {
		const raw = await readRequestTextLimited(request, MAX_EMAIL_WEBHOOK_BODY_BYTES)
		const workspace = db.getWorkspace(DEFAULT_WORKSPACE_ID)
		const corridorSecret = db.getRawWebhookSecret(DEFAULT_WORKSPACE_ID)

		const sigCheck = verifyInboundWebhookRequest({
			rawBody: raw,
			headers: request.headers,
			secrets: { corridor: corridorSecret },
			requireSignature: workspace.requireWebhookSignature || process.env.NODE_ENV === "production",
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
		try {
			payload = JSON.parse(raw) as InboundEmailPayload
		} catch {
			payload = undefined
		}
		const sender = payload?.from || payload?.From || "unknown-sender"
		const subject = payload?.subject || payload?.Subject || "Inbound Email"
		let malwareScanStatus = "not_applicable"
		for (const attachment of payload?.attachments || payload?.Attachments || []) {
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
		const rec = receipt.ingestion
		ingestionId = rec.id
		if (!payload) {
			const message = "Email webhook body is not valid JSON. The raw payload was retained for inspection."
			db.updateRawIngestionOutcome({ id: rec.id, parseStatus: "failed", parseError: message })
			db.markWebhookReceiptStatus({ ...identity, status: "failed" })
			return NextResponse.json({ ok: false, error: message, ingestionId: rec.id }, { status: 422 })
		}

		let cases: ReturnType<typeof parseInboundEmailToCases>
		try {
			cases = parseInboundEmailToCases(payload)
		} catch (error) {
			const message = error instanceof Error ? error.message : "Email payload could not be parsed."
			db.updateRawIngestionOutcome({ id: rec.id, parseStatus: "failed", parseError: message })
			db.markWebhookReceiptStatus({ ...identity, status: "failed" })
			return NextResponse.json({ ok: false, error: message, ingestionId: rec.id }, { status: 422 })
		}
		if (cases.length === 0) {
			const message = "Email payload was stored, but it contained no supported settlement cases."
			db.updateRawIngestionOutcome({ id: rec.id, parseStatus: "failed", parseError: message })
			db.markWebhookReceiptStatus({ ...identity, status: "failed" })
			return NextResponse.json({ ok: false, error: message, ingestionId: rec.id }, { status: 422 })
		}
		db.updateRawIngestionOutcome({
			id: rec.id,
			parseStatus: "parsed",
			caseIds: cases.map((c) => c.caseId),
		})

		const orchestrator = initCorridorOrchestrator()
		const execution = orchestrator.enqueueBatch(cases)
		db.markWebhookReceiptStatus({ ...identity, status: "queued" })
		void execution.catch((err) => {
			db.markWebhookReceiptStatus({ ...identity, status: "failed" })
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
		if (ingestionId) {
			db.updateRawIngestionOutcome({
				id: ingestionId,
				parseStatus: "failed",
				parseError: msg,
			})
		}
		if (receiptIdentity) db.markWebhookReceiptStatus({ ...receiptIdentity, status: "failed" })
		const status = err instanceof RequestBodyTooLargeError || err instanceof MalwareScanLimitError ? 413 : err instanceof MalwareDetectedError ? 422 : err instanceof MalwareScannerUnavailableError ? 503 : 400
		return NextResponse.json({ ok: false, error: msg, ingestionId }, { status })
	}
}
