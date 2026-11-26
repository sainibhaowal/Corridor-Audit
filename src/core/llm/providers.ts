import {
	AnthropicMessages,
	type Endpoint,
	GeminiGenerateContent,
	type InferenceInput,
	type InferenceOutput,
	type InferenceRunner,
	ModelMessageItem,
	OpenAIChatCompletions,
	SemanticEvent,
	supportedModels,
} from "@mozaik-ai/core"

type GenerativeModel = (typeof supportedModels)[number]

export type ProviderId =
	| "nvidia"
	| "gemini"
	| "groq"
	| "openrouter"
	| "openai"
	| "anthropic"
	| "ollama"

export interface ActiveProviderConfig {
	provider: ProviderId
	modelName: string
	apiKey?: string
	baseURL?: string
	autoDetectedFromEnv: boolean
}

export const ACTIVE_MODEL_SLOT = "corridor-active-model"

export const PROVIDER_DEFAULTS: Record<
	ProviderId,
	{ label: string; defaultModel: string; baseURL?: string; envVar?: string }
> = {
	nvidia: {
		label: "NVIDIA NIM ($0 Free Credits)",
		defaultModel: "nvidia/nemotron-3.5-super-vl-120b-a12b",
		baseURL: "https://integrate.api.nvidia.com/v1",
		envVar: "NVIDIA_API_KEY",
	},
	gemini: {
		label: "Google Gemini (AI Studio)",
		defaultModel: "gemini-2.5-flash",
		baseURL: "https://generativelanguage.googleapis.com/v1beta",
		envVar: "GEMINI_API_KEY",
	},
	groq: {
		label: "Groq",
		defaultModel: "llama-3.3-70b-versatile",
		baseURL: "https://api.groq.com/openai/v1",
		envVar: "GROQ_API_KEY",
	},
	openrouter: {
		label: "OpenRouter",
		defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
		baseURL: "https://openrouter.ai/api/v1",
		envVar: "OPENROUTER_API_KEY",
	},
	openai: {
		label: "OpenAI",
		defaultModel: "gpt-5.4",
		baseURL: "https://api.openai.com/v1",
		envVar: "OPENAI_API_KEY",
	},
	anthropic: {
		label: "Anthropic Claude",
		defaultModel: "claude-haiku-4-5",
		baseURL: "https://api.anthropic.com/v1",
		envVar: "ANTHROPIC_API_KEY",
	},
	ollama: {
		label: "Ollama (Local)",
		defaultModel: "llama3.2",
		baseURL: "http://localhost:11434/v1",
	},
}

export function resolveInitialProviderConfig(): ActiveProviderConfig {
	const explicit = (process.env.LLM_PROVIDER || "").trim().toLowerCase() as ProviderId | ""

	const build = (provider: ProviderId, autoDetectedFromEnv: boolean): ActiveProviderConfig => {
		const meta = PROVIDER_DEFAULTS[provider]
		const upper = provider.toUpperCase()
		const modelName =
			process.env.LLM_MODEL ||
			process.env[`${upper}_MODEL`] ||
			(provider === "ollama" ? process.env.OLLAMA_MODEL : undefined) ||
			meta.defaultModel
		const apiKey =
			process.env.LLM_API_KEY ||
			(meta.envVar ? process.env[meta.envVar] : undefined) ||
			(provider === "ollama" ? "ollama-local" : undefined)
		const baseURL =
			provider === "ollama"
				? process.env.OLLAMA_BASE_URL || meta.baseURL
				: meta.baseURL

		return { provider, modelName, apiKey, baseURL, autoDetectedFromEnv }
	}

	if (explicit && explicit in PROVIDER_DEFAULTS) {
		return build(explicit, false)
	}

	const detectionOrder: Array<{ provider: ProviderId; keyEnv: string }> = [
		{ provider: "nvidia", keyEnv: "NVIDIA_API_KEY" },
		{ provider: "openai", keyEnv: "OPENAI_API_KEY" },
		{ provider: "gemini", keyEnv: "GEMINI_API_KEY" },
		{ provider: "anthropic", keyEnv: "ANTHROPIC_API_KEY" },
		{ provider: "groq", keyEnv: "GROQ_API_KEY" },
		{ provider: "openrouter", keyEnv: "OPENROUTER_API_KEY" },
	]

	for (const entry of detectionOrder) {
		if (process.env[entry.keyEnv]?.trim()) {
			return build(entry.provider, true)
		}
	}

	return build("nvidia", true)
}

