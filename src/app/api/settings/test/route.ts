import { NextResponse } from "next/server"
import { initCorridorOrchestrator } from "@/runtime/orchestrator"
import { authorizeCorridorRequest } from "@/core/security/authorization"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
	const denied = await authorizeCorridorRequest(request, "owner")
	if (denied) return denied
	const orchestrator = initCorridorOrchestrator()
	const result = await orchestrator.router.testConnection()
	return NextResponse.json(result)
}
