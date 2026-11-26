import {
	AnthropicMessages,
	DeveloperMessageItem,
	type Endpoint,
	FunctionCallItem,
	FunctionCallOutputItem,
	GeminiGenerateContent,
	type InferenceInput,
	type InferenceOutput,
	type InferenceRunner,
	ModelMessageItem,
	OpenAIChatCompletions,
	SemanticEvent,
	SystemMessageItem,
	UserMessageItem,
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
	| "demo"

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
		envVar: "OPENAI_API_KEY",
	},
	anthropic: {
		label: "Anthropic Claude",
		defaultModel: "claude-haiku-4-5",
		envVar: "ANTHROPIC_API_KEY",
	},
	ollama: {
		label: "Ollama (Local)",
		defaultModel: "llama3.2",
		baseURL: "http://localhost:11434/v1",
	},
	demo: {
		label: "Deterministic Demo Runner (No Key)",
		defaultModel: "deterministic-demo",
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

	return build("demo", true)
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

/**
 * Deterministic fallback runner used when no LLM API key is configured yet.
 * Still executes real Mozaik AgentLoops, real FunctionCallItems across all 20
 * deterministic tools, and real InterceptionHandler breakpoints end-to-end.
 */
function runDemoDeterministicTurn(input: InferenceInput): InferenceOutput {
	const items = input.context.getItems()
	const calledNames = new Set<string>()
	let caseId = "CASE-001"
	let lastUserOrDev = ""
	let rejectedOverrideNote: string | null = null

	for (const item of items) {
		if (item instanceof FunctionCallItem) {
			calledNames.add(item.name)
			try {
				const parsed = JSON.parse(item.args) as { caseId?: string }
				if (parsed.caseId) caseId = parsed.caseId
			} catch {
				// ignore
			}
		} else if (item instanceof FunctionCallOutputItem) {
			try {
				const outParsed = JSON.parse(item.output.text) as {
					rejectedByHuman?: boolean
					humanOverrideNote?: string
				}
				if (outParsed.rejectedByHuman) {
					rejectedOverrideNote =
						outParsed.humanOverrideNote || "Operator rejected dispute claim — close cleanly as SHA."
				}
			} catch {
				if (/rejectedByHuman|override|treat as|accept fee/i.test(item.output.text)) {
					rejectedOverrideNote = item.output.text
				}
			}
		} else if (
			item instanceof UserMessageItem ||
			item instanceof DeveloperMessageItem ||
			item instanceof SystemMessageItem
		) {
			lastUserOrDev += `\n${item.content.text}`
			const m =
				item.content.text.match(/(?:Audit settlement case|for caseId=")\s*([A-Za-z0-9][A-Za-z0-9._-]+)/) ??
				item.content.text.match(/\b((?:CASE|WH|MT103|XML|CSV|INVCASE|TEXT)-[A-Za-z0-9._-]+)\b/i)
			if (m) caseId = m[1]
		}
	}

	const availableTools = input.tools ?? []

	// If human rejected finalize_settlement_action with steering instructions, re-invoke it once with CLOSE_CLEAN + note
	if (rejectedOverrideNote && availableTools.some((t) => t.name === "finalize_settlement_action")) {
		const alreadyApplied = items.some(
			(it) =>
				it instanceof FunctionCallItem &&
				it.name === "finalize_settlement_action" &&
				it.args.includes("humanOverrideNote"),
		)
		if (!alreadyApplied) {
			return {
				items: [
					FunctionCallItem.rehydrate({
						callId: `demo-override-${Date.now()}`,
						name: "finalize_settlement_action",
						args: JSON.stringify({
							caseId,
							actionType: "CLOSE_CLEAN",
							humanOverrideNote: rejectedOverrideNote,
						}),
					}),
				],
				tokenUsage: undefined,
				rowResponse: { demo: true },
			}
		}
	}

	const nextTool = availableTools.find((t) => !calledNames.has(t.name))

	// Check which sequence of tools belongs to this agent turn
	if (nextTool) {
		const argsMap: Record<string, Record<string, unknown>> = {
			get_invoice_record: { caseId },
			verify_invoice_line_items: { caseId },
			validate_iban_bic_format: { caseId },
			compute_tax_withholding: { caseId },
			evaluate_fee_clause: { caseId },
			fetch_ecb_mid_market_rate: { caseId },
			normalize_currency_amount: { caseId },
			compute_fx_spread_minor: { caseId },
			benchmark_corridor_fees: { caseId },
			parse_wire_record: { caseId },
			detect_repair_and_lifting_fees: { caseId },
			match_orphan_wire: { caseId },
			reconcile_split_payments: { caseId },
			scan_duplicate_wires: { caseId },
			check_vendor_bank_change: { caseId },
			screen_corridor_compliance: { caseId },
			verify_settlement_balance: { caseId },
			verify_citations_integrity: { caseId },
			simulate_corridor_replay: { caseId },
			finalize_settlement_action: {
				caseId,
				actionType: rejectedOverrideNote ? "CLOSE_CLEAN" : "AUTO_FROM_AUDIT",
			},
		}

		// If operator rejected once and finalize_settlement_action was already attempted, re-verify balance first
		const callArgs = argsMap[nextTool.name] ?? { caseId }
		return {
			items: [
				FunctionCallItem.rehydrate({
					callId: `demo-call-${calledNames.size + 1}-${Date.now()}`,
					name: nextTool.name,
					args: JSON.stringify(callArgs),
				}),
			],
			tokenUsage: undefined,
			rowResponse: { demo: true },
		}
	}

	// Summarize using actual tool outputs from context
	const toolOutputs: string[] = []
	for (const item of items) {
		if (item instanceof FunctionCallOutputItem) {
			try {
				const parsed = JSON.parse(item.output.text) as { summary?: string; verdict?: { plainEnglishSummary?: string } }
				if (parsed.verdict?.plainEnglishSummary) toolOutputs.push(parsed.verdict.plainEnglishSummary)
				else if (parsed.summary) toolOutputs.push(parsed.summary)
			} catch {
				// ignore
			}
		}
	}

	const summary =
		toolOutputs.at(-1) ||
		`Completed deterministic forensic tool verification for ${caseId} with grounded SourceRefs.`

	return {
		items: [ModelMessageItem.rehydrate({ text: summary })],
		tokenUsage: undefined,
		rowResponse: { demo: true },
	}
}

export class DynamicEndpointRouter implements InferenceRunner {
	private config: ActiveProviderConfig
	private readonly semaphore: AsyncSemaphore

	constructor(initialConfig: ActiveProviderConfig, maxConcurrent = 3) {
		this.config = initialConfig
		this.semaphore = new AsyncSemaphore(Math.max(1, maxConcurrent))
	}

	getConfig(): ActiveProviderConfig {
		return { ...this.config }
	}

	getPublicStatus(): {
		provider: ProviderId
		label: string
		modelName: string
		hasKey: boolean
		mode: "live" | "demo"
	} {
		return {
			provider: this.config.provider,
			label: PROVIDER_DEFAULTS[this.config.provider].label,
			modelName: this.config.modelName,
			hasKey: Boolean(this.config.apiKey || this.config.provider === "ollama"),
			mode: this.config.provider === "demo" ? "demo" : "live",
		}
	}

	updateConfig(next: { provider: ProviderId; modelName?: string; apiKey?: string; baseURL?: string }): void {
		const defaults = PROVIDER_DEFAULTS[next.provider]
		const envKey = defaults.envVar ? process.env[defaults.envVar]?.trim() : undefined
		const resolvedKey =
			next.provider === "demo"
				? undefined
				: next.apiKey?.trim() ||
					(next.provider === this.config.provider ? this.config.apiKey : undefined) ||
					envKey ||
					(next.provider === "ollama" ? "ollama-local" : undefined)

		this.config = {
			provider: next.provider,
			modelName: next.modelName?.trim() || defaults.defaultModel,
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
		if (this.config.provider === "demo") {
			await sleep(220)
			return runDemoDeterministicTurn(request)
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
		if (this.config.provider === "demo") {
			await sleep(180)
			const output = runDemoDeterministicTurn(request)
			const textItem = output.items.find((i): i is ModelMessageItem => i instanceof ModelMessageItem)
			if (textItem) {
				const words = textItem.content.text.split(/(\s+)/)
				for (let i = 0; i < words.length; i += 4) {
					const chunk = words.slice(i, i + 4).join("")
					yield SemanticEvent.create("response.output_text.delta", this.config.modelName, {
						delta: chunk,
					})
					await sleep(18)
				}
			}
			yield SemanticEvent.create("inference.output", this.config.modelName, output)
			return
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
		if (this.config.provider === "demo") {
			return { ok: true, message: "Deterministic Demo Runner ready (offline-safe).", latencyMs: 1 }
		}
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
