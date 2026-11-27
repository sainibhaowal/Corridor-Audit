import { randomBytes, createHash } from "node:crypto"
import { NextResponse } from "next/server"
import { authEnabled, cognitoSettings } from "@/core/security/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
	if (!authEnabled()) return NextResponse.redirect(new URL("/", request.url))
	try {
		const config = cognitoSettings()
		const state = randomBytes(32).toString("base64url")
		const nonce = randomBytes(32).toString("base64url")
		const verifier = randomBytes(48).toString("base64url")
		const challenge = createHash("sha256").update(verifier).digest("base64url")
		const url = new URL("/oauth2/authorize", config.domain)
		url.searchParams.set("response_type", "code")
		url.searchParams.set("client_id", config.clientId)
		url.searchParams.set("redirect_uri", config.callbackUrl)
		url.searchParams.set("scope", "openid email profile")
		url.searchParams.set("state", state)
		url.searchParams.set("nonce", nonce)
		url.searchParams.set("code_challenge", challenge)
		url.searchParams.set("code_challenge_method", "S256")
		const response = NextResponse.redirect(url)
		const secure = process.env.NODE_ENV === "production"
		const next = new URL(request.url).searchParams.get("next") || "/"
		const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/"
		for (const [name, value] of [["ca_oauth_state", state], ["ca_oauth_nonce", nonce], ["ca_pkce_verifier", verifier], ["ca_login_next", safeNext]]) {
			response.cookies.set(name, value, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 600 })
		}
		return response
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : "Authentication configuration error." }, { status: 503 })
	}
}
