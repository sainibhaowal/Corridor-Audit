import { NextResponse } from "next/server"
import { z } from "zod"
import { getCorridorDb } from "@/core/db/database"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function readLocalUserIdFromCookie(request: Request): string | null {
	const cookie = request.headers.get("cookie") || ""
	const match = cookie
		.split(";")
		.map((part) => part.trim())
		.find((part) => part.startsWith("ca_local_user="))
	return match ? decodeURIComponent(match.slice("ca_local_user=".length)) : null
}

function resolveActiveLocalUser(request: Request) {
	const db = getCorridorDb()
	const cookieUserId = readLocalUserIdFromCookie(request)
	if (cookieUserId) {
		const found = db.getLocalUserById(cookieUserId)
		if (found) return found
	}
	const seeded = db.ensureDefaultLocalUser()
	return db.getLocalUserById(seeded.id)
}

export async function GET(request: Request) {
	const user = resolveActiveLocalUser(request)
	return NextResponse.json({ ok: true, user })
}

const ProfileActionSchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("update_profile"),
		name: z.string().trim().min(1).max(80),
		avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
	}),
	z.object({
		action: z.literal("reset_password"),
		currentPassword: z.string().optional(),
		newPassword: z.string().min(8).max(200),
	}),
])

export async function POST(request: Request) {
	try {
		const active = resolveActiveLocalUser(request)
		if (!active) {
			return NextResponse.json({ ok: false, error: "No active user profile found." }, { status: 404 })
		}
		const body = ProfileActionSchema.safeParse(await request.json().catch(() => null))
		if (!body.success) {
			return NextResponse.json({ ok: false, error: body.error.issues[0]?.message || "Invalid profile update." }, { status: 400 })
		}

		const db = getCorridorDb()
		if (body.data.action === "update_profile") {
			const updated = db.updateLocalUserProfile({
				userId: active.id,
				name: body.data.name,
				avatarColor: body.data.avatarColor,
			})
			return NextResponse.json({ ok: true, user: updated })
		}

		db.resetLocalUserPassword({
			userId: active.id,
			currentPassword: body.data.currentPassword,
			newPassword: body.data.newPassword,
		})
		return NextResponse.json({ ok: true, message: "Password updated successfully." })
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Failed to update profile."
		return NextResponse.json({ ok: false, error: msg }, { status: 400 })
	}
}
