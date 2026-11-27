export const MAX_CASES_PER_INGESTION = 500
export const MAX_CANDIDATE_WIRES_PER_CASE = 100

export class IngestionLimitError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "IngestionLimitError"
	}
}
