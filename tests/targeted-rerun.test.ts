import test from "node:test"
import assert from "node:assert/strict"
import { CorridorState } from "../src/runtime/corridor-runtime"
import type { SettlementCase, TermsAssessment, WireAssessment } from "../src/core/types"

test("requestSpecialistRerun clears only the targeted role, preserves other specialists, and caps at 2 reruns", () => {
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
	const r1 = state.requestSpecialistRerun("MT103-RERUN-1", "wire")
	assert.deepEqual(r1, { allowed: true, attempt: 1 })
	assert.equal(state.wireByCaseId.has("MT103-RERUN-1"), false)
	assert.equal(state.findingsByRole.get("MT103-RERUN-1")?.has("wire"), false)
	// Terms specialist stays intact!
	assert.equal(state.termsByCaseId.has("MT103-RERUN-1"), true)
	assert.equal(state.findingsByRole.get("MT103-RERUN-1")?.has("terms"), true)

	// 2nd rerun of wire
	const r2 = state.requestSpecialistRerun("MT103-RERUN-1", "wire")
	assert.deepEqual(r2, { allowed: true, attempt: 2 })

	// 3rd rerun blocked by loop guard
	const r3 = state.requestSpecialistRerun("MT103-RERUN-1", "wire")
	assert.deepEqual(r3, { allowed: false, attempt: 2 })
})
