import { NextResponse } from "next/server"
import { DEFAULT_WORKSPACE_ID, getCorridorDb } from "@/core/db/database"
import type { IntegrationAuthMode } from "@/core/db/schema"
import { getCatalogItem } from "@/core/integrations/catalog"
import { createOAuthAuthorizationUrl } from "@/core/integrations/oauth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
	request: Request,
	context: { params: Promise<{ provider: string }> },
) {
	try {
		const { provider } = await context.params
		const origin = new URL(request.url).origin
		const { url } = createOAuthAuthorizationUrl({
			provider,
			workspaceId: DEFAULT_WORKSPACE_ID,
			origin,
		})
		return NextResponse.json({ ok: true, authorizationUrl: url })
	} catch (err) {
		return NextResponse.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			{ status: 400 },
		)
	}
}

export async function POST(
	request: Request,
	context: { params: Promise<{ provider: string }> },
) {
	try {
		const { provider } = await context.params
		const spec = getCatalogItem(provider)
		if (!spec) {
			return NextResponse.json({ ok: false, error: `Unknown integration provider "${provider}".` }, { status: 404 })
		}

		const body = (await request.json()) as {
			authMode?: IntegrationAuthMode
			accountLabel?: string
			externalAccountId?: string
			apiKey?: string
			webhookSecret?: string
			config?: Record<string, string>
		}

		const resolvedMode = body.authMode || spec.defaultAuthMode
		const requiresToken = !["email_forward", "sftp"].includes(resolvedMode) && !["email_inbound", "bank_sftp"].includes(provider)
		if (requiresToken && !body.apiKey?.trim()) {
			return NextResponse.json(
				{ ok: false, error: `An API key or access token is required to connect ${spec.name}.` },
				{ status: 400 },
			)
		}

		const db = getCorridorDb()
		const record = db.upsertIntegration({
			workspaceId: DEFAULT_WORKSPACE_ID,
			provider,
			category: spec.category,
			authMode: resolvedMode,
			status: "connected",
			accountLabel: body.accountLabel?.trim() || spec.name,
			externalAccountId: body.externalAccountId?.trim(),
			credentials:
				body.apiKey || body.webhookSecret
					? {
							apiKey: body.apiKey?.trim(),
							webhookSecret: body.webhookSecret?.trim(),
						}
					: undefined,
			config: body.config ?? {},
		})

		return NextResponse.json({ ok: true, integration: record })
	} catch (err) {
		return NextResponse.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			{ status: 400 },
		)
	}
}
