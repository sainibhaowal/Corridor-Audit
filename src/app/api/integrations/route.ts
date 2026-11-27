import { NextResponse } from "next/server"
import { DEFAULT_WORKSPACE_ID, getCorridorDb } from "@/core/db/database"
import { getIntegrationAdapterDetails, INTEGRATION_CATALOG, isOAuthConfiguredForProvider } from "@/core/integrations/catalog"
import { authorizeCorridorRequest } from "@/core/security/authorization"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
	const denied = await authorizeCorridorRequest(request, "viewer")
	if (denied) return denied
	const db = getCorridorDb()
	const workspace = db.getWorkspace(DEFAULT_WORKSPACE_ID)
	const connected = db.listIntegrations(DEFAULT_WORKSPACE_ID)
	const byProvider = new Map(connected.map((item) => [item.provider, item]))
	const syncRuns = db.listRecentSyncRuns(DEFAULT_WORKSPACE_ID, 15)

	const items = INTEGRATION_CATALOG.map((spec) => {
		const record = byProvider.get(spec.provider)
		return {
			...spec,
			adapter: getIntegrationAdapterDetails(spec.provider),
			oauthConfigured: isOAuthConfiguredForProvider(spec),
			connection: record ?? {
				id: null,
				workspaceId: DEFAULT_WORKSPACE_ID,
				provider: spec.provider,
				category: spec.category,
				authMode: spec.defaultAuthMode,
				status: "disconnected" as const,
				config: {},
			},
		}
	})

	return NextResponse.json({
		ok: true,
		workspace,
		integrations: items,
		syncRuns,
	})
}
