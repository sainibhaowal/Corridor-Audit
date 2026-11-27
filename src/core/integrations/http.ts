import { lookup as dnsLookup } from "node:dns/promises"
import { isIP } from "node:net"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"

export const PROVIDER_HTTP_TIMEOUT_MS = 20_000
export const MAX_GENERIC_PROVIDER_RESPONSE_BYTES = 10 * 1024 * 1024

export function fetchProvider(input: string | URL, init?: RequestInit, timeoutMs = PROVIDER_HTTP_TIMEOUT_MS): Promise<Response> {
	const timeoutSignal = AbortSignal.timeout(timeoutMs)
	const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal
	return fetch(input, { ...init, signal })
}

function isPublicAddress(address: string): boolean {
	if (isIP(address) === 4) {
		const octets = address.split(".").map(Number)
		const [a = 0, b = 0, c = 0] = octets
		return !(
			a === 0 || a === 10 || a === 127 || a >= 224 ||
			(a === 100 && b >= 64 && b <= 127) ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			(a === 192 && b === 0 && c === 0) ||
			(a === 192 && b === 0 && c === 2) ||
			(a === 198 && (b === 18 || b === 19)) ||
			(a === 198 && b === 51 && c === 100) ||
			(a === 203 && b === 0 && c === 113)
		)
	}
	if (isIP(address) === 6) {
		const normalized = address.toLowerCase().split("%")[0] || ""
		const first = Number.parseInt(normalized.split(":")[0] || "0", 16)
		return first >= 0x2000 && first <= 0x3fff &&
			!normalized.startsWith("2001:db8:") &&
			!normalized.startsWith("2001:0000:") &&
			!normalized.startsWith("2002:")
	}
	return false
}

function isLoopbackAddress(address: string): boolean {
	if (isIP(address) === 4) return address.startsWith("127.")
	return isIP(address) === 6 && address.toLowerCase() === "::1"
}

export function validateProviderEndpointUrl(value: string, production = process.env.NODE_ENV === "production"): URL {
	let url: URL
	try {
		url = new URL(value)
	} catch {
		throw new Error("Provider API endpoint must be a valid absolute URL.")
	}
	if (url.username || url.password || url.hash) throw new Error("Provider API endpoint cannot contain credentials or a fragment.")
	const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "")
	const loopbackHost = host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "::1"
	if (url.protocol !== "https:" && !(url.protocol === "http:" && !production && loopbackHost)) {
		throw new Error("Provider API endpoints must use HTTPS. HTTP is allowed only for a local loopback endpoint in development.")
	}
	if (production && url.port && url.port !== "443") {
		throw new Error("Production provider API endpoints must use the standard HTTPS port.")
	}
	if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
		if (production || !loopbackHost) throw new Error("Provider API endpoint must use a public DNS host.")
	}
	if (isIP(host) && !isPublicAddress(host) && !(!production && isLoopbackAddress(host))) {
		throw new Error("Provider API endpoint cannot target a private or reserved IP address.")
	}
	return url
}

export function assertProviderEndpointHostAllowed(
	url: URL,
	allowedHosts = process.env.CORRIDOR_PROVIDER_ENDPOINT_HOSTS,
	production = process.env.NODE_ENV === "production",
): void {
	if (!production) return
	const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "")
	const allowlist = (allowedHosts || "").split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean)
	if (allowlist.length === 0) {
		throw new Error("Generic provider endpoints are disabled in production until CORRIDOR_PROVIDER_ENDPOINT_HOSTS is configured.")
	}
	if (!allowlist.includes(host)) {
		throw new Error(`Provider API host \"${host}\" is not in CORRIDOR_PROVIDER_ENDPOINT_HOSTS.`)
	}
}

