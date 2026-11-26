import assert from "node:assert/strict"
import test from "node:test"
import { POST as resolveBreakpointRoute } from "../src/app/api/breakpoints/[caseId]/resolve/route"
import { GET as healthRoute } from "../src/app/api/health/route"
import { GET as historyRoute } from "../src/app/api/history/route"
import { GET as reportRoute } from "../src/app/api/report/[caseId]/route"
import { GET as sampleRoute } from "../src/app/api/scenarios/sample/route"
import { POST as inboundWebhookRoute } from "../src/app/api/webhooks/inbound/route"
import { initCorridorOrchestrator } from "../src/runtime/orchestrator"

test("Next.js App Router API routes run Mozaik concurrency, pause at breakpoints, approve, reject-steer, and serve reports", async () => {
	const prevProvider = process.env.LLM_PROVIDER
	process.env.LLM_PROVIDER = "demo"

	const orchestrator = initCorridorOrchestrator({ autoApprove: false })

	try {
		const health = (await (await healthRoute()).json()) as {
			ok: boolean
			framework: string
			provider: { mode: string }
		}
		assert.equal(health.ok, true)
		assert.equal(health.provider.mode, "demo")
		assert.ok(health.framework.includes("Next.js"))

		const sample = (await (await sampleRoute()).json()) as {
			cases: Array<{ caseId: string }>
		}
		const case2 = sample.cases.find((c) => c.caseId === "CASE-002")
		assert.ok(case2)

		// 1. Trigger CASE-002 via Next App Router webhook handler -> pauses at OUR gate
		const whRes = await inboundWebhookRoute(
			new Request("http://127.0.0.1/api/webhooks/inbound", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(case2),
			}),
		)
		assert.equal(whRes.status, 202)

		let paused = false
		for (let i = 0; i < 40; i++) {
			const h = (await (await historyRoute()).json()) as {
				pendingApprovals?: Array<{ caseId: string }>
			}
			if (h.pendingApprovals?.some((p) => p.caseId === "CASE-002")) {
				paused = true
				break
			}
			await new Promise((r) => setTimeout(r, 150))
		}
		assert.equal(paused, true, "Expected CASE-002 to pause at Mozaik InterceptionHandler breakpoint")

		const approveRes = await resolveBreakpointRoute(
			new Request("http://127.0.0.1/api/breakpoints/CASE-002/resolve", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ decision: "approve" }),
			}),
			{ params: Promise.resolve({ caseId: "CASE-002" }) },
		)
		assert.equal(approveRes.status, 200)

		type VerdictShape = {
			caseId: string
			status: string
			humanOverrideNote?: string
			numbers: { recoverableFeeMinor: number; unexplainedVarianceMinor: number }
		}
		let finishedVerdict: VerdictShape | undefined
		for (let i = 0; i < 40; i++) {
			const h = (await (await historyRoute()).json()) as {
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

		const txtRes = await reportRoute(
			new Request("http://127.0.0.1/api/report/CASE-002?format=txt"),
			{ params: Promise.resolve({ caseId: "CASE-002" }) },
		)
		const txt = await txtRes.text()
		assert.ok(txt.includes("INV-2041"))
		assert.ok(txt.includes("$45.00"))

		// 2. Verify Reject & Steer overrides CASE-REJECT-TEST cleanly to CLEAN with humanOverrideNote
		const rejectCopy = { ...(case2 as object), caseId: "CASE-REJECT-TEST" }
		const rWh = await inboundWebhookRoute(
			new Request("http://127.0.0.1/api/webhooks/inbound", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(rejectCopy),
			}),
		)
		assert.equal(rWh.status, 202)

		let rejectPaused = false
		for (let i = 0; i < 40; i++) {
			const h = (await (await historyRoute()).json()) as {
				pendingApprovals?: Array<{ caseId: string }>
			}
			if (h.pendingApprovals?.some((p) => p.caseId === "CASE-REJECT-TEST")) {
				rejectPaused = true
				break
			}
			await new Promise((r) => setTimeout(r, 150))
		}
		assert.equal(rejectPaused, true, "Expected CASE-REJECT-TEST to pause at Mozaik breakpoint")

		const rejRes = await resolveBreakpointRoute(
			new Request("http://127.0.0.1/api/breakpoints/CASE-REJECT-TEST/resolve", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ decision: "reject", reason: "Approved by CFO as SHA" }),
			}),
			{ params: Promise.resolve({ caseId: "CASE-REJECT-TEST" }) },
		)
		assert.equal(rejRes.status, 200)

		let rejectedVerdict: VerdictShape | undefined
		for (let i = 0; i < 40; i++) {
			const h = (await (await historyRoute()).json()) as {
				verdicts?: VerdictShape[]
			}
			rejectedVerdict = h.verdicts?.find((v) => v.caseId === "CASE-REJECT-TEST")
			if (rejectedVerdict) break
			await new Promise((r) => setTimeout(r, 150))
		}
		assert.ok(rejectedVerdict, "Expected CASE-REJECT-TEST to finish cleanly after Reject & Steer")
		assert.equal(rejectedVerdict.status, "CLEAN")
		assert.equal(rejectedVerdict.numbers.recoverableFeeMinor, 0)
		assert.equal(rejectedVerdict.numbers.unexplainedVarianceMinor, 0)
		assert.equal(rejectedVerdict.humanOverrideNote, "Approved by CFO as SHA")
	} finally {
		orchestrator.state.pendingApprovals.clear()
		if (prevProvider === undefined) delete process.env.LLM_PROVIDER
		else process.env.LLM_PROVIDER = prevProvider
	}
})
