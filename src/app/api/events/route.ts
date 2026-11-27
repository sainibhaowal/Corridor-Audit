import type { TrajectoryEvent } from "@/core/types"
import { authorizeCorridorRequest, isCurrentCorridorViewerSession } from "@/core/security/authorization"
import { initCorridorOrchestrator } from "@/runtime/orchestrator"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
	const denied = await authorizeCorridorRequest(request, "viewer")
	if (denied) return denied
	const orchestrator = initCorridorOrchestrator()
	const encoder = new TextEncoder()

	let cleanup: (() => void) | null = null
	let streamClosed = false
	let checkingAuthorization = false

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const writeJson = (obj: unknown) => {
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
				} catch {
					cleanup?.()
				}
			}

			writeJson({
				snapshot: {
					queueStats: orchestrator.state.queueStats,
					provider: orchestrator.router.getPublicStatus(),
					breakpointMode: orchestrator.state.breakpointMode,
					pendingApprovals: [...orchestrator.state.pendingApprovals.values()].map(
						({ resolve: _r, ...rest }) => rest,
					),
				},
			})

			const listener = (evt: TrajectoryEvent) => {
				writeJson({ event: evt, queueStats: orchestrator.state.queueStats })
			}

			orchestrator.state.subscribers.add(listener)
			const heartbeat = setInterval(() => {
				if (streamClosed || checkingAuthorization) return
				checkingAuthorization = true
				void isCurrentCorridorViewerSession(request).then((authorized) => {
					if (!authorized) {
						streamClosed = true
						cleanup?.()
						try {
							controller.close()
						} catch {
							// The client may have closed the stream while authorization was checked.
						}
						return
					}
					try {
						controller.enqueue(encoder.encode(`: keepalive\n\n`))
					} catch {
						streamClosed = true
						cleanup?.()
					}
				}).finally(() => {
					checkingAuthorization = false
				})
			}, 15_000)

			cleanup = () => {
				clearInterval(heartbeat)
				orchestrator.state.subscribers.delete(listener)
			}

			request.signal.addEventListener("abort", () => {
				streamClosed = true
				cleanup?.()
				try {
					controller.close()
				} catch {
					// ignore
				}
			})
		},
		cancel() {
			cleanup?.()
		},
	})

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
		},
	})
}
