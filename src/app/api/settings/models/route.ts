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
			provider?: ProviderId | string
			apiKey?: string
			baseURL?: string
		}

		const orchestrator = initCorridorOrchestrator()
		const current = orchestrator.router.getConfig()
		const requestedProvider = body.provider || current.provider
		if (!isProviderId(requestedProvider)) {
			return NextResponse.json(
				{ ok: false, error: `Unknown provider "${requestedProvider}".`, models: [] },
				{ status: 400 },
			)
		}
		const provider = requestedProvider
		const defaults = PROVIDER_DEFAULTS[provider]

		const envKey = defaults.envVar ? process.env[defaults.envVar]?.trim() : undefined
		const resolvedKey =
			body.apiKey?.trim() ||
			(provider === current.provider ? current.apiKey : undefined) ||
			envKey ||
			(provider === "ollama" ? "ollama-local" : undefined)

		const resolvedBaseUrl = body.baseURL?.trim() || defaults.baseURL
		const models = await discoverModelsForProvider({
			provider: provider as ProviderId,
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
		const message = err instanceof Error ? err.message : "Model discovery failed."
		const status = /enter an api key/i.test(message) ? 400 : 502
		return NextResponse.json(
			{ ok: false, error: message, models: [] },
			{ status },
		)
	}
}

function isProviderId(value: string): value is ProviderId {
	return Object.hasOwn(PROVIDER_DEFAULTS, value)
}
