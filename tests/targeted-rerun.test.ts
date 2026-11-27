import test from "node:test"
import assert from "node:assert/strict"
import { CorridorState } from "../src/runtime/corridor-runtime"
import type { SettlementCase, TermsAssessment, WireAssessment } from "../src/core/types"

test("requestSpecialistRerun clears only the targeted role, preserves other specialists, and tracks feedback history without a hard cap", () => {
	const state = new CorridorState()
	const sampleCase: SettlementCase = {
		caseId: "MT103-RERUN-1",
		title: "Targeted Rerun Test",
		channelLabel: "SWIFT MT103",
		settlementEvidence: "observed",
		wire: {
			wireId: "WIRE-RERUN-1",
			format: "mt103",
			valueDate: "2026-11-27",
			settledAmount: { amountMinor: 500000, currency: "USD" },
			senderCharges: [],
			receiverCharges: [],
		},
		createdAt: "2026-11-27T12:00:00.000Z",
	}

	state.registerCase(sampleCase)
	state.termsByCaseId.set("MT103-RERUN-1", {
		caseId: "MT103-RERUN-1",
		invoiceId: "INV-1",
		clauseSummary: "OUR clause",
		sourceRefs: [],
	} as unknown as TermsAssessment)
	state.wireByCaseId.set("MT103-RERUN-1", {
		caseId: "MT103-RERUN-1",
		wireId: "WIRE-RERUN-1",
		sourceRefs: [],
	} as unknown as WireAssessment)
	state.markRoleComplete("MT103-RERUN-1", "terms")
	state.markRoleComplete("MT103-RERUN-1", "wire")

	// 1st rerun of wire
	const r1 = state.requestSpecialistRerun("MT103-RERUN-1", "wire", "Check :71G: receiver fee")
	assert.deepEqual(r1, { attempt: 1, previousFeedbacks: [] })
	assert.equal(state.wireByCaseId.has("MT103-RERUN-1"), false)
	assert.equal(state.findingsByRole.get("MT103-RERUN-1")?.has("wire"), false)
	// Terms specialist stays intact!
	assert.equal(state.termsByCaseId.has("MT103-RERUN-1"), true)
	assert.equal(state.findingsByRole.get("MT103-RERUN-1")?.has("terms"), true)

	// 2nd rerun tracks previous feedback so the model decides when to stop
	const r2 = state.requestSpecialistRerun("MT103-RERUN-1", "wire", "Verify repair fee line")
	assert.deepEqual(r2, { attempt: 2, previousFeedbacks: ["Check :71G: receiver fee"] })

	// No hard limit blocks a 3rd rerun if the model genuinely needs it
	const r3 = state.requestSpecialistRerun("MT103-RERUN-1", "wire", "Final check on :71F:")
	assert.deepEqual(r3, { attempt: 3, previousFeedbacks: ["Check :71G: receiver fee", "Verify repair fee line"] })
})

test("Lead LLM dynamic delegation sets expectedRolesByCaseId on demand", () => {
	const state = new CorridorState()
	const sampleCase: SettlementCase = {
		caseId: "MT103-PLAN-1",
		title: "Dynamic Delegation Test",
		channelLabel: "SWIFT MT103",
		settlementEvidence: "observed",
		wire: {
			wireId: "WIRE-PLAN-1",
			format: "mt103",
			valueDate: "2026-11-27",
			settledAmount: { amountMinor: 500000, currency: "USD" },
			senderCharges: [],
			receiverCharges: [],
		},
		createdAt: "2026-11-27T12:00:00.000Z",
	}

	state.registerCase(sampleCase)
	// Initially empty until Lead LLM calls delegate_subagents
	assert.equal(state.expectedRolesByCaseId.get("MT103-PLAN-1")?.size, 0)

	const hired = state.delegateSubagents("MT103-PLAN-1", ["terms", "fx", "terms"])
	assert.deepEqual(hired, ["terms", "fx"])
	assert.deepEqual([...(state.expectedRolesByCaseId.get("MT103-PLAN-1") ?? [])], ["terms", "fx"])
})
