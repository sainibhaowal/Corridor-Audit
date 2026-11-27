import { NextResponse } from "next/server"
import { DEFAULT_WORKSPACE_ID, getCorridorDb } from "@/core/db/database"
import { authEnabled, requestCorridorSession } from "@/core/security/auth"
import { authorizeCorridorRequest } from "@/core/security/authorization"
import type { AccountMode, TeamRole } from "@/core/db/schema"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
	const denied = await authorizeCorridorRequest(request, "viewer")
	if (denied) return denied
	const db = getCorridorDb()
	const workspace = db.getWorkspace(DEFAULT_WORKSPACE_ID)
	const teamMembers = db.listTeamMembers(DEFAULT_WORKSPACE_ID)
	return NextResponse.json({ ok: true, workspace, teamMembers })
}

export async function POST(request: Request) {
	const denied = await authorizeCorridorRequest(request, "controller")
	if (denied) return denied
	try {
		const body = (await request.json()) as {
			action?: "update_workspace" | "rotate_webhook_secret" | "add_member" | "remove_member"
			name?: string
			accountMode?: AccountMode
			defaultCurrency?: string
			taxCountry?: string
			withholdingTaxBps?: number
			varianceThresholdMinor?: number
			requireWebhookSignature?: boolean
			memberEmail?: string
			memberName?: string
			memberRole?: TeamRole
			memberId?: string
		}

		const db = getCorridorDb()
		const session = authEnabled() ? await requestCorridorSession(request) : null
		if (authEnabled() && !session) {
			return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 })
		}

		if (body.action === "rotate_webhook_secret") {
			if (session && session.role !== "owner") {
				return NextResponse.json({ ok: false, error: "Only workspace owners can rotate webhook secrets." }, { status: 403 })
			}
			const rotatedSecret = db.rotateWebhookSecret(DEFAULT_WORKSPACE_ID)
			return NextResponse.json({
				ok: true,
				rotatedSecret,
				workspace: db.getWorkspace(DEFAULT_WORKSPACE_ID),
				teamMembers: db.listTeamMembers(DEFAULT_WORKSPACE_ID),
			})
		}

		if (body.action === "add_member") {
			if (session && session.role !== "owner") {
				return NextResponse.json({ ok: false, error: "Only workspace owners can manage team membership." }, { status: 403 })
			}
			if (!body.memberEmail?.trim() || !body.memberName?.trim()) {
				return NextResponse.json({ ok: false, error: "Member name and email are required." }, { status: 400 })
			}
			db.addTeamMember({
				workspaceId: DEFAULT_WORKSPACE_ID,
				email: body.memberEmail,
				name: body.memberName,
				role: body.memberRole || "analyst",
			})
			return NextResponse.json({
				ok: true,
				workspace: db.getWorkspace(DEFAULT_WORKSPACE_ID),
				teamMembers: db.listTeamMembers(DEFAULT_WORKSPACE_ID),
			})
		}

		if (body.action === "remove_member" && body.memberId) {
			if (session && session.role !== "owner") {
				return NextResponse.json({ ok: false, error: "Only workspace owners can manage team membership." }, { status: 403 })
			}
			db.removeTeamMember(DEFAULT_WORKSPACE_ID, body.memberId)
			return NextResponse.json({
				ok: true,
				workspace: db.getWorkspace(DEFAULT_WORKSPACE_ID),
				teamMembers: db.listTeamMembers(DEFAULT_WORKSPACE_ID),
			})
		}

		if (body.taxCountry !== undefined && !/^[A-Za-z]{2}$/.test(body.taxCountry.trim())) {
			return NextResponse.json({ ok: false, error: "Tax profile country must be a two-letter country code." }, { status: 400 })
		}
		if (body.withholdingTaxBps !== undefined && (!Number.isSafeInteger(body.withholdingTaxBps) || body.withholdingTaxBps < 0 || body.withholdingTaxBps > 10_000)) {
			return NextResponse.json({ ok: false, error: "Workspace withholding rate must be an integer from 0 to 10,000 basis points." }, { status: 400 })
		}

		const workspace = db.updateWorkspace(DEFAULT_WORKSPACE_ID, {
			name: body.name,
			accountMode: body.accountMode,
			defaultCurrency: body.defaultCurrency,
			taxCountry: body.taxCountry,
			withholdingTaxBps: body.withholdingTaxBps,
			varianceThresholdMinor: body.varianceThresholdMinor,
			requireWebhookSignature: body.requireWebhookSignature,
		})

		return NextResponse.json({
			ok: true,
			workspace,
			teamMembers: db.listTeamMembers(DEFAULT_WORKSPACE_ID),
		})
	} catch (err) {
		return NextResponse.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			{ status: 400 },
		)
	}
}
