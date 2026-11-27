import { normalizeInboundPayloadToCases } from "../ingest/normalize-upload"
import { IngestionLimitError, MAX_CASES_PER_INGESTION } from "../ingest/limits"
import type { SettlementCase } from "../types"
import { z } from "zod"

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

const boundedEmailText = z.string().max(10 * 1024 * 1024)
const emailAttachmentSchema = z.object({
	filename: z.string().max(512).optional(),
	name: z.string().max(512).optional(),
	contentType: z.string().max(255).optional(),
	contentBase64: boundedEmailText.optional(),
	Content: boundedEmailText.optional(),
	content: boundedEmailText.optional(),
}).passthrough()

export const inboundEmailPayloadSchema = z.object({
	from: z.string().max(2048).optional(),
	From: z.string().max(2048).optional(),
	to: z.string().max(2048).optional(),
	To: z.string().max(2048).optional(),
	subject: z.string().max(2048).optional(),
	Subject: z.string().max(2048).optional(),
	textBody: boundedEmailText.optional(),
	TextBody: boundedEmailText.optional(),
	text: boundedEmailText.optional(),
	attachments: z.array(emailAttachmentSchema).max(50).optional(),
	Attachments: z.array(emailAttachmentSchema).max(50).optional(),
}).passthrough()

export function validateInboundEmailPayload(input: unknown) {
	return inboundEmailPayloadSchema.safeParse(input)
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
			if (cases.length >= MAX_CASES_PER_INGESTION) {
				throw new IngestionLimitError(`An email import can contain no more than ${MAX_CASES_PER_INGESTION} settlement cases.`)
			}
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