class AsyncSemaphore {
	private current = 0
	private queue: Array<() => void> = []

	constructor(private readonly maxConcurrent: number) {}

	async run<T>(fn: () => Promise<T>): Promise<T> {
		if (this.current >= this.maxConcurrent) {
			await new Promise<void>((res) => this.queue.push(res))
		}
		this.current++
		try {
			return await fn()
		} finally {
			this.current--
			const next = this.queue.shift()
			if (next) next()
		}
	}
}

function createEndpoint(cfg: ActiveProviderConfig): Endpoint {
	switch (cfg.provider) {
		case "gemini":
			return new GeminiGenerateContent(undefined, { apiKey: cfg.apiKey })
		case "anthropic":
			return new AnthropicMessages(undefined, { apiKey: cfg.apiKey })
		case "openai":
			return new OpenAIChatCompletions(undefined, { apiKey: cfg.apiKey })
		case "nvidia":
		case "groq":
		case "openrouter":
		case "ollama":
		default:
			return new OpenAIChatCompletions(undefined, {
				baseURL: cfg.baseURL,
				apiKey: cfg.apiKey || "ollama-local",
			})
	}
}

function isRetryableError(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err)
	return /\b(429|500|502|503|504|rate limit|timeout|ECONNRESET|ETIMEDOUT)\b/i.test(msg)
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms))
}

