import { NextResponse } from "next/server"
import { initCorridorOrchestrator } from "@/runtime/orchestrator"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST() {
	const orchestrator = initCorridorOrchestrator()
	const result = await orchestrator.router.testConnection()
	return NextResponse.json(result)
}
