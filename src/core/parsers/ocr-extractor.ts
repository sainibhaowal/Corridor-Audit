import { PROVIDER_DEFAULTS, type ActiveProviderConfig } from "../llm/providers"

export type OcrMethod = "vision_llm" | "tesseract_ocr"

export interface OcrExtractionResult {
	text: string
	method: OcrMethod
	modelUsed?: string
	fallbackReason?: string
}

export function isImageFilename(filename: string): boolean {
	return /\.(png|jpe?g|webp)$/i.test(filename)
}

export function detectImageMimeType(filename: string, buffer?: Buffer): string {
	if (buffer && buffer.length >= 4) {
		if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png"
		if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg"
		if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
			return "image/webp"
		}
	}
	const lower = filename.toLowerCase()
	if (lower.endsWith(".png")) return "image/png"
	if (lower.endsWith(".webp")) return "image/webp"
	return "image/jpeg"
}

export function isVisionCapableModel(config?: ActiveProviderConfig): boolean {
	if (!config) return false
	if (!config.apiKey && config.provider !== "ollama") return false
	const model = (config.modelName || "").toLowerCase()
	if (config.provider === "gemini") return /gemini-(1\.5|2\.|3\.)/.test(model) || model.includes("vision")
	if (config.provider === "openai") return /gpt-(4o|4\.1|4\.5|5)|^o[134]|vision/.test(model)
	if (config.provider === "anthropic") return /claude-(3|sonnet-4|haiku-4|opus-4)/.test(model)
	return /(-vl|vl-|vision|nemotron-3\.5|pixtral|llava|qwen2\.?5?-vl|gemma-3|llama-3\.2-(11b|90b)|llama-4)/.test(model)
}

const OCR_SYSTEM_PROMPT =
	"You are a precision financial document transcriber. Transcribe ALL visible text, numbers, currency codes, IBANs, BICs, SWIFT tags (:20:, :32A:, :71A:, :71F:, :71G:), dates, fees, and counterparties verbatim. Do NOT calculate, summarize, or invent missing figures."

export async function extractTextViaVisionLlm(params: {
	buffer: Buffer
	mimeType: string
	config: ActiveProviderConfig
}): Promise<string> {
	const { buffer, mimeType, config } = params
	const base64 = buffer.toString("base64")
	const baseURL = (config.baseURL || PROVIDER_DEFAULTS[config.provider]?.baseURL || "").replace(/\/+$/, "")
	const signal = AbortSignal.timeout(20_000)

	if (config.provider === "gemini") {
		const url = `${baseURL}/models/${encodeURIComponent(config.modelName)}:generateContent?key=${encodeURIComponent(config.apiKey || "")}`
		const res = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				contents: [
					{
						parts: [
							{ text: OCR_SYSTEM_PROMPT },
							{ inline_data: { mime_type: mimeType, data: base64 } },
						],
					},
				],
			}),
			signal,
		})
		if (!res.ok) throw new Error(`Gemini Vision HTTP ${res.status}`)
		const json = (await res.json()) as {
			candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
		}
		const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("\n").trim() || ""
		if (!text) throw new Error("Gemini Vision returned empty text.")
		return text
	}

	if (config.provider === "anthropic") {
		const res = await fetch(`${baseURL}/messages`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": config.apiKey || "",
				"anthropic-version": "2023-06-01",
			},
			body: JSON.stringify({
				model: config.modelName,
				max_tokens: 2048,
				messages: [
					{
						role: "user",
						content: [
							{ type: "text", text: OCR_SYSTEM_PROMPT },
							{ type: "image", source: { type: "base64", media_type: mimeType, data: base64 } },
						],
					},
				],
			}),
			signal,
		})
		if (!res.ok) throw new Error(`Anthropic Vision HTTP ${res.status}`)
		const json = (await res.json()) as { content?: Array<{ type?: string; text?: string }> }
		const text = json.content?.filter((c) => c.type === "text").map((c) => c.text || "").join("\n").trim() || ""
		if (!text) throw new Error("Anthropic Vision returned empty text.")
		return text
	}

	// OpenAI-compatible (NVIDIA NIM, OpenAI, OpenRouter, Groq, Ollama)
	const headers: Record<string, string> = { "Content-Type": "application/json" }
	if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`
	const res = await fetch(`${baseURL}/chat/completions`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			model: config.modelName,
			max_tokens: 2048,
			temperature: 0,
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: OCR_SYSTEM_PROMPT },
						{ type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
					],
				},
			],
		}),
		signal,
	})
	if (!res.ok) throw new Error(`Vision API HTTP ${res.status}`)
	const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
	const text = json.choices?.[0]?.message?.content?.trim() || ""
	if (!text) throw new Error("Vision API returned empty text.")
	return text
}

export async function extractTextViaTesseract(buffer: Buffer): Promise<string> {
	const { createWorker } = await import("tesseract.js")
	const worker = await createWorker("eng")
	try {
		const result = await worker.recognize(buffer)
		const text = result.data.text?.trim() || ""
		if (!text) throw new Error("Local OCR (tesseract.js) found no readable text in the uploaded image.")
		return text
	} finally {
		await worker.terminate()
	}
}

export async function extractTextWithOcrFallback(params: {
	buffer: Buffer
	mimeType: string
	providerConfig?: ActiveProviderConfig
	runVision?: (input: { buffer: Buffer; mimeType: string; config: ActiveProviderConfig }) => Promise<string>
	runTesseract?: (buffer: Buffer) => Promise<string>
}): Promise<OcrExtractionResult> {
	const { buffer, mimeType, providerConfig } = params
	const visionRunner = params.runVision ?? extractTextViaVisionLlm
	const tesseractRunner = params.runTesseract ?? extractTextViaTesseract

	let fallbackReason: string | undefined
	if (providerConfig && isVisionCapableModel(providerConfig)) {
		try {
			const visionText = await visionRunner({ buffer, mimeType, config: providerConfig })
			if (visionText.trim().length > 0) {
				return {
					text: visionText.trim(),
					method: "vision_llm",
					modelUsed: `${providerConfig.provider}:${providerConfig.modelName}`,
				}
			}
			fallbackReason = "Vision model returned empty output"
		} catch (err) {
			fallbackReason = err instanceof Error ? err.message : String(err)
		}
	} else {
		fallbackReason = providerConfig
			? `Configured model (${providerConfig.provider}:${providerConfig.modelName}) does not advertise vision capability`
			: "No Vision LLM configured"
	}

	const ocrText = await tesseractRunner(buffer)
	return {
		text: ocrText.trim(),
		method: "tesseract_ocr",
		fallbackReason,
	}
}
