import { existsSync, mkdirSync, readFileSync, watch } from "node:fs"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { extname, join, resolve } from "node:path"
import { normalizeInboundPayloadToCases, type UploadPayload } from "../core/ingest/normalize-upload"
import type { ProviderId } from "../core/llm/providers"
import type { SettlementCase } from "../core/types"
import { initCorridorOrchestrator } from "../runtime/orchestrator"

const PUBLIC_DIR = resolve(process.cwd(), "src/server/public")

const MIME_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".svg": "image/svg+xml",
	".json": "application/json; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
	const json = JSON.stringify(body)
	res.writeHead(statusCode, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
	})
	res.end(json)
}

async function readBody(req: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = []
	for await (const chunk of req) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
	}
	return Buffer.concat(chunks).toString("utf8")
}

export async function startCorridorServer(port = Number(process.env.PORT || "3000")) {
	const orchestrator = initCorridorOrchestrator({
		autoApprove: process.env.AUTO_APPROVE_BREAKPOINTS === "true",
	})
	const sseClients = new Set<ServerResponse>()

	orchestrator.state.subscribers.add((evt) => {
		const payload = `data: ${JSON.stringify({ event: evt, queueStats: orchestrator.state.queueStats })}\n\n`
		for (const client of sseClients) {
			try {
				client.write(payload)
			} catch {
				sseClients.delete(client)
			}
		}
	})

	// Optional Hot Folder watcher (./data/inbox)
	const hotFolder = process.env.HOT_FOLDER
		? resolve(process.cwd(), process.env.HOT_FOLDER)
		: resolve(process.cwd(), "data/inbox")
	if (!existsSync(hotFolder)) mkdirSync(hotFolder, { recursive: true })
	const seenFiles = new Set<string>()
	let watcher: ReturnType<typeof watch> | null = null
	try {
		watcher = watch(hotFolder, (_eventType, filename) => {
			if (!filename || seenFiles.has(filename)) return
			const fullPath = join(hotFolder, filename)
			if (!existsSync(fullPath)) return
			seenFiles.add(filename)
			setTimeout(() => {
				try {
					const ext = extname(filename).toLowerCase()
					const buf = readFileSync(fullPath)
					const cases = normalizeInboundPayloadToCases(
						ext === ".pdf"
							? { filename, base64: buf.toString("base64"), format: "pdf" }
							: { filename, content: buf.toString("utf8"), format: "auto" },
					)
					void orchestrator.enqueueBatch(cases)
				} catch {
					// ignore transient partial write errors
				}
			}, 250)
		})
	} catch {
		// watch optional on restricted filesystems
	}

	const server = createServer(async (req, res) => {
		const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`)
		const pathname = url.pathname
		const method = req.method || "GET"

		try {
			// SSE Stream
			if (method === "GET" && pathname === "/api/events") {
				res.writeHead(200, {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					Connection: "keep-alive",
				})
				res.write(
					`data: ${JSON.stringify({
						snapshot: {
							queueStats: orchestrator.state.queueStats,
							provider: orchestrator.router.getPublicStatus(),
							breakpointMode: orchestrator.state.breakpointMode,
							pendingApprovals: [...orchestrator.state.pendingApprovals.values()].map(
								({ resolve: _r, ...rest }) => rest,
							),
						},
					})}\n\n`,
				)
				sseClients.add(res)
				req.on("close", () => sseClients.delete(res))
				return
			}

			// Health & active settings (never exposes API keys)
			if (method === "GET" && pathname === "/api/health") {
				sendJson(res, 200, {
					ok: true,
					runtime: "Mozaik @mozaik-ai/core@6.0.0",
					provider: orchestrator.router.getPublicStatus(),
					breakpointMode: orchestrator.state.breakpointMode,
					queueStats: orchestrator.state.queueStats,
					hotFolder,
				})
				return
			}

			// Update provider settings or Mozaik breakpoint mode in memory
			if (method === "POST" && pathname === "/api/settings/provider") {
				const body = JSON.parse(await readBody(req)) as {
					provider?: ProviderId
					modelName?: string
					apiKey?: string
					baseURL?: string
					breakpointMode?: "risk_only" | "step_tool"
				}
				if (body.provider) {
					orchestrator.router.updateConfig({
						provider: body.provider,
						modelName: body.modelName,
						apiKey: body.apiKey,
						baseURL: body.baseURL,
					})
				}
				if (body.breakpointMode === "risk_only" || body.breakpointMode === "step_tool") {
					orchestrator.state.breakpointMode = body.breakpointMode
				}
				sendJson(res, 200, {
					ok: true,
					provider: orchestrator.router.getPublicStatus(),
					breakpointMode: orchestrator.state.breakpointMode,
				})
				return
			}

			if (method === "POST" && pathname === "/api/settings/test") {
				const result = await orchestrator.router.testConnection()
				sendJson(res, 200, result)
				return
			}

			// Stream bundled 6-case realistic synthetic batch
			if (method === "POST" && pathname === "/api/scenarios/stream") {
				const cases = orchestrator.loadBundledCases()
				void orchestrator.enqueueBatch(cases)
				sendJson(res, 202, {
					ok: true,
					queuedCount: cases.length,
					caseIds: cases.map((c) => c.caseId),
				})
				return
			}

			// Live Webhook Ingestion
			if (method === "POST" && pathname === "/api/webhooks/inbound") {
				const raw = await readBody(req)
				const cases = normalizeInboundPayloadToCases({ content: raw, format: "json" })
				void orchestrator.enqueueBatch(cases)
				sendJson(res, 202, {
					ok: true,
					queuedCount: cases.length,
					caseIds: cases.map((c) => c.caseId),
				})
				return
			}

			// Multi-format upload / raw paste (.csv, .txt MT103, .xml camt.053, .pdf base64, .json, raw text)
			if (method === "POST" && pathname === "/api/audit/upload") {
				const body = JSON.parse(await readBody(req)) as UploadPayload
				const cases = normalizeInboundPayloadToCases(body)
				void orchestrator.enqueueBatch(cases)
				sendJson(res, 202, {
					ok: true,
					queuedCount: cases.length,
					caseIds: cases.map((c) => c.caseId),
				})
				return
			}

			// Interruptible Mozaik Breakpoint Gate Decision
			const bpMatch = pathname.match(/^\/api\/breakpoints\/([^/]+)\/resolve$/)
			if (method === "POST" && bpMatch) {
				const caseId = decodeURIComponent(bpMatch[1])
				const body = JSON.parse(await readBody(req)) as {
					decision: "approve" | "reject" | "stop"
					reason?: string
				}
				const pending = orchestrator.state.pendingApprovals.get(caseId)
				if (!pending) {
					sendJson(res, 404, { error: `No paused breakpoint active for ${caseId}` })
					return
				}
				pending.resolve({ decision: body.decision, reason: body.reason })
				sendJson(res, 200, { ok: true, caseId, decision: body.decision })
				return
			}

			// Full History, Artifacts, Trajectory, Technical State & Ledger
			if (method === "GET" && pathname === "/api/history") {
				const verdicts = [...orchestrator.state.auditByCaseId.values()].reverse()
				const cases = [...orchestrator.state.casesById.values()].map((c) => ({
					caseId: c.caseId,
					title: c.title,
					channelLabel: c.channelLabel,
					corridor: `${c.invoice?.expectedAmount.currency ?? c.wire.instructedAmount?.currency ?? "USD"} → ${c.wire.settledAmount.currency}`,
					rawCase: c,
					terms: orchestrator.state.termsByCaseId.get(c.caseId) ?? null,
					fx: orchestrator.state.fxByCaseId.get(c.caseId) ?? null,
					wire: orchestrator.state.wireByCaseId.get(c.caseId) ?? null,
					anomaly: orchestrator.state.anomalyByCaseId.get(c.caseId) ?? null,
					verdict: orchestrator.state.auditByCaseId.get(c.caseId) ?? null,
					trajectory: orchestrator.state.trajectoryByCaseId.get(c.caseId) ?? [],
				}))

				sendJson(res, 200, {
					verdicts,
					cases,
					ledgerEvents: orchestrator.state.ledgerEvents,
					queueStats: orchestrator.state.queueStats,
					pendingApprovals: [...orchestrator.state.pendingApprovals.values()].map(
						({ resolve: _r, ...rest }) => rest,
					),
				})
				return
			}

			// Downloadable Dispute Letter (.txt) or Full JSON Report
			const repMatch = pathname.match(/^\/api\/report\/([^/]+)$/)
			if (method === "GET" && repMatch) {
				const caseId = decodeURIComponent(repMatch[1])
				const verdict = orchestrator.state.auditByCaseId.get(caseId)
				if (!verdict) {
					sendJson(res, 404, { error: `No completed audit report found for ${caseId}` })
					return
				}
				const fmt = url.searchParams.get("format") || "json"
				if (fmt === "txt") {
					const text =
						verdict.disputeNotice ||
						`CORRIDOR AUDIT CERTIFICATE — ${verdict.caseId}\nStatus: ${verdict.status}\nSummary: ${verdict.plainEnglishSummary}\nUnexplained Variance: ${verdict.numbers.unexplainedVarianceMinor}\n${verdict.disclaimer}`
					res.writeHead(200, {
						"Content-Type": "text/plain; charset=utf-8",
						"Content-Disposition": `attachment; filename="${caseId.toLowerCase()}-dispute-letter.txt"`,
					})
					res.end(text)
					return
				}

				const fullReport = {
					verdict,
					technical: {
						case: orchestrator.state.casesById.get(caseId),
						terms: orchestrator.state.termsByCaseId.get(caseId),
						fx: orchestrator.state.fxByCaseId.get(caseId),
						wire: orchestrator.state.wireByCaseId.get(caseId),
						anomaly: orchestrator.state.anomalyByCaseId.get(caseId),
					},
					trajectory: orchestrator.state.trajectoryByCaseId.get(caseId) ?? [],
				}
				res.writeHead(200, {
					"Content-Type": "application/json; charset=utf-8",
					"Content-Disposition": `attachment; filename="${caseId.toLowerCase()}-reconciliation-report.json"`,
				})
				res.end(JSON.stringify(fullReport, null, 2))
				return
			}

			// Serve bundled sample cases for Webhook Test button
			if (method === "GET" && pathname === "/api/scenarios/sample") {
				const list = orchestrator.loadBundledCases()
				sendJson(res, 200, { cases: list })
				return
			}

			// Static Web UI files
			const relPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "")
			if (relPath.includes("..")) {
				sendJson(res, 400, { error: "Invalid path" })
				return
			}
			const filePath = join(PUBLIC_DIR, relPath)
			if (existsSync(filePath)) {
				const content = readFileSync(filePath)
				const mime = MIME_TYPES[extname(filePath)] || "application/octet-stream"
				res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-store" })
				res.end(content)
				return
			}

			sendJson(res, 404, { error: "Not found" })
		} catch (err) {
			sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) })
		}
	})

	const host = process.env.HOST?.trim() || "127.0.0.1"
	await new Promise<void>((resolveListen) => {
		server.listen(port, host, resolveListen)
	})
	server.on("close", () => {
		watcher?.close()
		for (const client of sseClients) {
			try {
				client.end()
			} catch {
				// ignore
			}
		}
		sseClients.clear()
	})

	const addr = server.address()
	const actualPort = typeof addr === "object" && addr ? addr.port : port
	const displayHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host
	return { server, port: actualPort, url: `http://${displayHost}:${actualPort}`, orchestrator }
}
