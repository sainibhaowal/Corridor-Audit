import { NextResponse } from "next/server"
import {
	discoverModelsForProvider,
	PROVIDER_DEFAULTS,
	type ProviderId,
} from "@/core/llm/providers"
import { initCorridorOrchestrator } from "@/runtime/orchestrator"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
	try {
		const body = (await request.json()) as {
			provider?: ProviderId
			apiKey?: string
			baseURL?: string
		}

		const orchestrator = initCorridorOrchestrator()
		const current = orchestrator.router.getConfig()
		const provider = body.provider || current.provider
		const defaults = PROVIDER_DEFAULTS[provider]
		if (!defaults) {
			return NextResponse.json({ ok: false, error: `Unknown provider "${provider}".` }, { status: 400 })
		}

		const envKey = defaults.envVar ? process.env[defaults.envVar]?.trim() : undefined
		const resolvedKey =
			body.apiKey?.trim() ||
			(provider === current.provider ? current.apiKey : undefined) ||
			envKey ||
			(provider === "ollama" ? "ollama-local" : undefined)

		const resolvedBaseUrl = body.baseURL?.trim() || defaults.baseURL
		const models = await discoverModelsForProvider({
			provider,
			apiKey: resolvedKey,
			baseURL: resolvedBaseUrl,
		})

		orchestrator.router.setDiscoveredModels(models)

		return NextResponse.json({
			ok: true,
			provider,
			baseURL: resolvedBaseUrl,
			models,
		})
	} catch (err) {
		return NextResponse.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err), models: [] },
			{ status: 400 },
		)
	}
}
