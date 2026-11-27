import { createHmac, timingSafeEqual } from "node:crypto"

export interface SignatureCheckResult {
	valid: boolean
	scheme: "stripe" | "wise" | "corridor" | "none"
	reason?: string
}

function safeCompareStrings(a: string, b: string): boolean {
	const bufA = Buffer.from(a, "utf8")
	const bufB = Buffer.from(b, "utf8")
	if (bufA.length !== bufB.length) return false
	return timingSafeEqual(bufA, bufB)
}

/** Verify Stripe-Signature header (`t=<unix>,v1=<hex>`). */
export function verifyStripeSignature(
	rawBody: string,
	header: string,
	secret: string,
	toleranceSeconds = 300,
): SignatureCheckResult {
	const parts = Object.fromEntries(
		header
			.split(",")
			.map((p) => p.trim().split("="))
			.filter((kv): kv is [string, string] => kv.length === 2),
	)
	const timestamp = Number(parts.t)
	const signature = parts.v1
	if (!timestamp || !signature) {
		return { valid: false, scheme: "stripe", reason: "Malformed Stripe-Signature header." }
	}
	if (toleranceSeconds > 0 && Math.abs(Math.floor(Date.now() / 1000) - timestamp) > toleranceSeconds) {
		return { valid: false, scheme: "stripe", reason: "Stripe webhook timestamp outside tolerance." }
	}
	const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex")
	if (!safeCompareStrings(expected, signature.toLowerCase())) {
		return { valid: false, scheme: "stripe", reason: "Stripe HMAC signature mismatch." }
	}
	return { valid: true, scheme: "stripe" }
}

/** Verify Wise `X-Signature-SHA256` header (base64 or hex HMAC-SHA256 of raw body). */
export function verifyWiseSignature(rawBody: string, header: string, secret: string): SignatureCheckResult {
	const cleaned = header.trim()
	const expectedHex = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")
	const expectedB64 = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64")
	if (safeCompareStrings(expectedHex, cleaned.toLowerCase()) || safeCompareStrings(expectedB64, cleaned)) {
		return { valid: true, scheme: "wise" }
	}
	return { valid: false, scheme: "wise", reason: "Wise X-Signature-SHA256 mismatch." }
}

/** Verify Corridor `X-Corridor-Signature` as `t=<unix>,v1=<hex>` in production. */
export function verifyCorridorSignature(
	rawBody: string,
	header: string,
	secret: string,
	toleranceSeconds = 300,
	requireTimestamp = false,
): SignatureCheckResult {
	const parts = Object.fromEntries(
		header.split(",").map((part) => part.trim().split("=")).filter((kv): kv is [string, string] => kv.length === 2),
	)
	const timestamp = Number(parts.t)
	const versionedSignature = parts.v1
	if (timestamp && versionedSignature) {
		if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > toleranceSeconds) {
			return { valid: false, scheme: "corridor", reason: "Corridor webhook timestamp outside tolerance." }
		}
		const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex")
		if (safeCompareStrings(expected, versionedSignature.toLowerCase())) return { valid: true, scheme: "corridor" }
		return { valid: false, scheme: "corridor", reason: "Corridor HMAC signature mismatch." }
	}
	if (requireTimestamp) {
		return { valid: false, scheme: "corridor", reason: "Production Corridor signatures must include a signed timestamp." }
	}
	const cleaned = header.trim().replace(/^sha256=/i, "").toLowerCase()
	const expectedHex = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")
	if (safeCompareStrings(expectedHex, cleaned)) return { valid: true, scheme: "corridor" }
	return { valid: false, scheme: "corridor", reason: "Corridor HMAC signature mismatch." }
}

/**
 * Verify inbound webhook request headers against known signing secrets.
 * If `requireSignature` is true, at least one recognized signature header must be present and valid.
 */
export function verifyInboundWebhookRequest(params: {
	rawBody: string
	headers: Headers
	secrets: { corridor?: string; stripe?: string; wise?: string }
	requireSignature?: boolean
	requireTimestampedCorridorSignature?: boolean
}): SignatureCheckResult {
	const stripeHeader = params.headers.get("stripe-signature")
	if (stripeHeader && params.secrets.stripe) {
		return verifyStripeSignature(params.rawBody, stripeHeader, params.secrets.stripe)
	}

	const wiseHeader = params.headers.get("x-signature-sha256")
	if (wiseHeader && params.secrets.wise) {
		return verifyWiseSignature(params.rawBody, wiseHeader, params.secrets.wise)
	}

	const corridorHeader = params.headers.get("x-corridor-signature")
	if (corridorHeader && params.secrets.corridor) {
		return verifyCorridorSignature(params.rawBody, corridorHeader, params.secrets.corridor, 300, params.requireTimestampedCorridorSignature)
	}

	if (params.requireSignature) {
		return {
			valid: false,
			scheme: "none",
			reason: "Missing required webhook signature header (Stripe-Signature, X-Signature-SHA256, or X-Corridor-Signature).",
		}
	}

	return { valid: true, scheme: "none" }
}
