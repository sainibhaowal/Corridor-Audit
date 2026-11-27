import { NextResponse } from "next/server"
import { z } from "zod"
import { getCorridorDb } from "@/core/db/database"

export const runtime = "nodejs"

const LocalAuthSchema = z.object({
	email: z.string().trim().min(3).max(160),
	password: z.string().min(1).max(200),
	name: z.string().trim().max(80).optional(),
	mode: z.enum(["login", "register"]).optional(),
})

export async function POST(request: Request) {
	try {
		const raw = (await request.json().catch(() => null)) as unknown
		const parsed = LocalAuthSchema.safeParse(raw)
		if (!parsed.success) {
			return NextResponse.json(
				{ ok: false, error: parsed.error.issues[0]?.message || "Invalid login request." },
				{ status: 400 },
			)
		}

		const user = getCorridorDb().authenticateOrRegisterLocalUser(parsed.data)
		const response = NextResponse.json({ ok: true, user }, { status: 200 })
		response.cookies.set("ca_local_user", user.id, {
			httpOnly: true,
			sameSite: "lax",
			path: "/",
			maxAge: 60 * 60 * 24 * 7,
		})
		return response
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Authentication failed."
		const status = msg.includes("Invalid email or password") ? 401 : 400
		return NextResponse.json({ ok: false, error: msg }, { status })
	}
}
