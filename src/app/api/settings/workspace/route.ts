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
			const rotatedSecret = db.transaction(() => {
				const value = db.rotateWebhookSecret(DEFAULT_WORKSPACE_ID)
				db.appendWorkspaceAuditEvent({ workspaceId: DEFAULT_WORKSPACE_ID, actorType: session ? "user" : "local", actorId: session?.sub, actorEmail: session?.email, actorRole: session?.role, action: "webhook_secret.rotate", targetType: "workspace", targetId: DEFAULT_WORKSPACE_ID, requestId: request.headers.get("x-request-id") || undefined })
				return value
			})
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
			if (body.memberRole !== undefined && !["owner", "controller", "analyst", "viewer"].includes(body.memberRole)) {
				return NextResponse.json({ ok: false, error: "Member role must be owner, controller, analyst, or viewer." }, { status: 400 })
			}
			const member = db.transaction(() => {
				const created = db.addTeamMember({
					workspaceId: DEFAULT_WORKSPACE_ID,
					email: body.memberEmail!,
					name: body.memberName!,
					role: body.memberRole || "analyst",
				})
				db.appendWorkspaceAuditEvent({ workspaceId: DEFAULT_WORKSPACE_ID, actorType: session ? "user" : "local", actorId: session?.sub, actorEmail: session?.email, actorRole: session?.role, action: "team_member.invite_recorded", targetType: "team_member", targetId: created.id, requestId: request.headers.get("x-request-id") || undefined, metadata: { assignedRole: created.role } })
				return created
			})
			return NextResponse.json({
				ok: true,
				workspace: db.getWorkspace(DEFAULT_WORKSPACE_ID),
				teamMembers: db.listTeamMembers(DEFAULT_WORKSPACE_ID),
			})
		}

		if (body.action === "remove_member") {
			if (!body.memberId?.trim()) {
				return NextResponse.json({ ok: false, error: "Member ID is required." }, { status: 400 })
			}
			if (session && session.role !== "owner") {
				return NextResponse.json({ ok: false, error: "Only workspace owners can manage team membership." }, { status: 403 })
			}
			const result = db.transaction(() => {
				const removed = db.removeTeamMember(DEFAULT_WORKSPACE_ID, body.memberId!)
				if (removed === "removed") db.appendWorkspaceAuditEvent({ workspaceId: DEFAULT_WORKSPACE_ID, actorType: session ? "user" : "local", actorId: session?.sub, actorEmail: session?.email, actorRole: session?.role, action: "team_member.remove", targetType: "team_member", targetId: body.memberId!, requestId: request.headers.get("x-request-id") || undefined })
				return removed
			})
			if (result === "last_owner") return NextResponse.json({ ok: false, error: "The last active workspace owner cannot be removed. Assign another active owner first." }, { status: 409 })
			if (result === "not_found") return NextResponse.json({ ok: false, error: "Team member was not found in this workspace." }, { status: 404 })
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
		if (body.varianceThresholdMinor !== undefined && (!Number.isSafeInteger(body.varianceThresholdMinor) || body.varianceThresholdMinor < 0)) {
			return NextResponse.json({ ok: false, error: "Variance tolerance must be a nonnegative integer in minor units." }, { status: 400 })
		}

		const workspace = db.transaction(() => {
			const updated = db.updateWorkspace(DEFAULT_WORKSPACE_ID, {
				name: body.name,
				accountMode: body.accountMode,
				defaultCurrency: body.defaultCurrency,
				taxCountry: body.taxCountry,
				withholdingTaxBps: body.withholdingTaxBps,
				varianceThresholdMinor: body.varianceThresholdMinor,
				requireWebhookSignature: body.requireWebhookSignature,
			})
			db.appendWorkspaceAuditEvent({ workspaceId: DEFAULT_WORKSPACE_ID, actorType: session ? "user" : "local", actorId: session?.sub, actorEmail: session?.email, actorRole: session?.role, action: "workspace.settings.update", targetType: "workspace", targetId: DEFAULT_WORKSPACE_ID, requestId: request.headers.get("x-request-id") || undefined, metadata: { changedFields: Object.keys(body).filter((key) => key !== "action" && body[key as keyof typeof body] !== undefined).sort().join(",") } })
			return updated
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
