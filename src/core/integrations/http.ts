export const PROVIDER_HTTP_TIMEOUT_MS = 20_000

export function fetchProvider(input: string | URL, init?: RequestInit, timeoutMs = PROVIDER_HTTP_TIMEOUT_MS): Promise<Response> {
	const signal = init?.signal ?? AbortSignal.timeout(timeoutMs)
	return fetch(input, { ...init, signal })
}
