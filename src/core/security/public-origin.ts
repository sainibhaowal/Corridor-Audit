/**
 * Resolve the application's externally visible origin without trusting Host or
 * forwarded-host headers in production. OAuth redirect URIs must be stable and
 * registered with the provider.
 */
export function getCorridorPublicOrigin(request: Request): string {
	const configured = process.env.CORRIDOR_PUBLIC_BASE_URL?.trim()
	if (configured) {
		let parsed: URL
		try {
			parsed = new URL(configured)
		} catch {
			throw new Error("CORRIDOR_PUBLIC_BASE_URL must be an absolute HTTP(S) origin.")
		}
		if (
			!(["https:", "http:"].includes(parsed.protocol)) ||
			parsed.username || parsed.password || parsed.search || parsed.hash ||
			(parsed.pathname !== "/" && parsed.pathname !== "")
		) {
			throw new Error("CORRIDOR_PUBLIC_BASE_URL must contain only an HTTP(S) origin, without credentials, path, query, or fragment.")
		}
		if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
			throw new Error("CORRIDOR_PUBLIC_BASE_URL must use HTTPS in production.")
		}
		return parsed.origin
	}

	if (process.env.NODE_ENV === "production") {
		throw new Error("Set CORRIDOR_PUBLIC_BASE_URL to the registered HTTPS application origin in production.")
	}

	const requestUrl = new URL(request.url)
	const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(requestUrl.hostname)
	if (!loopback || requestUrl.protocol !== "http:") {
		throw new Error("Local OAuth requires a loopback HTTP origin. Set CORRIDOR_PUBLIC_BASE_URL for other environments.")
	}
	return requestUrl.origin
}