export async function assertProviderEndpointResolvesPublicly(
	url: URL,
	resolver: (hostname: string) => Promise<Array<{ address: string; family: number }>> = async (hostname) =>
		dnsLookup(hostname, { all: true, verbatim: true }),
): Promise<void> {
	const host = url.hostname.replace(/^\[|\]$/g, "")
	if (isIP(host)) {
		if (!isPublicAddress(host) && !(process.env.NODE_ENV !== "production" && isLoopbackAddress(host))) {
			throw new Error("Provider API endpoint cannot target a private or reserved IP address.")
		}
		return
	}
	const records = await resolver(host)
	const localDevelopmentHost = process.env.NODE_ENV !== "production" && (host === "localhost" || host.endsWith(".localhost"))
	const addressesValid = localDevelopmentHost
		? records.every((record) => isLoopbackAddress(record.address))
		: records.every((record) => isPublicAddress(record.address))
	if (records.length === 0 || !addressesValid) {
		throw new Error("Provider API endpoint must resolve only to public IP addresses.")
	}
}

/** Resolve and validate a generic endpoint once, then connect directly to that IP. */
export async function fetchValidatedProviderEndpoint(
	url: URL,
	options: {
		headers?: HeadersInit
		timeoutMs?: number
		resolver?: (hostname: string) => Promise<Array<{ address: string; family: number }>>
		production?: boolean
	} = {},
): Promise<Response> {
	const production = options.production ?? process.env.NODE_ENV === "production"
	const endpoint = validateProviderEndpointUrl(url.toString(), production)
	assertProviderEndpointHostAllowed(endpoint, process.env.CORRIDOR_PROVIDER_ENDPOINT_HOSTS, production)
	const host = endpoint.hostname.toLowerCase().replace(/^\[|\]$/g, "")
	const localDevelopmentHost = !production && (host === "localhost" || host.endsWith(".localhost"))
	const records = isIP(host)
		? [{ address: host, family: isIP(host) }]
		: await (options.resolver ?? ((hostname) => dnsLookup(hostname, { all: true, verbatim: true })))(host)
	if (records.length === 0 || records.some((record) =>
		localDevelopmentHost ? !isLoopbackAddress(record.address) : !isPublicAddress(record.address))) {
		throw new Error("Provider API endpoint must resolve only to public IP addresses.")
	}

	const address = records[0]!.address
	const transport = endpoint.protocol === "https:" ? httpsRequest : httpRequest
	const headers: Record<string, string> = {}
	new Headers(options.headers).forEach((value, key) => { headers[key] = value })
	headers.host = endpoint.host
	headers["accept-encoding"] = "identity"
	const timeoutMs = options.timeoutMs ?? PROVIDER_HTTP_TIMEOUT_MS

	return new Promise<Response>((resolve, reject) => {
		let settled = false
		const req = transport({
			protocol: endpoint.protocol,
			hostname: address,
			port: endpoint.port || (endpoint.protocol === "https:" ? 443 : 80),
			method: "GET",
			path: `${endpoint.pathname}${endpoint.search}`,
			headers,
			agent: false,
			...(endpoint.protocol === "https:" && !isIP(host) ? { servername: host } : {}),
		}, (incoming) => {
			const chunks: Buffer[] = []
			let bytes = 0
			incoming.on("data", (chunk: Buffer | string) => {
				const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
				bytes += buffer.byteLength
				if (bytes > MAX_GENERIC_PROVIDER_RESPONSE_BYTES) {
					incoming.destroy(new Error(`Provider response exceeds ${MAX_GENERIC_PROVIDER_RESPONSE_BYTES} bytes.`))
					return
				}
				chunks.push(buffer)
			})
			incoming.on("error", (error) => {
				if (!settled) { settled = true; clearTimeout(timer); reject(error) }
			})
			incoming.on("end", () => {
				if (settled) return
				settled = true
				clearTimeout(timer)
				const responseHeaders = new Headers()
				const contentType = incoming.headers["content-type"]
				if (typeof contentType === "string") responseHeaders.set("content-type", contentType)
				const status = incoming.statusCode && incoming.statusCode >= 200 ? incoming.statusCode : 502
				const body = status === 204 || status === 304 ? null : Buffer.concat(chunks)
				resolve(new Response(body, { status, headers: responseHeaders }))
			})
		})
		const timer = setTimeout(() => req.destroy(new Error(`Provider endpoint request timed out after ${timeoutMs} ms.`)), timeoutMs)
		req.on("error", (error) => {
			if (!settled) { settled = true; clearTimeout(timer); reject(error) }
		})
		req.end()
	})
}
