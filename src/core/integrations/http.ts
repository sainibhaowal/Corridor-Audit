import { lookup as dnsLookup } from "node:dns/promises"
import { isIP } from "node:net"

export const PROVIDER_HTTP_TIMEOUT_MS = 20_000

export function fetchProvider(input: string | URL, init?: RequestInit, timeoutMs = PROVIDER_HTTP_TIMEOUT_MS): Promise<Response> {
	const signal = init?.signal ?? AbortSignal.timeout(timeoutMs)
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
	if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
		if (production || !loopbackHost) throw new Error("Provider API endpoint must use a public DNS host.")
	}
	if (isIP(host) && !isPublicAddress(host) && !(!production && isLoopbackAddress(host))) {
		throw new Error("Provider API endpoint cannot target a private or reserved IP address.")
	}
	return url
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
