import { SignJWT, jwtVerify } from "jose"

export type CorridorRole = "owner" | "controller" | "analyst" | "viewer"

export interface CorridorSession {
	sub: string
	email: string
	name: string
	role: CorridorRole
}

export function authEnabled(): boolean {
	return process.env.NODE_ENV === "production" || process.env.CORRIDOR_AUTH_MODE === "cognito"
}

export function cognitoSettings() {
	const issuer = process.env.COGNITO_ISSUER?.replace(/\/$/, "")
	const domain = process.env.COGNITO_DOMAIN?.replace(/\/$/, "")
	const clientId = process.env.COGNITO_CLIENT_ID
	const callbackUrl = process.env.COGNITO_CALLBACK_URL
	if (!issuer || !domain || !clientId || !callbackUrl) {
		throw new Error("Cognito is not configured. Set COGNITO_ISSUER, COGNITO_DOMAIN, COGNITO_CLIENT_ID, and COGNITO_CALLBACK_URL.")
	}
	const issuerUrl = new URL(issuer)
	const domainUrl = new URL(domain)
	const callback = new URL(callbackUrl)
	if (issuerUrl.protocol !== "https:" || domainUrl.protocol !== "https:") {
		throw new Error("Cognito issuer and hosted domain must use HTTPS.")
	}
	if (process.env.NODE_ENV === "production" && callback.protocol !== "https:") {
		throw new Error("Cognito callback URL must use HTTPS in production.")
	}
	return { issuer, domain, clientId, callbackUrl, clientSecret: process.env.COGNITO_CLIENT_SECRET }
}

export function sessionSigningKey(): Uint8Array {
	const secret = process.env.CORRIDOR_SESSION_SECRET
	if (!secret || secret.length < 32) {
		throw new Error("CORRIDOR_SESSION_SECRET must contain at least 32 characters.")
	}
	return new TextEncoder().encode(secret)
}

export async function issueCorridorSession(session: CorridorSession): Promise<string> {
	return new SignJWT({ email: session.email, name: session.name, role: session.role })
		.setProtectedHeader({ alg: "HS256", typ: "JWT" })
		.setSubject(session.sub)
		.setIssuedAt()
		.setExpirationTime("1h")
		.sign(sessionSigningKey())
}

export async function requestCorridorSession(request: Request): Promise<CorridorSession | null> {
	const token = request.headers
		.get("cookie")
		?.split(";")
		.map((part) => part.trim())
		.find((part) => part.startsWith("ca_session="))
		?.slice("ca_session=".length)
	if (!token) return null
	return verifyCorridorSession(token)
}


export async function verifyCorridorSession(token: string): Promise<CorridorSession> {
	const { payload } = await jwtVerify(token, sessionSigningKey(), { algorithms: ["HS256"] })
	if (
		typeof payload.sub !== "string" ||
		typeof payload.email !== "string" ||
		typeof payload.name !== "string" ||
		!(["owner", "controller", "analyst", "viewer"] as unknown[]).includes(payload.role)
	) {
		throw new Error("Invalid CorridorAudit session claims.")
	}
	return {
		sub: payload.sub,
		email: payload.email,
		name: payload.name,
		role: payload.role as CorridorRole,
	}
}
