import assert from "node:assert/strict"
import test from "node:test"
import { startCorridorServer } from "../src/server/app"

test("HTTP server streams 6-case batch, pauses at Mozaik breakpoint, approves claim, and serves reports", async () => {
	const prevProvider = process.env.LLM_PROVIDER
	process.env.LLM_PROVIDER = "demo"

	const { server, url, orchestrator } = await startCorridorServer(0)
	orchestrator.state.autoApproveBreakpoints = false

	try {
		const health = (await (await fetch(`${url}/api/health`)).json()) as {
			ok: boolean
			provider: { mode: string }
		}
		assert.equal(health.ok, true)
		assert.equal(health.provider.mode, "demo")

		const sample = (await (await fetch(`${url}/api/scenarios/sample`)).json()) as {
			cases: Array<{ caseId: string }>
		}
		const case2 = sample.cases.find((c) => c.caseId === "CASE-002")
		assert.ok(case2)

		// Trigger CASE-002 via webhook so Mozaik runs specialists concurrently then pauses at OUR gate
		const whRes = await fetch(`${url}/api/webhooks/inbound`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(case2),
		})
		assert.equal(whRes.status, 202)

		// Poll /api/history briefly until CASE-002 hits the SettlementGateInterceptionHandler pause
		let paused = false
		for (let i = 0; i < 40; i++) {
			const h = (await (await fetch(`${url}/api/history`)).json()) as {
				pendingApprovals?: Array<{ caseId: string }>
			}
			if (h.pendingApprovals?.some((p) => p.caseId === "CASE-002")) {
				paused = true
				break
			}
			await new Promise((r) => setTimeout(r, 150))
		}
		assert.equal(paused, true, "Expected CASE-002 to pause at Mozaik InterceptionHandler breakpoint")

		// Approve the breakpoint claim via REST API
		const approveRes = await fetch(`${url}/api/breakpoints/CASE-002/resolve`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ decision: "approve" }),
		})
		assert.equal(approveRes.status, 200)

		// Wait until CASE-002 finishes and publishes verified AuditVerdict + dispute letter
		type VerdictShape = {
			caseId: string
			status: string
			numbers: { recoverableFeeMinor: number; unexplainedVarianceMinor: number }
		}
		let finishedVerdict: VerdictShape | undefined
		for (let i = 0; i < 40; i++) {
			const h = (await (await fetch(`${url}/api/history`)).json()) as {
				verdicts?: VerdictShape[]
			}
			finishedVerdict = h.verdicts?.find((v) => v.caseId === "CASE-002")
			if (finishedVerdict) break
			await new Promise((r) => setTimeout(r, 150))
		}
		assert.ok(finishedVerdict, "Expected CASE-002 AuditVerdict after human approval")
		assert.equal(finishedVerdict.status, "RECOVERABLE_FEE_VIOLATION")
		assert.equal(finishedVerdict.numbers.recoverableFeeMinor, 4500)
		assert.equal(finishedVerdict.numbers.unexplainedVarianceMinor, 0)

		// Verify downloadable dispute letter (.txt) & JSON report endpoints
		const txt = await (await fetch(`${url}/api/report/CASE-002?format=txt`)).text()
		assert.ok(txt.includes("INV-2041"))
		assert.ok(txt.includes("$45.00"))
	} finally {
		if (prevProvider === undefined) delete process.env.LLM_PROVIDER
		else process.env.LLM_PROVIDER = prevProvider
		server.closeAllConnections?.()
		server.close()
	}
})
