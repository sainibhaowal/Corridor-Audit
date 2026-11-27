export class RequestBodyTooLargeError extends Error {
	constructor(readonly limitBytes: number) {
		super(`Request body exceeds the ${limitBytes}-byte limit.`)
		this.name = "RequestBodyTooLargeError"
	}
}

/** Read a request with a hard streaming limit so callers do not buffer unbounded input. */
export async function readRequestTextLimited(request: Request, limitBytes: number): Promise<string> {
	const declaredLength = Number(request.headers.get("content-length"))
	if (Number.isFinite(declaredLength) && declaredLength > limitBytes) {
		throw new RequestBodyTooLargeError(limitBytes)
	}
	if (!request.body) return ""

	const reader = request.body.getReader()
	const chunks: Uint8Array[] = []
	let totalBytes = 0
	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			totalBytes += value.byteLength
			if (totalBytes > limitBytes) {
				await reader.cancel()
				throw new RequestBodyTooLargeError(limitBytes)
			}
			chunks.push(value)
		}
	} finally {
		reader.releaseLock()
	}

	const body = new Uint8Array(totalBytes)
	let offset = 0
	for (const chunk of chunks) {
		body.set(chunk, offset)
		offset += chunk.byteLength
	}
	return new TextDecoder("utf-8", { fatal: true }).decode(body)
}
