import { getCorridorDb } from "@/core/db/database"
import { buildVerdictsCsv } from "@/core/reports/export-formats"
import { authorizeCorridorRequest } from "@/core/security/authorization"
import { initCorridorOrchestrator } from "@/runtime/orchestrator"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
	const denied = await authorizeCorridorRequest(request, "viewer")
	if (denied) return denied

	const orchestrator = initCorridorOrchestrator()
	const persisted = getCorridorDb().listPersistedVerdicts()
	const byId = new Map(persisted.map((v) => [v.caseId, v]))
	for (const [id, v] of orchestrator.state.auditByCaseId.entries()) {
		byId.set(id, v)
	}
	const verdicts = [...byId.values()]

	const url = new URL(request.url)
	const fmt = (url.searchParams.get("format") || "csv").toLowerCase()
	const inline = url.searchParams.get("preview") === "1"
	const dispType = inline ? "inline" : "attachment"

	if (fmt === "json") {
		return new Response(JSON.stringify({ count: verdicts.length, verdicts }, null, 2), {
			headers: {
				"Content-Type": "application/json; charset=utf-8",
				"Content-Disposition": `${dispType}; filename="corridor-audit-summary.json"`,
			},
		})
	}

	const csv = buildVerdictsCsv(verdicts)
	return new Response(csv, {
		headers: {
			"Content-Type": "text/csv; charset=utf-8",
			"Content-Disposition": `${dispType}; filename="corridor-audit-summary.csv"`,
		},
	})
}
