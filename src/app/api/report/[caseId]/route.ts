import { NextResponse } from "next/server"
import { getCorridorDb } from "@/core/db/database"
import { buildVerdictPdf, buildVerdictsCsv, buildVerdictTxt } from "@/core/reports/export-formats"
import { authorizeCorridorRequest } from "@/core/security/authorization"
import { initCorridorOrchestrator } from "@/runtime/orchestrator"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
	request: Request,
	context: { params: Promise<{ caseId: string }> },
) {
	const denied = await authorizeCorridorRequest(request, "viewer")
	if (denied) return denied
	const { caseId: rawId } = await context.params
	const caseId = decodeURIComponent(rawId)
	const orchestrator = initCorridorOrchestrator()
	const verdict =
		orchestrator.state.auditByCaseId.get(caseId) ||
		getCorridorDb()
			.listPersistedVerdicts()
			.find((item) => item.caseId === caseId)

	if (!verdict) {
		return NextResponse.json(
			{ error: `No completed audit report found for ${caseId}` },
			{ status: 404 },
		)
	}

	const url = new URL(request.url)
	const fmt = (url.searchParams.get("format") || "json").toLowerCase()
	const inline = url.searchParams.get("preview") === "1"
	const dispType = inline ? "inline" : "attachment"
	const safeSlug = caseId.toLowerCase().replace(/[^a-z0-9._-]+/g, "-")

	if (fmt === "txt") {
		const text = buildVerdictTxt(verdict)
		return new Response(text, {
			headers: {
				"Content-Type": "text/plain; charset=utf-8",
				"Content-Disposition": `${dispType}; filename="${safeSlug}-review-request-draft.txt"`,
			},
		})
	}

	if (fmt === "csv") {
		const csv = buildVerdictsCsv([verdict])
		return new Response(csv, {
			headers: {
				"Content-Type": "text/csv; charset=utf-8",
				"Content-Disposition": `${dispType}; filename="${safeSlug}-reconciliation-sheet.csv"`,
			},
		})
	}

	if (fmt === "pdf") {
		const pdfBuffer = buildVerdictPdf(verdict)
		return new Response(new Uint8Array(pdfBuffer), {
			headers: {
				"Content-Type": "application/pdf",
				"Content-Disposition": `${dispType}; filename="${safeSlug}-audit-report.pdf"`,
			},
		})
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

	return new Response(JSON.stringify(fullReport, null, 2), {
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Content-Disposition": `${dispType}; filename="${safeSlug}-reconciliation-report.json"`,
		},
	})
}
