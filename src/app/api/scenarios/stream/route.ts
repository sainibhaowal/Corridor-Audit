import { NextResponse } from "next/server"
import { initCorridorOrchestrator } from "@/runtime/orchestrator"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST() {
	const orchestrator = initCorridorOrchestrator()
	const cases = orchestrator.loadBundledCases()
	void orchestrator.enqueueBatch(cases)
	return NextResponse.json(
		{
			ok: true,
			queuedCount: cases.length,
			caseIds: cases.map((c) => c.caseId),
		},
		{ status: 202 },
	)
}
