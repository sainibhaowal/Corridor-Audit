import "dotenv/config"
import { formatMoney } from "./core/money"
import { initCorridorOrchestrator } from "./runtime/orchestrator"

async function main() {
	const interactive = process.argv.includes("--interactive") && Boolean(process.stdin.isTTY)
	const orchestrator = initCorridorOrchestrator({ autoApprove: !interactive })
	const status = orchestrator.router.getPublicStatus()

	console.log("====================================================================")
	console.log(" CorridorAudit CLI — Concurrent Mozaik Settlement Forensics")
	console.log(` Provider: ${status.label} (${status.modelName}) | Mode: ${status.mode.toUpperCase()}`)
	console.log(" Synthetic & public ECB data only. Not financial or legal advice.")
	console.log("====================================================================\n")

	orchestrator.state.subscribers.add((evt) => {
		if (evt.kind === "case.queued") {
			console.log(`[MOZAIK] ${evt.text}`)
		} else if (evt.kind === "tool.completed") {
			console.log(`  ↳ [${evt.agentName}] ${evt.toolName} (${evt.durationMs ?? 1}ms)`)
		} else if (evt.kind === "agent.completed") {
			console.log(`  ✓ ${evt.agentName}: ${(evt.text || "").slice(0, 140)}`)
		}
	})

	const cases = orchestrator.loadBundledCases()
	const verdicts = await orchestrator.enqueueBatch(cases)

	console.log("\n=================== FINAL CENT-PROOF LEDGER ===================")
	for (const v of verdicts) {
		const ccy = v.numbers.settledCurrency
		console.log(
			`\n[${v.caseId}] ${v.status} | Invoice=${v.invoiceId} | Wire=${v.wireId}`,
		)
		console.log(`  Summary:    ${v.plainEnglishSummary}`)
		console.log(
			`  Accounting: ECB ${formatMoney(v.numbers.midMarketEquivalentMinor, ccy)} - FX ${formatMoney(v.numbers.fxSpreadLossMinor, ccy)} - Fees ${formatMoney(v.numbers.liftingAndRepairFeesMinor + v.numbers.platformFeeMinor, ccy)} = Landed ${formatMoney(v.numbers.settledMinor, ccy)} | Variance: ${formatMoney(v.numbers.unexplainedVarianceMinor, ccy)}`,
		)
		console.log(
			`  Recoverable OUR Fee: ${formatMoney(v.numbers.recoverableFeeMinor, ccy)} | Corridor Leak Replay: ${formatMoney(v.replay.totalLeakMinor, ccy)} (${(v.replay.totalLeakBps / 100).toFixed(2)}%)`,
		)
		console.log(
			`  Sources (${v.sourceRefs.length}): ${v.sourceRefs.map((r) => `[${r.sourceType}:${r.recordId}:${r.field}]`).join(" ")}`,
		)
	}
	console.log("\nAll 6 case audits finished. Review the verdicts above for findings.")
}

main().catch((err) => {
	console.error("CorridorAudit CLI failed:", err)
	process.exitCode = 1
})
