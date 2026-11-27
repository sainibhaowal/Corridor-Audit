import {
	type ExecutableTransition,
	FunctionCallItem,
	FunctionCallOutputItem,
	type InferenceInput,
	type InterceptionHandler,
	ModelMessageItem,
} from "@mozaik-ai/core"
import { createInterface } from "node:readline/promises"
import { DEFAULT_WORKSPACE_ID, getCorridorDb } from "../../core/db/database"
import { formatMoney } from "../../core/money"
import { BUILD_PROVENANCE } from "../../core/build-info"
import type { AuditVerdict, PendingBreakpointDecision } from "../../core/types"
import { type BreakpointDecision, resolveRuntime } from "../corridor-runtime"
import { computeCaseAuditNumbers } from "../tools/audit-tools"
import { isHumanOverrideAuthorized } from "./human-override"

function parseArgs(raw: string): Record<string, unknown> {
	try {
		return (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>
	} catch {
		return {}
	}
}

async function promptTerminalBreakpoint(pending: PendingBreakpointDecision): Promise<BreakpointDecision> {
	const rl = createInterface({ input: process.stdin, output: process.stdout })
	try {
		console.log(`\n[MOZAIK BREAKPOINT PAUSED] ${pending.caseId} - ${pending.riskLabel}`)
		console.log(`  Question: ${pending.question}`)
		console.log(`  Proof:    ${pending.proofLine}`)
		const reply = (await rl.question("Approve [y], Reject & Steer [n], Stop [s]? ")).trim().toLowerCase()
		if (reply === "s" || reply === "stop") {
			return { decision: "stop" }
		}
		if (reply === "n" || reply === "no") {
			const reason = (await rl.question("Enter override / rejection reason: ")).trim()
			return { decision: "reject", reason: reason || "Treat fee as SHA per operator override." }
		}
		return { decision: "approve" }
	} finally {
		rl.close()
	}
}

export class SettlementGateInterceptionHandler implements InterceptionHandler {
	isSatisfiedBy(transition: ExecutableTransition): boolean {
		if (transition.nextStateId !== "function_call") return false
		const state = resolveRuntime().state
		const { call } = transition.input as { call: FunctionCallItem }

		if (state.breakpointMode === "step_tool") {
			return true
		}

		if (call.name !== "finalize_settlement_action") return false
		const args = parseArgs(call.args)
		const caseId = String(args.caseId ?? "")
		if (!caseId) return false
		const pendingHumanOverride = state.humanOverrideNotesByCaseId.get(caseId)
		if (isHumanOverrideAuthorized(pendingHumanOverride, args.humanOverrideNote)) return false

		const calc = computeCaseAuditNumbers(state, caseId)
		if (!calc) return false

		const { recoverableOurViolationMinor: recoverableMinor, varianceMinor, anomaly } = calc
		const varianceThresholdMinor = getCorridorDb().getWorkspace(DEFAULT_WORKSPACE_ID).varianceThresholdMinor

		const isRisky =
			recoverableMinor > 0 ||
			Math.abs(varianceMinor) > varianceThresholdMinor ||
			anomaly?.classification === "TRUE_DUPLICATE" ||
			Boolean(anomaly?.vendorBankChanged)

		return isRisky
	}

	async handle(transition: ExecutableTransition): Promise<ExecutableTransition> {
		const state = resolveRuntime().state
		const { call, inferenceInput } = transition.input as {
			call: FunctionCallItem
			inferenceInput: InferenceInput
		}
		const args = parseArgs(call.args)
		const caseId = String(args.caseId || [...state.casesById.keys()].at(-1) || "CASE-001")
		const calc = computeCaseAuditNumbers(state, caseId)
		const c = calc?.c ?? state.casesById.get(caseId)
		const terms = calc?.terms ?? state.termsByCaseId.get(caseId)
		const fx = calc?.fx ?? state.fxByCaseId.get(caseId)
		const wire = calc?.wire ?? state.wireByCaseId.get(caseId)
		const anomaly = calc?.anomaly ?? state.anomalyByCaseId.get(caseId)
		const currency = calc?.targetCcy ?? c?.wire.settledAmount.currency ?? "USD"
		const recoverableMinor = calc?.recoverableOurViolationMinor ?? 0
		const normalizedWithholdingTaxMinor = calc?.normalizedWithholdingTaxMinor ?? 0
		const varianceMinor = calc?.varianceMinor ?? 0

		let riskLabel = "Step Tool Debugger"
		let question = `Inspecting tool call ${call.name} before execution. Approve running it?`
		let proofLine = `Tool: ${call.name} · Args: ${call.args.slice(0, 140)}`

		if (call.name === "finalize_settlement_action") {
			if (recoverableMinor > 0) {
				riskLabel = `Medium Risk · OUR Fee Breach`
				question = `The contract says the sender pays all fees, but the bank still took a ${formatMoney(recoverableMinor, currency)} fee. Should we generate a bank refund claim?`
				proofLine = `Invoice: ${terms?.invoiceId ?? caseId} (${terms?.contractedChargeBearer ?? "OUR"}) vs Wire deduction ${formatMoney(recoverableMinor, currency)} · Ref: ${c?.wire.transactionRef ?? c?.wire.wireId ?? caseId}`
			} else if (anomaly?.classification === "TRUE_DUPLICATE") {
				riskLabel = `High Risk · Duplicate Wire`
				question = `Two identical wires (${anomaly.duplicateWireIds.join(", ")}) matched ${terms?.invoiceId}. Hold settlement and flag duplicate alert?`
				proofLine = `Duplicate wires detected within window · Amount: ${formatMoney(c?.wire.settledAmount.amountMinor ?? 0, currency)}`
			} else if (Math.abs(varianceMinor) > getCorridorDb().getWorkspace(DEFAULT_WORKSPACE_ID).varianceThresholdMinor) {
				riskLabel = `High Risk · Missing Money`
				question = `There is an unexplained ${formatMoney(varianceMinor, currency)} short-pay variance on ${terms?.invoiceId}. Escalate variance alert?`
				proofLine = `Expected ${formatMoney(fx?.midMarketExpectedMinor ?? 0, currency)} vs Net ${formatMoney(c?.wire.settledAmount.amountMinor ?? 0, currency)} · Variance: ${formatMoney(varianceMinor, currency)}`
			}
		}

		const pendingInfo: PendingBreakpointDecision = {
			caseId,
			agentName: "AuditorAgent",
			toolName: call.name,
			actionType: String(args.actionType ?? "STEP_INSPECT"),
			question,
			proofLine,
			recoverableMinor,
			currency,
			argsJson: call.args,
			riskLabel,
			createdAt: new Date().toISOString(),
		}

		let decision: BreakpointDecision
		if (state.autoApproveBreakpoints) {
			decision = { decision: "approve" }
		} else if (state.subscribers.size === 0 && process.stdin.isTTY) {
			decision = await promptTerminalBreakpoint(pendingInfo)
		} else {
			state.emitTrajectory({
				caseId,
				kind: "phase.changed",
				phase: "PHASE 3 · HUMAN GATE PAUSED",
				agentName: "AuditorAgent",
			})
			state.emitTrajectory({
				caseId,
				kind: "breakpoint.paused",
				agentName: "AuditorAgent",
				toolName: call.name,
				status: "paused",
				payload: { pending: pendingInfo },
			})

			decision = await new Promise<BreakpointDecision>((resolve) => {
				state.pendingApprovals.set(caseId, {
					...pendingInfo,
					resolve,
				})
			})
			state.pendingApprovals.delete(caseId)
		}

		state.emitTrajectory({
			caseId,
			kind: "breakpoint.resolved",
			agentName: "AuditorAgent",
			toolName: call.name,
			status: decision.decision,
			text: decision.reason,
		})

		if (decision.decision === "stop") {
			state.abortedCases.add(caseId)
			const abortedVerdict: AuditVerdict = {
				caseId,
				invoiceId: terms?.invoiceId ?? caseId,
				wireId: c?.wire.wireId ?? caseId,
				provenance: BUILD_PROVENANCE,
				status: "ABORTED_BY_OPERATOR",
				plainEnglishSummary: `Operator stopped ${caseId} cleanly at Mozaik breakpoint before finalizing action.`,
				numbers: {
					invoicedMinor: terms?.expectedGrossMinor ?? 0,
					invoicedCurrency: terms?.expectedCurrency ?? currency,
					midMarketEquivalentMinor: fx?.midMarketExpectedMinor ?? 0,
					settledMinor: c?.wire.settledAmount.amountMinor ?? 0,
					settledCurrency: currency,
					fxSpreadLossMinor: fx?.fxSpreadLossMinor ?? 0,
					fxSpreadBps: fx?.fxSpreadBps ?? 0,
					liftingAndRepairFeesMinor: wire
						? wire.normalizedReceiverFeesMinor + wire.normalizedRepairFeeMinor
						: 0,
					platformFeeMinor: wire?.normalizedPlatformFeeMinor ?? 0,
					withholdingTaxMinor: normalizedWithholdingTaxMinor,
					recoverableFeeMinor: 0,
					unexplainedVarianceMinor: varianceMinor,
				},
				replay: {
					actualNetMinor: c?.wire.settledAmount.amountMinor ?? 0,
					optimalTransparentNetMinor: fx?.midMarketExpectedMinor ?? 0,
					totalLeakMinor: 0,
					totalLeakBps: 0,
				},
				sourceRefs: terms?.sourceRefs ?? [],
				disclaimer: "Synthetic/public data demonstration only. Not financial or legal advice.",
				completedAt: new Date().toISOString(),
			}
			state.auditByCaseId.set(caseId, abortedVerdict)
			state.emitTrajectory({
				caseId,
				kind: "audit.verdict",
				payload: { verdict: abortedVerdict },
			})
			state.resolveCaseWaiters(caseId, abortedVerdict)

			return {
				nextStateId: "model_message",
				input: {
					answer: ModelMessageItem.rehydrate({
						text: `Stopped ${caseId} safely at human breakpoint without mutating settlement outputs.`,
					}),
				},
			}
		}

		if (decision.decision === "reject") {
			const note = decision.reason || "Operator rejected dispute claim; treat as approved SHA fee and close cleanly."
			state.humanOverrideNotesByCaseId.set(caseId, note)
			const output = FunctionCallOutputItem.create(
				call.callId,
				JSON.stringify({
					rejectedByHuman: true,
					humanOverrideNote: note,
					instruction: `Incorporate operator override verbatim, re-verify balance if needed, and call finalize_settlement_action with actionType: "CLOSE_CLEAN" and humanOverrideNote: "${note}".`,
				}),
			)
			inferenceInput.context.addContextItems([call, output])
			return {
				nextStateId: "inference",
				input: inferenceInput,
			}
		}

		// Approved: resume pending function_call seamlessly without restarting the loop
		return transition
	}
}
