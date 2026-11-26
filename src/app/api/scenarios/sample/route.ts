import { NextResponse } from "next/server"
import { initCorridorOrchestrator } from "@/runtime/orchestrator"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
	const orchestrator = initCorridorOrchestrator()
	return NextResponse.json({ cases: orchestrator.loadBundledCases() })
}
