import { createRemoteJWKSet, jwtVerify } from "jose"
import { NextResponse } from "next/server"
import { DEFAULT_WORKSPACE_ID, getCorridorDb } from "@/core/db/database"
import { cognitoSettings, issueCorridorSession } from "@/core/security/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function requestCookie(request: Request, name: string): string | undefined {
	return request.headers
		.get("cookie")
		?.split(";")
		.map((part) => part.trim())
		.find((part) => part.startsWith(`${name}=`))
		?.slice(name.length + 1)
}

function clearAuthCookies(response: NextResponse) {
	for (const name of ["ca_oauth_state", "ca_oauth_nonce", "ca_pkce_verifier", "ca_login_next"]) {
		response.cookies.set(name, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 })
	}
}

export async function GET(request: Request) {
	const requestUrl = new URL(request.url)
	const stateCookie = requestCookie(request, "ca_oauth_state")
	const nonceCookie = requestCookie(request, "ca_oauth_nonce")
	const verifier = requestCookie(request, "ca_pkce_verifier")
	const next = requestCookie(request, "ca_login_next")
	const fail = (message: string) => {
		const response = NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, request.url))
		clearAuthCookies(response)
		return response
	}

	try {
		const code = requestUrl.searchParams.get("code")
		const returnedState = requestUrl.searchParams.get("state")
		if (!code || !returnedState || !stateCookie || !nonceCookie || !verifier || returnedState !== stateCookie) {
			return fail("Sign-in state check failed. Please try again.")
		}
		const config = cognitoSettings()
		const tokenHeaders = new Headers({ "content-type": "application/x-www-form-urlencoded" })
		if (config.clientSecret) {
			tokenHeaders.set("authorization", `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`)
		}
		const tokenResponse = await fetch(`${config.domain}/oauth2/token`, {
			method: "POST",
			headers: tokenHeaders,
			body: new URLSearchParams({
				grant_type: "authorization_code",
				client_id: config.clientId,
				code,
				redirect_uri: config.callbackUrl,
				code_verifier: verifier,
			}),
			cache: "no-store",
		})
		if (!tokenResponse.ok) return fail("Identity provider rejected sign-in. Please retry or contact an administrator.")
		const tokenPayload = (await tokenResponse.json()) as { id_token?: string }
		if (!tokenPayload.id_token) return fail("Identity provider returned no ID token.")
		const jwks = createRemoteJWKSet(new URL(`${config.issuer}/.well-known/jwks.json`))
		const { payload } = await jwtVerify(tokenPayload.id_token, jwks, {
			issuer: config.issuer,
			audience: config.clientId,
			algorithms: ["RS256"],
		})
		if (payload.nonce !== nonceCookie) return fail("Sign-in nonce check failed. Please try again.")
		const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : ""
		const name = typeof payload.name === "string" ? payload.name : email
		if (!payload.sub || !email || payload.email_verified !== true) {
			return fail("Sign-in requires a verified email address.")
		}
		const bootstrapOwnerEmail = process.env.CORRIDOR_BOOTSTRAP_OWNER_EMAIL?.trim().toLowerCase()
		const member = getCorridorDb().activateVerifiedTeamMember({
			workspaceId: DEFAULT_WORKSPACE_ID,
			email,
			name,
			bootstrapOwner: Boolean(bootstrapOwnerEmail && bootstrapOwnerEmail === email),
		})
		if (!member) return fail("This verified account has no active workspace invitation.")
		const session = await issueCorridorSession({ sub: payload.sub, email, name: member.name, role: member.role })
		const response = NextResponse.redirect(new URL(next?.startsWith("/") && !next.startsWith("//") ? next : "/", request.url))
		response.cookies.set("ca_session", session, {
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "lax",
			path: "/",
			maxAge: 60 * 60,
		})
		clearAuthCookies(response)
		return response
	} catch (error) {
		console.error("CorridorAudit sign-in failed:", error instanceof Error ? error.message : "unknown error")
		return fail("Sign-in could not be completed. Please try again.")
	}
}
