import { NextResponse } from "next/server"
import { initCorridorOrchestrator } from "@/runtime/orchestrator"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
	const orchestrator = initCorridorOrchestrator()
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

	return NextResponse.json({
		verdicts,
		cases,
		ledgerEvents: orchestrator.state.ledgerEvents,
		queueStats: orchestrator.state.queueStats,
		pendingApprovals: [...orchestrator.state.pendingApprovals.values()].map(
			({ resolve: _r, ...rest }) => rest,
		),
	})
}
