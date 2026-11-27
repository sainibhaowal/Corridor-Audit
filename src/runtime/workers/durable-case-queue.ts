import { randomUUID } from "node:crypto"
import { type CorridorDatabase, DEFAULT_WORKSPACE_ID, MAX_CASE_ATTEMPTS } from "../../core/db/database"

const CASE_LEASE_MS = 60_000
const LEASE_RENEW_MS = 20_000

async function waitForExistingClaim<T>(db: CorridorDatabase, caseId: string): Promise<T | null> {
	for (;;) {
		const verdict = db.getAuditVerdict(caseId)
		if (verdict) return verdict as T
		const current = db.getCaseQueueState(caseId)
		if (!current || current.status === "dead_letter") throw new Error(`Case ${caseId} is not available for processing`)
		if (current.status === "queued") return null
		const remaining = current.leaseExpiresAt ? Date.parse(current.leaseExpiresAt) - Date.now() : 0
		if (current.status === "running" && remaining <= 0) return null
		if (current.status === "completed") throw new Error(`Case ${caseId} completed without a persisted verdict`)
		await new Promise<void>((resolve) => setTimeout(resolve, Math.min(Math.max(remaining + 10, 50), 1000)))
	}
}

export async function runWithDurableCaseRetries<T>(params: {
	db: CorridorDatabase
	caseId: string
	workerId?: string
	runAttempt: (workerId: string) => Promise<T>
	onAttemptStart?: () => void
	onRetryScheduled?: (retryAt: string, delayMs: number, error: unknown) => void
	onDeadLetter?: (error: unknown) => void
	shouldRetry?: (error: unknown) => boolean
	sleep?: (delayMs: number) => Promise<void>
}): Promise<T> {
	const sleep = params.sleep ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)))
	const workerId = params.workerId ?? randomUUID()
	for (;;) {
		const claimed = params.db.claimCase(params.caseId, workerId, CASE_LEASE_MS)
		if (!claimed) {
			const existing = await waitForExistingClaim<T>(params.db, params.caseId)
			if (existing !== null) return existing
			await sleep(50)
			continue
		}
		params.onAttemptStart?.()
		let leaseLost = false
		const renewTimer = setInterval(() => {
			if (!params.db.renewCaseLease(params.caseId, workerId, CASE_LEASE_MS)) leaseLost = true
		}, LEASE_RENEW_MS)
		renewTimer.unref?.()
		try {
			const result = await params.runAttempt(workerId)
			if (leaseLost) throw new Error(`Case lease lost during processing: ${params.caseId}`)
			return result
		} catch (error) {
			if (leaseLost || (error instanceof Error && error.message.startsWith("Case lease lost"))) {
				const existing = await waitForExistingClaim<T>(params.db, params.caseId)
				if (existing !== null) return existing
				continue
			}
			const attemptCount = params.db.getCaseAttemptCount(params.caseId)
			const message = error instanceof Error ? error.message : String(error)
			if (attemptCount <= 0 || attemptCount >= MAX_CASE_ATTEMPTS || params.shouldRetry?.(error) === false) {
				params.db.markCaseDeadLetter(params.caseId, message, DEFAULT_WORKSPACE_ID, workerId)
				params.onDeadLetter?.(error)
				throw error
			}
			const delayMs = attemptCount === 1 ? 1000 : 5000
			const retryAt = new Date(Date.now() + delayMs).toISOString()
			params.db.markCaseRetry(params.caseId, message, retryAt, DEFAULT_WORKSPACE_ID, workerId)
			params.onRetryScheduled?.(retryAt, delayMs, error)
			await sleep(delayMs + 10)
		} finally {
			clearInterval(renewTimer)
		}
	}
}
