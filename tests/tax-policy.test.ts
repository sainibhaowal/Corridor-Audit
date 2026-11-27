import assert from "node:assert/strict"
import test from "node:test"
import { resolveWithholdingPolicy } from "../src/core/policies/tax-profile"

test("explicit invoice withholding rate takes precedence over workspace profile", () => {
	assert.deepEqual(resolveWithholdingPolicy({
		invoiceRateBps: 0,
		workspaceRateBps: 1500,
		taxCountry: "de",
	}), { rateBps: 0, source: "invoice", taxCountry: "DE" })
})

test("missing invoice rate uses the configured workspace rate and records its country", () => {
	assert.deepEqual(resolveWithholdingPolicy({
		workspaceRateBps: 1500,
		taxCountry: "de",
	}), { rateBps: 1500, source: "workspace_profile", taxCountry: "DE" })
})

test("invalid tax profile values are rejected", () => {
	assert.throws(() => resolveWithholdingPolicy({ workspaceRateBps: 10_001, taxCountry: "DE" }))
	assert.throws(() => resolveWithholdingPolicy({ workspaceRateBps: 100, taxCountry: "Germany" }))
})