export async function discoverModelsForProvider(params: {
	provider: ProviderId
	apiKey?: string
	baseURL?: string
}): Promise<string[]> {
	const defaults = PROVIDER_DEFAULTS[params.provider]
	const baseUrl = normalizeProviderBaseUrl(params.baseURL?.trim() || defaults.baseURL || "")
	const apiKey = params.apiKey?.trim()

	if (!apiKey && params.provider !== "ollama") {
		throw new Error(`Enter an API key for ${defaults.label} to discover models.`)
	}

	const headers = new Headers({ Accept: "application/json" })
	let url: string
	if (params.provider === "gemini") {
		url = providerResourceUrl(baseUrl, "/models")
		if (apiKey) headers.set("x-goog-api-key", apiKey)
	} else if (params.provider === "anthropic") {
		url = providerResourceUrl(baseUrl, "/models")
		if (apiKey) headers.set("x-api-key", apiKey)
		headers.set("anthropic-version", "2023-06-01")
	} else if (params.provider === "ollama") {
		// Ollama's native tags endpoint is the canonical inventory API; its
		// OpenAI-compatible /v1/models endpoint is not implemented consistently.
		url = ollamaTagsUrl(baseUrl)
	} else {
		url = providerResourceUrl(baseUrl, "/models")
		if (apiKey) headers.set("Authorization", `Bearer ${apiKey}`)
	}

	let response: Response
	try {
		response = await fetch(url, { headers, signal: AbortSignal.timeout(12_000) })
	} catch (error) {
		if (error instanceof Error && error.name === "TimeoutError") {
			throw new Error(`${defaults.label} model discovery timed out after 12 seconds. Check the provider URL and network.`)
		}
		throw new Error(`${defaults.label} could not be reached. Check the provider URL, network, and local service status.`)
	}

	if (!response.ok) {
		const reason = response.status === 401 || response.status === 403
			? "The API key is invalid or does not have permission to list models."
			: response.status === 404
				? "The model-list endpoint was not found. Check the provider base URL."
				: response.status === 429
					? "The provider rate-limited model discovery. Wait briefly and retry."
					: `The provider returned HTTP ${response.status}.`
		throw new Error(`${defaults.label} model discovery failed. ${reason}`)
	}

	let json: unknown
	try {
		json = await response.json()
	} catch {
		throw new Error(`${defaults.label} returned an invalid model-list response.`)
	}
	const record = isRecord(json) ? json : {}
	if (params.provider === "gemini") {
		const models = Array.isArray(record.models) ? record.models : []
		return uniqueSorted(models.flatMap((entry) => {
			if (!isRecord(entry)) return []
			const methods = Array.isArray(entry.supportedGenerationMethods)
				? entry.supportedGenerationMethods.filter((method): method is string => typeof method === "string")
				: undefined
			if (methods && !methods.includes("generateContent")) return []
			return typeof entry.name === "string" ? [entry.name.replace(/^models\//, "")] : []
		}))
	}
	if (params.provider === "ollama") {
		const models = Array.isArray(record.models) ? record.models : []
		return uniqueSorted(models.flatMap((entry) =>
			isRecord(entry) && typeof entry.name === "string" ? [entry.name] : [],
		))
	}

	const data = Array.isArray(record.data) ? record.data : []
	const models = Array.isArray(record.models) ? record.models : []
	return uniqueSorted([
		...data.flatMap((entry) => isRecord(entry) && typeof entry.id === "string" ? [entry.id] : []),
		...models.flatMap((entry) => isRecord(entry)
			? [typeof entry.id === "string" ? entry.id : typeof entry.name === "string" ? entry.name : ""]
			: []),
	])
}

function normalizeProviderBaseUrl(value: string): string {
	return value.trim().replace(/\/+$/, "")
}

function providerResourceUrl(baseUrl: string, resource: string): string {
	return `${baseUrl.endsWith(resource) ? baseUrl : `${baseUrl}${resource}`}`
}

function ollamaTagsUrl(baseUrl: string): string {
	const withoutOpenAiPath = baseUrl.replace(/\/v1(?:\/.*)?$/, "")
	return providerResourceUrl(withoutOpenAiPath, "/api/tags")
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function uniqueSorted(values: string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

export function formatModelDisplayName(modelId: string): string {
	const raw = modelId.trim()
	if (!raw) return ""
	const withoutOrg = raw.includes("/") ? raw.split("/").slice(1).join("/") : raw
	const [core, tag] = withoutOrg.split(":")
	const tokens = core.split(/[-_]+/).filter(Boolean)
	const formatted = tokens
		.map((tok) => {
			if (/^(gpt|vl|xl|lpu|oss|ai)$/i.test(tok)) return tok.toUpperCase()
			if (/^\d+(\.\d+)?[bmkt]?$/i.test(tok) || /^a\d+[bm]$/i.test(tok)) return tok.toUpperCase()
			if (/^v\d+/i.test(tok)) return tok.toLowerCase()
			return tok.charAt(0).toUpperCase() + tok.slice(1)
		})
		.join(" ")
	return tag ? `${formatted} (${tag.charAt(0).toUpperCase() + tag.slice(1)})` : formatted
}

export class DynamicEndpointRouter implements InferenceRunner {
	private config: ActiveProviderConfig
	private readonly semaphore: AsyncSemaphore
	private discoveredModels: string[] = []
	private modelAliases: Record<string, string> = {}

	constructor(initialConfig: ActiveProviderConfig, maxConcurrent = 3) {
		this.config = initialConfig
		this.semaphore = new AsyncSemaphore(Math.max(1, maxConcurrent))
		this.discoveredModels = []
	}

	getConfig(): ActiveProviderConfig {
		return { ...this.config }
	}

	setDiscoveredModels(models: string[]): void {
		const unique = [...new Set(models.filter(Boolean))]
		this.discoveredModels = unique
	}

	getPublicStatus(): {
		provider: ProviderId
		label: string
		modelName: string
		modelDisplayName: string
		modelAliases: Record<string, string>
		baseURL?: string
		hasKey: boolean
		mode: "live" | "unconfigured"
		discoveredModels: string[]
	} {
		const hasKey = Boolean(this.config.apiKey || this.config.provider === "ollama")
		const modelDisplayName =
			this.modelAliases[this.config.modelName] || formatModelDisplayName(this.config.modelName)
		return {
			provider: this.config.provider,
			label: PROVIDER_DEFAULTS[this.config.provider].label,
			modelName: this.config.modelName,
			modelDisplayName,
			modelAliases: { ...this.modelAliases },
			baseURL: this.config.baseURL || PROVIDER_DEFAULTS[this.config.provider].baseURL,
			hasKey,
			mode: hasKey ? "live" : "unconfigured",
			discoveredModels: [...this.discoveredModels],
		}
	}

	updateConfig(next: {
		provider: ProviderId
		modelName?: string
		modelDisplayName?: string
		apiKey?: string
		baseURL?: string
	}): void {
		const defaults = PROVIDER_DEFAULTS[next.provider]
		const envKey = defaults.envVar ? process.env[defaults.envVar]?.trim() : undefined
		const resolvedKey =
			next.apiKey?.trim() ||
			(next.provider === this.config.provider ? this.config.apiKey : undefined) ||
			envKey ||
			(next.provider === "ollama" ? "ollama-local" : undefined)

		const nextModelName = next.modelName?.trim() || defaults.defaultModel
		if (next.modelDisplayName?.trim()) {
			this.modelAliases[nextModelName] = next.modelDisplayName.trim()
		}

		this.config = {
			provider: next.provider,
			modelName: nextModelName,
			apiKey: resolvedKey,
			baseURL: next.baseURL?.trim() || defaults.baseURL,
			autoDetectedFromEnv: false,
		}
	}

	createSupportedModelsList(): GenerativeModel[] {
		const endpoint: Endpoint = {
			endpointMapper: {
				toRequest: (i) => i,
				toResponse: (r) => r as InferenceOutput,
			},
			infer: (input) => this.run(input),
			stream: (input) => this.stream(input),
		}

		return [
			{
				name: ACTIVE_MODEL_SLOT,
				supportsStreaming: true,
				supportsFunctionCalling: true,
				supportsReasoning: true,
				supportsStructuredOutput: false,
				defaultMaxOutputTokens: 4096,
				endpoint,
			} as unknown as GenerativeModel,
		]
	}

	async run(request: InferenceInput): Promise<InferenceOutput> {
		if (!this.config.apiKey && this.config.provider !== "ollama") {
			throw new Error(
				`Missing API key for ${PROVIDER_DEFAULTS[this.config.provider].label}. Set an API key in .env or open Settings to configure a live LLM provider.`,
			)
		}

		return this.semaphore.run(async () => {
			const effectiveRequest: InferenceInput = {
				...request,
				model: this.config.modelName,
				maxOutputTokens: request.maxOutputTokens ?? 4096,
			}
			const endpoint = createEndpoint(this.config)

			for (let attempt = 0; attempt < 3; attempt++) {
				try {
					return await endpoint.infer(effectiveRequest)
				} catch (err) {
					if (attempt < 2 && isRetryableError(err)) {
						await sleep(1200 * 2 ** attempt)
						continue
					}
					throw err
				}
			}
			throw new Error("Exhausted inference retries")
		})
	}

	async *stream(request: InferenceInput): AsyncGenerator<SemanticEvent> {
		if (!this.config.apiKey && this.config.provider !== "ollama") {
			throw new Error(
				`Missing API key for ${PROVIDER_DEFAULTS[this.config.provider].label}. Set an API key in .env or open Settings to configure a live LLM provider.`,
			)
		}

		const effectiveRequest: InferenceInput = {
			...request,
			model: this.config.modelName,
			maxOutputTokens: request.maxOutputTokens ?? 4096,
		}

		// Acquire semaphore slot around the stream lifecycle
		const resultEvents: SemanticEvent[] = []
		await this.semaphore.run(async () => {
			const endpoint = createEndpoint(this.config)
			for (let attempt = 0; attempt < 3; attempt++) {
				try {
					for await (const ev of endpoint.stream(effectiveRequest)) {
						resultEvents.push(ev)
					}
					return
				} catch (err) {
					if (attempt < 2 && isRetryableError(err)) {
						resultEvents.length = 0
						await sleep(1200 * 2 ** attempt)
						continue
					}
					throw err
				}
			}
		})

		for (const ev of resultEvents) {
			yield ev
		}
	}

	async testConnection(): Promise<{ ok: boolean; message: string; latencyMs: number }> {
		const start = Date.now()
		if (!this.config.apiKey && this.config.provider !== "ollama") {
			return {
				ok: false,
				message: `Missing API key for ${PROVIDER_DEFAULTS[this.config.provider].label}.`,
				latencyMs: Date.now() - start,
			}
		}

		try {
			const endpoint = createEndpoint(this.config)
			const { ModelContext, UserMessageItem } = await import("@mozaik-ai/core")
			const ctx = ModelContext.create().addContextItem(UserMessageItem.create("Reply with exactly: OK"))
			const res = await endpoint.infer({
				model: this.config.modelName,
				maxOutputTokens: 256,
				context: ctx,
			})
			const txt =
				res.items.find((i): i is ModelMessageItem => i instanceof ModelMessageItem)?.content.text || "Connected"
			return {
				ok: true,
				message: `${this.config.provider} (${this.config.modelName}) replied: ${txt.slice(0, 60)}`,
				latencyMs: Date.now() - start,
			}
		} catch (err) {
			return {
				ok: false,
				message: err instanceof Error ? err.message : String(err),
				latencyMs: Date.now() - start,
			}
		}
	}
}
