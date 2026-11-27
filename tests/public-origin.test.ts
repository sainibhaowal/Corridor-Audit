import assert from "node:assert/strict"
import test from "node:test"
import { getCorridorPublicOrigin } from "../src/core/security/public-origin"

const env = process.env as unknown as Record<string, string | undefined>

function request(url: string): Request {
	return new Request(url)
}

test("local OAuth public origin accepts loopback request origins", () => {
	const previousMode = env.NODE_ENV
	const previousOrigin = env.CORRIDOR_PUBLIC_BASE_URL
	env.NODE_ENV = "development"
	delete env.CORRIDOR_PUBLIC_BASE_URL
	try {
		assert.equal(getCorridorPublicOrigin(request("http://127.0.0.1:3000/api/oauth")), "http://127.0.0.1:3000")
		assert.equal(getCorridorPublicOrigin(request("http://localhost:3000/api/oauth")), "http://localhost:3000")
		assert.throws(() => getCorridorPublicOrigin(request("http://attacker.example/api/oauth")), /loopback/)
	} finally {
		if (previousMode === undefined) delete env.NODE_ENV
		else env.NODE_ENV = previousMode
		if (previousOrigin === undefined) delete env.CORRIDOR_PUBLIC_BASE_URL
		else env.CORRIDOR_PUBLIC_BASE_URL = previousOrigin
	}
})

test("production OAuth origin requires a configured HTTPS origin", () => {
	const previousMode = env.NODE_ENV
	const previousOrigin = env.CORRIDOR_PUBLIC_BASE_URL
	env.NODE_ENV = "production"
	delete env.CORRIDOR_PUBLIC_BASE_URL
	try {
		assert.throws(() => getCorridorPublicOrigin(request("https://attacker.example/api/oauth")), /Set CORRIDOR_PUBLIC_BASE_URL/)
		env.CORRIDOR_PUBLIC_BASE_URL = "https://audit.example.com/"
		assert.equal(getCorridorPublicOrigin(request("https://spoofed.example/api/oauth")), "https://audit.example.com")
		env.CORRIDOR_PUBLIC_BASE_URL = "http://audit.example.com"
		assert.throws(() => getCorridorPublicOrigin(request("https://spoofed.example/api/oauth")), /must use HTTPS/)
		env.CORRIDOR_PUBLIC_BASE_URL = "https://audit.example.com/subpath"
		assert.throws(() => getCorridorPublicOrigin(request("https://spoofed.example/api/oauth")), /only an HTTP\(S\) origin/)
	} finally {
		if (previousMode === undefined) delete env.NODE_ENV
		else env.NODE_ENV = previousMode
		if (previousOrigin === undefined) delete env.CORRIDOR_PUBLIC_BASE_URL
		else env.CORRIDOR_PUBLIC_BASE_URL = previousOrigin
	}
})
