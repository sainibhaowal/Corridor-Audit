import { normalizeInboundPayloadToCases } from "../ingest/normalize-upload"
import type { SettlementCase } from "../types"

export interface InboundEmailAttachment {
	filename?: string
	name?: string
	contentType?: string
	contentBase64?: string
	Content?: string
	content?: string
}

export interface InboundEmailPayload {
	from?: string
	From?: string
	to?: string
	To?: string
	subject?: string
	Subject?: string
	textBody?: string
	TextBody?: string
	text?: string
	attachments?: InboundEmailAttachment[]
	Attachments?: InboundEmailAttachment[]
}

/**
 * Normalizes inbound email webhooks (Postmark, Resend, Mailgun, or generic JSON)
 * into SettlementCase[] by extracting supported attachments (PDF, CSV, XML, MT103, JSON)
 * or falling back to inline MT103/invoice text in the email body.
 */
export function parseInboundEmailToCases(payload: InboundEmailPayload): SettlementCase[] {
	const attachments = payload.attachments || payload.Attachments || []
	const subject = payload.subject || payload.Subject || "Inbound Email Settlement"
	const sender = payload.from || payload.From || "unknown-sender"
	const bodyText = payload.textBody || payload.TextBody || payload.text || ""

	const cases: SettlementCase[] = []

	for (const att of attachments) {
		const filename = att.filename || att.name || "attachment.txt"
		const base64 = att.contentBase64 || att.Content
		const rawText = att.content

		if (!base64 && !rawText) continue

		const ext = filename.split(".").pop()?.toLowerCase()
		const format =
			ext === "pdf"
				? "pdf"
				: ext === "xml"
					? "xml"
					: ext === "csv"
						? "csv"
						: ext === "json"
							? "json"
							: "auto"

		const content = rawText ?? (base64 && format !== "pdf" ? Buffer.from(base64, "base64").toString("utf8") : undefined)

		const parsed = normalizeInboundPayloadToCases({
			filename,
			base64: format === "pdf" ? base64 : undefined,
			content,
			format,
		})

		for (const item of parsed) {
			cases.push({
				...item,
				channelLabel: `Email from ${sender}`,
				title: item.title || `${subject} (${filename})`,
			})
		}
	}

	if (cases.length === 0 && bodyText.trim()) {
		const parsed = normalizeInboundPayloadToCases({
			filename: "email-body.txt",
			content: bodyText,
			format: "auto",
		})
		for (const item of parsed) {
			cases.push({
				...item,
				channelLabel: `Email from ${sender}`,
				title: item.title || subject,
			})
		}
	}

	if (cases.length === 0) {
		throw new Error("Inbound email contained no parseable attachments or settlement text.")
	}

	return cases
}
