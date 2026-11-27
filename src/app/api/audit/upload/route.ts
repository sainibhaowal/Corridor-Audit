import { NextResponse } from "next/server"
import { z } from "zod"
import { DEFAULT_WORKSPACE_ID, getCorridorDb } from "@/core/db/database"
import { normalizeInboundPayloadToCases, type UploadPayload } from "@/core/ingest/normalize-upload"
import { readRequestTextLimited, RequestBodyTooLargeError } from "@/core/security/request-body"
import { authorizeCorridorRequest } from "@/core/security/authorization"
import { MalwareDetectedError, MalwareScannerUnavailableError, MalwareScanLimitError, scanFileBytes } from "@/core/security/malware-scan"
import { initCorridorOrchestrator } from "@/runtime/orchestrator"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const MAX_UPLOAD_REQUEST_BYTES = 14 * 1024 * 1024
const UploadPayloadSchema = z
	.object({
		filename: z.string().trim().min(1).max(255).optional(),
		content: z.string().max(14 * 1024 * 1024).optional(),
		base64: z.string().max(14 * 1024 * 1024).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/).optional(),
		format: z.enum(["auto", "json", "mt103", "csv", "xml", "pdf", "text"]).optional(),
	})
	.strict()
	.refine((body) => Boolean(body.content) !== Boolean(body.base64), {
		message: "Provide exactly one of content or base64.",
	})

export async function POST(request: Request) {
	const denied = await authorizeCorridorRequest(request, "analyst")
	if (denied) return denied
	const db = getCorridorDb()
	let ingestionId: string | undefined

	try {
		const parsedBody = UploadPayloadSchema.safeParse(JSON.parse(await readRequestTextLimited(request, MAX_UPLOAD_REQUEST_BYTES)))
		if (!parsedBody.success) {
			return NextResponse.json({ error: parsedBody.error.issues[0]?.message || "Invalid upload request." }, { status: 400 })
		}
		const body: UploadPayload = parsedBody.data
		const filename = body.filename || (body.format ? `upload.${body.format}` : "manual-paste.txt")
		const isPdfUpload = body.format === "pdf" || filename.toLowerCase().endsWith(".pdf")
		if (body.base64 && !isPdfUpload) {
			return NextResponse.json({ error: "Base64 file uploads are supported only for PDF documents." }, { status: 400 })
		}
		if (isPdfUpload && !body.base64) {
			return NextResponse.json({ error: "PDF uploads must be provided as a base64 encoded file." }, { status: 400 })
		}
		if (body.base64 && Buffer.from(body.base64, "base64").byteLength > 10 * 1024 * 1024) {
			return NextResponse.json({ error: "Decoded file exceeds the 10 MiB upload limit." }, { status: 413 })
		}
		const isBase64 = Boolean(body.base64 && !body.content)
		const rawContent = body.content || body.base64 || ""
		const format = body.format || "auto"
		const malwareScan = await scanFileBytes(Buffer.from(rawContent, isBase64 ? "base64" : "utf8"))

		if (rawContent) {
			const rec = db.saveRawIngestion({
				workspaceId: DEFAULT_WORKSPACE_ID,
				sourceChannel: "manual_upload",
				sourceProvider: "browser_upload",
				filename,
				format,
				rawContent,
				isBase64,
				metadata: { filename, format, malwareScan: malwareScan.status },
			})
			ingestionId = rec.id
		}

		const orchestrator = initCorridorOrchestrator()
		const cases = normalizeInboundPayloadToCases(body)
		if (ingestionId) {
			db.updateRawIngestionOutcome({
				id: ingestionId,
				parseStatus: "parsed",
				caseIds: cases.map((c) => c.caseId),
			})
		}

		void orchestrator.enqueueBatch(cases).catch((err) => {
			console.error(`Queued upload ${ingestionId || "without raw record"} failed during audit processing:`, err)
		})
		return NextResponse.json(
			{
				ok: true,
				ingestionId,
				queuedCount: cases.length,
				caseIds: cases.map((c) => c.caseId),
			},
			{ status: 202 },
		)
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		if (ingestionId) {
			db.updateRawIngestionOutcome({
				id: ingestionId,
				parseStatus: "failed",
				parseError: msg,
			})
		}
		const status = err instanceof RequestBodyTooLargeError || err instanceof MalwareScanLimitError ? 413 : err instanceof MalwareDetectedError ? 422 : err instanceof MalwareScannerUnavailableError ? 503 : 400
		return NextResponse.json({ error: msg, ingestionId }, { status })
	}
}
