import { NextResponse } from "next/server"
import { BUILD_PROVENANCE } from "@/core/build-info"
import { initCorridorOrchestrator } from "@/runtime/orchestrator"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const HELP = [
	"CorridorAudit application console — commands run against the in-process Mozaik runtime.",
	"  help                  Show available commands",
	"  status                Show queue, provider, gate, and release status",
	"  cases                 List loaded and completed cases",
	"  inspect <caseId>      Show current case verdict and progress",
	"  gate risk|step        Set risk-only or every-tool review mode",
	"  clear                 Clear this console (local UI command)",
]

function text(value: unknown): string {
	return typeof value === "string" ? value.trim() : ""
}

export async function POST(request: Request) {
	try {
		const body = (await request.json()) as { command?: unknown }
		const command = text(body.command)
		if (!command || command.length > 160) {
			return NextResponse.json({ ok: false, output: ["Enter a command (maximum 160 characters)."] }, { status: 400 })
		}

		const [verb, ...args] = command.split(/\s+/)
		const orchestrator = initCorridorOrchestrator()
		const { state, router } = orchestrator

		if (verb.toLowerCase() === "help" && args.length === 0) {
			return NextResponse.json({ ok: true, output: HELP })
		}

		if (verb.toLowerCase() === "status" && args.length === 0) {
			const p = router.getPublicStatus()
			return NextResponse.json({
				ok: true,
				output: [
					`CorridorAudit v${BUILD_PROVENANCE.appVersion} · ${BUILD_PROVENANCE.sourceRevision} · ${BUILD_PROVENANCE.workingTree} tree`,
					`Runtime: Mozaik @mozaik-ai/core 6.0.0 · provider ${p.label} (${p.mode}) · model ${p.modelName}`,
					`Queue: ${state.queueStats.waiting} waiting · ${state.queueStats.active} active · ${state.queueStats.done} done · ${state.queueStats.failed} failed`,
					`Review gate: ${state.breakpointMode === "risk_only" ? "risk only" : "every tool"} · cases in memory: ${state.casesById.size}`,
				],
			})
		}

		if (verb.toLowerCase() === "cases" && args.length === 0) {
			const rows = [...state.casesById.values()].reverse().map((c) => {
				const verdict = state.auditByCaseId.get(c.caseId)
				const pending = state.pendingApprovals.has(c.caseId)
				return `${c.caseId}  ${pending ? "WAITING FOR REVIEW" : verdict?.status ?? "IN PROGRESS"}  ${c.title}`
			})
			return NextResponse.json({ ok: true, output: rows.length ? rows : ["No cases are loaded. Upload a source file or send a webhook to start an audit."] })
		}

		if (verb.toLowerCase() === "gate" && args.length === 1 && ["risk", "step"].includes(args[0].toLowerCase())) {
			state.breakpointMode = args[0].toLowerCase() === "step" ? "step_tool" : "risk_only"
			return NextResponse.json({ ok: true, breakpointMode: state.breakpointMode, output: [`Review gate set to ${state.breakpointMode === "risk_only" ? "risk only" : "every tool"}.`] })
		}

		if (verb.toLowerCase() === "inspect" && args.length === 1) {
			const caseId = args[0].toUpperCase()
			const c = state.casesById.get(caseId)
			if (!c) return NextResponse.json({ ok: false, output: [`Case ${caseId} is not loaded in this server session.`] }, { status: 404 })
			const verdict = state.auditByCaseId.get(caseId)
			const agentNames = [...(state.findingsByRole.get(caseId) ?? [])]
			return NextResponse.json({
				ok: true,
				output: [
					`${caseId} · ${c.title}`,
					`Corridor: ${c.invoice?.expectedAmount.currency ?? c.wire.instructedAmount?.currency ?? "—"} → ${c.wire.settledAmount.currency}`,
					`Specialists complete: ${agentNames.length ? agentNames.join(", ") : "none yet"}`,
					verdict ? `Verdict: ${verdict.status} · ${verdict.plainEnglishSummary}` : state.pendingApprovals.has(caseId) ? "Status: paused at human review gate." : "Status: in progress; no final verdict yet.",
				],
				verdict,
			})
		}

		return NextResponse.json({ ok: false, output: [`Unknown command: ${command}. Enter help for supported commands.`] }, { status: 400 })
	} catch (err) {
		return NextResponse.json({ ok: false, output: [err instanceof Error ? err.message : String(err)] }, { status: 400 })
	}
}
