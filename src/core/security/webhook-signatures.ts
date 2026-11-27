import { createHmac, timingSafeEqual, verify as verifySignature } from "node:crypto"

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

const WISE_PRODUCTION_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvO8vXV+JksBzZAY6GhSO
XdoTCfhXaaiZ+qAbtaDBiu2AGkGVpmEygFmWP4Li9m5+Ni85BhVvZOodM9epgW3F
bA5Q1SexvAF1PPjX4JpMstak/QhAgl1qMSqEevL8cmUeTgcMuVWCJmlge9h7B1CS
D4rtlimGZozG39rUBDg6Qt2K+P4wBfLblL0k4C4YUdLnpGYEDIth+i8XsRpFlogx
CAFyH9+knYsDbR43UJ9shtc42Ybd40Afihj8KnYKXzchyQ42aC8aZ/h5hyZ28yVy
Oj3Vos0VdBIs/gAyJ/4yyQFCXYte64I7ssrlbGRaco4nKF3HmaNhxwyKyJafz19e
HwIDAQAB
-----END PUBLIC KEY-----`

const WISE_SANDBOX_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwpb91cEYuyJNQepZAVfP
ZIlPZfNUefH+n6w9SW3fykqKu938cR7WadQv87oF2VuT+fDt7kqeRziTmPSUhqPU
ys/V2Q1rlfJuXbE+Gga37t7zwd0egQ+KyOEHQOpcTwKmtZ81ieGHynAQzsn1We3j
wt760MsCPJ7GMT141ByQM+yW1Bx+4SG3IGjXWyqOWrcXsxAvIXkpUD/jK/L958Cg
nZEgz0BSEh0QxYLITnW1lLokSx/dTianWPFEhMC9BgijempgNXHNfcVirg1lPSyg
z7KqoKUN0oHqWLr2U1A+7kqrl6O2nx3CKs1bj1hToT1+p4kcMoHXA7kA+VBLUpEs
VwIDAQAB
-----END PUBLIC KEY-----`

function getWiseWebhookPublicKey(): string {
	const configured = process.env.WISE_WEBHOOK_PUBLIC_KEY?.replace(/\\n/g, "\n").trim()
	if (configured) return configured
	const environment = process.env.WISE_WEBHOOK_ENVIRONMENT
	if (environment && environment !== "sandbox" && environment !== "production") {
		throw new Error("WISE_WEBHOOK_ENVIRONMENT must be 'sandbox' or 'production'.")
	}
	return environment === "sandbox" || (!environment && process.env.NODE_ENV !== "production")
		? WISE_SANDBOX_PUBLIC_KEY
		: WISE_PRODUCTION_PUBLIC_KEY
}

/** Verify Wise `X-Signature-SHA256`, an RSA-SHA256 signature over the exact raw body. */
export function verifyWiseSignature(rawBody: string, header: string, publicKey = getWiseWebhookPublicKey()): SignatureCheckResult {
	try {
		const signature = Buffer.from(header.trim(), "base64")
		if (!signature.length || !verifySignature("RSA-SHA256", Buffer.from(rawBody, "utf8"), publicKey, signature)) {
			return { valid: false, scheme: "wise", reason: "Wise X-Signature-SHA256 mismatch." }
		}
		return { valid: true, scheme: "wise" }
	} catch {
		return { valid: false, scheme: "wise", reason: "Wise public key or X-Signature-SHA256 is invalid." }
	}
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
	secrets: { corridor?: string; stripe?: string }
	wisePublicKey?: string
	requireSignature?: boolean
	requireTimestampedCorridorSignature?: boolean
}): SignatureCheckResult {
	const stripeHeader = params.headers.get("stripe-signature")
	if (stripeHeader && params.secrets.stripe) {
		return verifyStripeSignature(params.rawBody, stripeHeader, params.secrets.stripe)
	}

	const wiseHeader = params.headers.get("x-signature-sha256")
	if (wiseHeader) {
		return verifyWiseSignature(params.rawBody, wiseHeader, params.wisePublicKey)
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
