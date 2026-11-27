import { defineRuntime, RuntimeState, SemanticEvent } from "@mozaik-ai/core"
import type {
	AnomalyAssessment,
	AuditVerdict,
	FxAssessment,
	FxRateRecord,
	InvoiceInput,
	PendingBreakpointDecision,
	SettlementCase,
	TermsAssessment,
	TrajectoryEvent,
	WireAssessment,
	WireOrBankInput,
} from "../core/types"

export interface BreakpointDecision {
	decision: "approve" | "reject" | "stop"
	reason?: string
}

export class CorridorState extends RuntimeState {
	public batchId = "CORRIDOR-LIVE-BATCH"
	public rawInvoices: InvoiceInput[] = []
	public rawWires: WireOrBankInput[] = []
	public fxCache = new Map<string, FxRateRecord>()
	public casesById = new Map<string, SettlementCase>()

	// Parallel specialist synchronization (plugs seamlessly into AuditorAgent reactive barrier)
	public expectedRolesByCaseId = new Map<string, Set<string>>()
	public findingsByRole = new Map<string, Set<string>>()
	public rerunCountByCaseRole = new Map<string, number>()

	// Isolated per-role slots preventing race conditions across concurrent agents
	public termsByCaseId = new Map<string, TermsAssessment>()
	public fxByCaseId = new Map<string, FxAssessment>()
	public wireByCaseId = new Map<string, WireAssessment>()
	public anomalyByCaseId = new Map<string, AnomalyAssessment>()
	public auditByCaseId = new Map<string, AuditVerdict>()

	// Interruptible harness state
	public breakpointMode: "risk_only" | "step_tool" = "risk_only"
	public autoApproveBreakpoints = false
	public abortedCases = new Set<string>()
	public pendingApprovals = new Map<
		string,
		PendingBreakpointDecision & { resolve: (decision: BreakpointDecision) => void }
	>()
	public humanOverrideNotesByCaseId = new Map<string, string>()

	// Live SSE stream & chronological case trace + ledger
	public trajectoryByCaseId = new Map<string, TrajectoryEvent[]>()
	public ledgerEvents: Array<{ timestamp: string; caseId: string; summary: string; tone: "ok" | "warn" | "bad" }> = []
	public queueStats = { waiting: 0, active: 0, done: 0, failed: 0 }
	public subscribers = new Set<(evt: TrajectoryEvent) => void>()

	private caseWaiters = new Map<string, Array<(verdict: AuditVerdict) => void>>()

	emitTrajectory(partial: Omit<TrajectoryEvent, "id" | "timestamp">): TrajectoryEvent {
		const evt: TrajectoryEvent = {
			...partial,
			id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			timestamp: new Date().toISOString(),
		}
		const list = this.trajectoryByCaseId.get(evt.caseId) ?? []
		list.push(evt)
		this.trajectoryByCaseId.set(evt.caseId, list)

		if (evt.kind === "ledger.entry" && evt.text) {
			this.ledgerEvents.unshift({
				timestamp: evt.timestamp,
				caseId: evt.caseId,
				summary: evt.text,
				tone: evt.status === "bad" ? "bad" : evt.status === "warn" ? "warn" : "ok",
			})
			if (this.ledgerEvents.length > 80) this.ledgerEvents.length = 80
		}

		for (const sub of this.subscribers) {
			try {
				sub(evt)
			} catch {
				// ignore closed stream listener
			}
		}
		return evt
	}

	markRoleComplete(caseId: string, role: "terms" | "fx" | "wire" | "anomaly"): boolean {
		const completed = this.findingsByRole.get(caseId) ?? new Set<string>()
		completed.add(role)
		this.findingsByRole.set(caseId, completed)

		const expected = this.expectedRolesByCaseId.get(caseId)
		if (!expected || expected.size === 0) return false
		for (const reqRole of expected) {
			if (!completed.has(reqRole)) return false
		}
		return true
	}

