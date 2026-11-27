import { NextResponse } from "next/server"
import { initCorridorOrchestrator } from "@/runtime/orchestrator"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
	request: Request,
	context: { params: Promise<{ caseId: string }> },
) {
	const { caseId: rawId } = await context.params
	const caseId = decodeURIComponent(rawId)
	const orchestrator = initCorridorOrchestrator()
	const verdict = orchestrator.state.auditByCaseId.get(caseId)
	if (!verdict) {
		return NextResponse.json(
			{ error: `No completed audit report found for ${caseId}` },
			{ status: 404 },
		)
	}

	const url = new URL(request.url)
	const fmt = url.searchParams.get("format") || "json"
	if (fmt === "txt") {
		const text =
			verdict.disputeNotice ||
			`CORRIDOR AUDIT CERTIFICATE - ${verdict.caseId}\nStatus: ${verdict.status}\nSummary: ${verdict.plainEnglishSummary}\nUnexplained Variance: ${verdict.numbers.unexplainedVarianceMinor}\nBuild: v${verdict.provenance.appVersion} · Source ${verdict.provenance.sourceRevision} · ${verdict.provenance.workingTree} tree · Audit rules v${verdict.provenance.auditRulesVersion}\n${verdict.disclaimer}`
		return new Response(text, {
			headers: {
				"Content-Type": "text/plain; charset=utf-8",
				"Content-Disposition": `attachment; filename="${caseId.toLowerCase()}-dispute-letter.txt"`,
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
			"Content-Disposition": `attachment; filename="${caseId.toLowerCase()}-reconciliation-report.json"`,
		},
	})
}
