import { NextResponse } from "next/server"
import { getCorridorDb } from "@/core/db/database"
import { authEnabled, requestCorridorSession } from "@/core/security/auth"

export const runtime = "nodejs"

export async function POST(request: Request) {
	let revocationFailed = false
	if (authEnabled()) {
		let session = null
		try {
			session = await requestCorridorSession(request)
		} catch {
			// The browser cookie is cleared below even when the token is already invalid.
		}
		if (session) {
			try {
				getCorridorDb().revokeAuthSession(session.sessionId)
			} catch {
				revocationFailed = true
			}
		}
	}
	const response = revocationFailed
		? NextResponse.json({ ok: false, error: "Session could not be revoked. Contact the administrator if this continues." }, { status: 503 })
		: NextResponse.redirect(new URL("/login", request.url), { status: 303 })
	response.cookies.set("ca_session", "", {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax",
		path: "/",
		maxAge: 0,
	})
	return response
}
