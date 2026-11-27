import { createHash } from "node:crypto"

function stringField(record: Record<string, unknown>, names: string[]): string | undefined {
	for (const name of names) {
		const value = record[name]
		if (typeof value === "string" && value.trim() && value.length <= 500) return value.trim()
	}
	return undefined
}

/** Use signed body event identifiers when present; otherwise key exact payload bytes by digest. */
export function deriveWebhookEventId(rawBody: string, provider: string, emailAdapter = false): {
	eventId: string
	source: "provider_event_id" | "payload_sha256"
} {
	let payload: Record<string, unknown> = {}
	try {
		const parsed: unknown = JSON.parse(rawBody)
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>
	} catch {
		// Non-JSON webhook bodies are still deduplicated by exact payload digest.
	}

	const candidates = emailAdapter
		? ["MessageID", "messageId", "message_id", "event_id", "eventId", "id"]
		: provider === "stripe"
			? ["id"]
			: ["event_id", "eventId", "webhook_id", "webhookId", "id"]
	const providerEventId = stringField(payload, candidates)
	if (providerEventId) return { eventId: `provider:${providerEventId}`, source: "provider_event_id" }
	const digest = createHash("sha256").update(rawBody, "utf8").digest("hex")
	return { eventId: `sha256:${digest}`, source: "payload_sha256" }
}
