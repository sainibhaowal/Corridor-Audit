import { NextResponse } from "next/server"
import { getCorridorDb } from "@/core/db/database"
import { getCatalogItem } from "@/core/integrations/catalog"
import { consumeOAuthState, exchangeOAuthCode } from "@/core/integrations/oauth"
import { getCorridorPublicOrigin } from "@/core/security/public-origin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
	request: Request,
	context: { params: Promise<{ provider: string }> },
) {
	const { provider } = await context.params
	const url = new URL(request.url)
	let publicOrigin: string
	try {
		publicOrigin = getCorridorPublicOrigin(request)
	} catch (err) {
		return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
	}
	const code = url.searchParams.get("code")
	const state = url.searchParams.get("state")
	const errorParam = url.searchParams.get("error")

	if (errorParam) {
		return NextResponse.redirect(`${publicOrigin}/?view=inbound&oauth_error=${encodeURIComponent(errorParam)}`)
	}
	if (!code || !state) {
		return NextResponse.json({ ok: false, error: "Missing OAuth2 code or state parameter." }, { status: 400 })
	}

	try {
		const { workspaceId, codeVerifier } = consumeOAuthState(state, provider)
		const spec = getCatalogItem(provider)
		if (!spec) {
			return NextResponse.json({ ok: false, error: `Unknown provider "${provider}".` }, { status: 404 })
		}

		const exchanged = await exchangeOAuthCode({
			provider,
			code,
			origin: publicOrigin,
			codeVerifier,
		})

		const db = getCorridorDb()
		db.upsertIntegration({
			workspaceId,
			provider,
			category: spec.category,
			authMode: "oauth2",
			status: "connected",
			accountLabel: `${spec.name} (OAuth2)`,
			externalAccountId: exchanged.externalAccountId,
			credentials: exchanged.credentials,
		})

		return NextResponse.redirect(`${publicOrigin}/?view=inbound&connected=${encodeURIComponent(provider)}`)
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		return NextResponse.redirect(`${publicOrigin}/?view=inbound&oauth_error=${encodeURIComponent(msg)}`)
	}
}
