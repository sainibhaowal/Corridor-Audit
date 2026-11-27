import { type CorridorDatabase, MAX_CASE_ATTEMPTS } from "../../core/db/database"

export async function runWithDurableCaseRetries<T>(params: {
	db: CorridorDatabase
	caseId: string
	runAttempt: () => Promise<T>
	onAttemptStart?: () => void
	onRetryScheduled?: (retryAt: string, delayMs: number, error: unknown) => void
	onDeadLetter?: (error: unknown) => void
	shouldRetry?: (error: unknown) => boolean
	sleep?: (delayMs: number) => Promise<void>
}): Promise<T> {
	const sleep = params.sleep ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)))
	for (;;) {
		params.db.markCaseRunning(params.caseId)
		params.onAttemptStart?.()
		try {
			return await params.runAttempt()
		} catch (error) {
			const attemptCount = params.db.getCaseAttemptCount(params.caseId)
			const message = error instanceof Error ? error.message : String(error)
			if (attemptCount <= 0 || attemptCount >= MAX_CASE_ATTEMPTS || params.shouldRetry?.(error) === false) {
				params.db.markCaseDeadLetter(params.caseId, message)
				params.onDeadLetter?.(error)
				throw error
			}
			const delayMs = attemptCount === 1 ? 1000 : 5000
			const retryAt = new Date(Date.now() + delayMs).toISOString()
			params.db.markCaseRetry(params.caseId, message, retryAt)
			params.onRetryScheduled?.(retryAt, delayMs, error)
			await sleep(delayMs + 10)
		}
	}
}
