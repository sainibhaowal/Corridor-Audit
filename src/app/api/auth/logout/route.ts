import { NextResponse } from "next/server"

export const runtime = "nodejs"

export async function POST(request: Request) {
	const response = NextResponse.redirect(new URL("/login", request.url), { status: 303 })
	response.cookies.set("ca_session", "", {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax",
		path: "/",
		maxAge: 0,
	})
	return response
}
