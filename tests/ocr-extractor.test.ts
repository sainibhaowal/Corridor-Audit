import test from "node:test"
import assert from "node:assert/strict"
import {
	detectImageMimeType,
	extractTextWithOcrFallback,
	isImageFilename,
	isVisionCapableModel,
} from "../src/core/parsers/ocr-extractor"

test("vision capability detection distinguishes VL/multimodal models from text-only models", () => {
	assert.equal(isImageFilename("receipt.png"), true)
	assert.equal(isImageFilename("statement.JPG"), true)
	assert.equal(isImageFilename("invoice.pdf"), false)

	assert.equal(
		isVisionCapableModel({
			provider: "nvidia",
			modelName: "nvidia/nemotron-3.5-super-vl-120b-a12b",
			apiKey: "nvapi-test",
			autoDetectedFromEnv: false,
		}),
		true,
	)
	assert.equal(
		isVisionCapableModel({
			provider: "gemini",
			modelName: "gemini-2.5-flash",
			apiKey: "AIza-test",
			autoDetectedFromEnv: false,
		}),
		true,
	)
	assert.equal(
		isVisionCapableModel({
			provider: "groq",
			modelName: "llama-3.3-70b-versatile",
			apiKey: "gsk-test",
			autoDetectedFromEnv: false,
		}),
		false,
	)
})

test("hybrid OCR uses Vision LLM when capable and falls back to tesseract OCR on failure or text-only models", async () => {
	const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])
	assert.equal(detectImageMimeType("scan.bin", pngHeader), "image/png")

	// 1. Vision succeeds
	const res1 = await extractTextWithOcrFallback({
		buffer: pngHeader,
		mimeType: "image/png",
		providerConfig: {
			provider: "nvidia",
			modelName: "nvidia/nemotron-3.5-super-vl-120b-a12b",
			apiKey: "nvapi-test",
			autoDetectedFromEnv: false,
		},
		runVision: async () => "INVOICE INV-500 EUR 5000.00 :71A:OUR",
		runTesseract: async () => {
			throw new Error("should not call tesseract when vision succeeds")
		},
	})
	assert.equal(res1.method, "vision_llm")
	assert.match(res1.text, /INV-500/)

	// 2. Vision fails -> automatic fallback to tesseract.js
	const res2 = await extractTextWithOcrFallback({
		buffer: pngHeader,
		mimeType: "image/png",
		providerConfig: {
			provider: "nvidia",
			modelName: "nvidia/nemotron-3.5-super-vl-120b-a12b",
			apiKey: "nvapi-test",
			autoDetectedFromEnv: false,
		},
		runVision: async () => {
			throw new Error("Vision endpoint timeout")
		},
		runTesseract: async () => "OCR INV-501 USD 2100.00 SHA",
	})
	assert.equal(res2.method, "tesseract_ocr")
	assert.match(res2.fallbackReason || "", /Vision endpoint timeout/)
	assert.match(res2.text, /INV-501/)

	// 3. Text-only model -> goes directly to tesseract.js
	const res3 = await extractTextWithOcrFallback({
		buffer: pngHeader,
		mimeType: "image/png",
		providerConfig: {
			provider: "groq",
			modelName: "llama-3.3-70b-versatile",
			apiKey: "gsk-test",
			autoDetectedFromEnv: false,
		},
		runVision: async () => {
			throw new Error("should not call vision for text-only model")
		},
		runTesseract: async () => "OCR INV-502 EUR 900.00",
	})
	assert.equal(res3.method, "tesseract_ocr")
	assert.match(res3.fallbackReason || "", /does not advertise vision capability/)
	assert.match(res3.text, /INV-502/)
})