	registerCase(
		settlementCase: SettlementCase,
		checkpoints?: Partial<Record<"terms" | "fx" | "wire" | "anomaly", unknown>>,
	): void {
		this.casesById.set(settlementCase.caseId, settlementCase)
		if (settlementCase.invoice && !this.rawInvoices.some((i) => i.invoiceId === settlementCase.invoice!.invoiceId)) {
			this.rawInvoices.push(settlementCase.invoice)
		}
		const wires = [settlementCase.wire, ...(settlementCase.candidateWires ?? [])]
		for (const w of wires) {
			if (!this.rawWires.some((existing) => existing.wireId === w.wireId)) {
				this.rawWires.push(w)
			}
		}

		// Reset per-case state cleanly if re-run
		this.termsByCaseId.delete(settlementCase.caseId)
		this.fxByCaseId.delete(settlementCase.caseId)
		this.wireByCaseId.delete(settlementCase.caseId)
		this.anomalyByCaseId.delete(settlementCase.caseId)
		this.auditByCaseId.delete(settlementCase.caseId)
		this.findingsByRole.set(settlementCase.caseId, new Set())
		this.trajectoryByCaseId.set(settlementCase.caseId, [])
		this.abortedCases.delete(settlementCase.caseId)
		this.humanOverrideNotesByCaseId.delete(settlementCase.caseId)
		for (const r of ["terms", "fx", "wire", "anomaly"]) {
			this.rerunCountByCaseRole.delete(`${settlementCase.caseId}:${r}`)
		}

		const hasAnomalyTrigger =
			(settlementCase.candidateWires?.length ?? 0) > 0 ||
			Boolean(settlementCase.invoice?.priorAccountRef && settlementCase.wire.beneficiaryAccountRef &&
				settlementCase.invoice.priorAccountRef !== settlementCase.wire.beneficiaryAccountRef)

		const roles = new Set<string>(["terms", "fx", "wire"])
		if (hasAnomalyTrigger) roles.add("anomaly")
		this.expectedRolesByCaseId.set(settlementCase.caseId, roles)

		if (checkpoints) {
			const done = this.findingsByRole.get(settlementCase.caseId)!
			if (checkpoints.terms) {
				this.termsByCaseId.set(settlementCase.caseId, checkpoints.terms as TermsAssessment)
				done.add("terms")
			}
			if (checkpoints.fx) {
				this.fxByCaseId.set(settlementCase.caseId, checkpoints.fx as FxAssessment)
				done.add("fx")
			}
			if (checkpoints.wire) {
				this.wireByCaseId.set(settlementCase.caseId, checkpoints.wire as WireAssessment)
				done.add("wire")
			}
			if (checkpoints.anomaly && roles.has("anomaly")) {
				this.anomalyByCaseId.set(settlementCase.caseId, checkpoints.anomaly as AnomalyAssessment)
				done.add("anomaly")
			}
		}
	}

	requestSpecialistRerun(
		caseId: string,
		role: "terms" | "fx" | "wire" | "anomaly",
	): { allowed: boolean; attempt: number } {
		const key = `${caseId}:${role}`
		const prev = this.rerunCountByCaseRole.get(key) ?? 0
		if (prev >= 2) return { allowed: false, attempt: prev }
		const next = prev + 1
		this.rerunCountByCaseRole.set(key, next)
		if (role === "terms") this.termsByCaseId.delete(caseId)
		else if (role === "fx") this.fxByCaseId.delete(caseId)
		else if (role === "wire") this.wireByCaseId.delete(caseId)
		else if (role === "anomaly") this.anomalyByCaseId.delete(caseId)
		this.findingsByRole.get(caseId)?.delete(role)
		const expected = this.expectedRolesByCaseId.get(caseId) ?? new Set<string>()
		expected.add(role)
		this.expectedRolesByCaseId.set(caseId, expected)
		return { allowed: true, attempt: next }
	}

	resolveCaseWaiters(caseId: string, verdict: AuditVerdict): void {
		const waiters = this.caseWaiters.get(caseId)
		if (!waiters) return
		this.caseWaiters.delete(caseId)
		for (const w of waiters) w(verdict)
	}

	waitForCaseVerdict(caseId: string, timeoutMs = 120_000, pauseTimeoutWhile: () => boolean = () => false): Promise<AuditVerdict> {
		const existing = this.auditByCaseId.get(caseId)
		if (existing) return Promise.resolve(existing)

		return new Promise<AuditVerdict>((resolve, reject) => {
			let activeWaitMs = 0
			let previousTick = Date.now()
			let settled = false
			let timer: ReturnType<typeof setInterval> | undefined
			const waiters = this.caseWaiters.get(caseId) ?? []
			const waiter = (verdict: AuditVerdict) => {
				if (settled) return
				settled = true
				if (timer) clearInterval(timer)
				resolve(verdict)
			}
			waiters.push(waiter)
			this.caseWaiters.set(caseId, waiters)
			const timerId = setInterval(() => {
				const now = Date.now()
				if (!pauseTimeoutWhile()) activeWaitMs += now - previousTick
				previousTick = now
				if (!settled && activeWaitMs >= timeoutMs) {
					settled = true
					clearInterval(timerId)
					const currentWaiters = this.caseWaiters.get(caseId)
					if (currentWaiters) {
						const index = currentWaiters.indexOf(waiter)
						if (index >= 0) currentWaiters.splice(index, 1)
						if (currentWaiters.length === 0) this.caseWaiters.delete(caseId)
					}
					reject(new Error(`Timed out waiting for ${caseId} audit verdict after ${timeoutMs}ms`))
				}
			}, Math.min(1000, Math.max(100, timeoutMs)))
			timer = timerId
			timerId.unref?.()
		})
	}
}

export const {
	initializeRuntime,
	resolveRuntime,
	resolveParticipant,
	join,
	leave,
	sendMessage,
	sendEvent,
	runLoop,
} = defineRuntime<CorridorState>()

export function publishCorridorEvent(type: string, producerId: string, payload: Record<string, unknown>): void {
	sendEvent(SemanticEvent.create(type, producerId, payload), producerId)
}
