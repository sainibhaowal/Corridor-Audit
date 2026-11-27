import assert from "node:assert/strict"
import { rmSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"
import { NextRequest } from "next/server"
import { GET as runtimeStatusRoute } from "../src/app/api/runtime/status/route"
import { POST as logoutRoute } from "../src/app/api/auth/logout/route"
import { CorridorDatabase, DEFAULT_WORKSPACE_ID, getCorridorDb } from "../src/core/db/database"
import { issueCorridorSession, verifyCorridorSession } from "../src/core/security/auth"
import { authorizeCorridorRequest, isCurrentCorridorViewerSession } from "../src/core/security/authorization"
import { middleware } from "../src/middleware"
import { isHumanOverrideAuthorized } from "../src/runtime/interception/human-override"
import { CORRIDOR_SCHEMA_SQL } from "../src/core/db/schema"

test("verified invited identities activate with their assigned role; bootstrap owner is provisioned", () => {
	const db = new CorridorDatabase(":memory:")
	const invited = db.addTeamMember({ workspaceId: DEFAULT_WORKSPACE_ID, email: "analyst@example.test", name: "Analyst", role: "analyst" })
	const active = db.activateVerifiedTeamMember({
		workspaceId: DEFAULT_WORKSPACE_ID,
		email: invited.email,
		name: invited.name,
		identitySub: "cognito-analyst-1",
	})
	assert.equal(active?.status, "active")
	assert.equal(active?.role, "analyst")
	assert.equal(db.getTeamMemberByIdentitySub(DEFAULT_WORKSPACE_ID, "cognito-analyst-1")?.email, invited.email)

	const owner = db.activateVerifiedTeamMember({
		workspaceId: DEFAULT_WORKSPACE_ID,
		email: "owner@example.test",
		name: "Owner",
		identitySub: "cognito-owner-1",
		bootstrapOwner: true,
	})
	assert.equal(owner?.role, "owner")
	assert.equal(owner?.status, "active")
	assert.equal(db.getTeamMemberByIdentitySub(DEFAULT_WORKSPACE_ID, "cognito-owner-1")?.email, "owner@example.test")
})

test("a verified email cannot rebind an invitation already linked to a different Cognito subject", () => {
	const db = new CorridorDatabase(":memory:")
	db.addTeamMember({ email: "analyst@example.test", name: "Analyst", role: "analyst" })
	assert.equal(db.activateVerifiedTeamMember({ email: "analyst@example.test", name: "Analyst", identitySub: "cognito-sub-1" })?.role, "analyst")
	assert.equal(db.activateVerifiedTeamMember({ email: "analyst@example.test", name: "Analyst", identitySub: "cognito-sub-2" }), null)
	assert.equal(db.getTeamMemberByIdentitySub(DEFAULT_WORKSPACE_ID, "cognito-sub-1")?.email, "analyst@example.test")
	assert.equal(db.getTeamMemberByIdentitySub(DEFAULT_WORKSPACE_ID, "cognito-sub-2"), null)
	db.close()
})

test("a stable Cognito subject can refresh a verified email without changing its workspace role", () => {
	const db = new CorridorDatabase(":memory:")
	db.addTeamMember({ email: "old@example.test", name: "Analyst", role: "analyst" })
	db.activateVerifiedTeamMember({ email: "old@example.test", name: "Analyst", identitySub: "stable-sub" })
	const refreshed = db.activateVerifiedTeamMember({ email: "new@example.test", name: "Updated Analyst", identitySub: "stable-sub" })
	assert.equal(refreshed?.email, "new@example.test")
	assert.equal(refreshed?.role, "analyst")
	assert.equal(db.getTeamMemberByIdentitySub(DEFAULT_WORKSPACE_ID, "stable-sub")?.name, "Updated Analyst")
	db.close()
})

test("existing local databases add the stable identity column without losing team records", () => {
	const dbPath = resolve(tmpdir(), `corridor-identity-migration-${process.pid}-${Date.now()}.db`)
	const legacyDb = new DatabaseSync(dbPath)
	legacyDb.exec(CORRIDOR_SCHEMA_SQL.replace("identity_sub TEXT,", ""))
	legacyDb.close()
	const db = new CorridorDatabase(dbPath)
	try {
		const member = db.addTeamMember({ email: "migration@example.test", name: "Migration", role: "analyst" })
		const activated = db.activateVerifiedTeamMember({ email: member.email, name: member.name, identitySub: "migrated-cognito-sub" })
		assert.equal(activated?.status, "active")
		assert.equal(db.getTeamMemberByIdentitySub(DEFAULT_WORKSPACE_ID, "migrated-cognito-sub")?.id, member.id)
	} finally {
		db.close()
		rmSync(dbPath, { force: true })
		rmSync(`${dbPath}-wal`, { force: true })
		rmSync(`${dbPath}-shm`, { force: true })
	}
})

test("signed sessions validate claims and reject tampering", async () => {
	const previousSecret = process.env.CORRIDOR_SESSION_SECRET
	process.env.CORRIDOR_SESSION_SECRET = "test-session-secret-with-at-least-32-bytes"
	try {
		const token = await issueCorridorSession({ sub: "user-1", email: "user@example.test", name: "User", role: "analyst" })
		const session = await verifyCorridorSession(token)
		assert.equal(session.sub, "user-1")
		assert.equal(session.email, "user@example.test")
		assert.equal(session.name, "User")
		assert.equal(session.role, "analyst")
		assert.ok(session.sessionId)
		assert.ok(session.expiresAt > session.issuedAt)
		const tokenParts = token.split(".")
		tokenParts[2] = `${tokenParts[2]?.[0] === "a" ? "b" : "a"}${tokenParts[2]?.slice(1) || ""}`
		await assert.rejects(verifyCorridorSession(tokenParts.join(".")))
	} finally {
		if (previousSecret === undefined) delete process.env.CORRIDOR_SESSION_SECRET
		else process.env.CORRIDOR_SESSION_SECRET = previousSecret
	}
})

test("production-mode middleware rejects unauthenticated API requests and enforces roles", async () => {
	const previousMode = process.env.CORRIDOR_AUTH_MODE
	const previousSecret = process.env.CORRIDOR_SESSION_SECRET
	process.env.CORRIDOR_AUTH_MODE = "cognito"
	process.env.CORRIDOR_SESSION_SECRET = "test-session-secret-with-at-least-32-bytes"
	try {
		const unauthenticated = await middleware(new NextRequest("http://localhost/api/history"))
		assert.equal(unauthenticated.status, 401)

		const analystToken = await issueCorridorSession({ sub: "analyst-1", email: "analyst@example.test", name: "Analyst", role: "analyst" })
		const denied = await middleware(new NextRequest("http://localhost/api/settings/provider", {
			method: "POST",
			headers: { cookie: `ca_session=${analystToken}`, origin: "http://localhost" },
		}))
		assert.equal(denied.status, 403)

		const allowed = await middleware(new NextRequest("http://localhost/api/audit/upload", {
			method: "POST",
			headers: { cookie: `ca_session=${analystToken}`, origin: "http://localhost" },
		}))
		assert.equal(allowed.status, 200)
	} finally {
		if (previousMode === undefined) delete process.env.CORRIDOR_AUTH_MODE
		else process.env.CORRIDOR_AUTH_MODE = previousMode
		if (previousSecret === undefined) delete process.env.CORRIDOR_SESSION_SECRET
		else process.env.CORRIDOR_SESSION_SECRET = previousSecret
	}
})

test("API authorization checks current team membership on every request", async () => {
	const previousMode = process.env.CORRIDOR_AUTH_MODE
	const previousSecret = process.env.CORRIDOR_SESSION_SECRET
	const previousDbPath = process.env.CORRIDOR_DB_PATH
	const dbPath = resolve(tmpdir(), `corridor-auth-${process.pid}-${Date.now()}.db`)
	process.env.CORRIDOR_AUTH_MODE = "cognito"
	process.env.CORRIDOR_SESSION_SECRET = "test-session-secret-with-at-least-32-bytes"
	process.env.CORRIDOR_DB_PATH = dbPath
	try {
		const db = getCorridorDb()
		const invited = db.addTeamMember({ email: "viewer@example.test", name: "Viewer", role: "viewer" })
		db.activateVerifiedTeamMember({ email: invited.email, name: invited.name, identitySub: "viewer-1" })
		const token = await issueCorridorSession({ sub: "viewer-1", email: invited.email, name: invited.name, role: "viewer" })
		const claims = await verifyCorridorSession(token)
		db.createAuthSession({
			sessionId: claims.sessionId,
			identitySub: claims.sub,
			issuedAt: new Date(claims.issuedAt * 1000).toISOString(),
			expiresAt: new Date(claims.expiresAt * 1000).toISOString(),
		})
		const request = new Request("http://localhost/api/history", { headers: { cookie: `ca_session=${token}` } })
		assert.equal(await authorizeCorridorRequest(request, "viewer"), null)
		assert.equal(await isCurrentCorridorViewerSession(request), true)
		const logout = await logoutRoute(new Request("http://localhost/api/auth/logout", {
			method: "POST",
			headers: { cookie: `ca_session=${token}` },
		}))
		assert.equal(logout.status, 303)
		assert.equal((await authorizeCorridorRequest(request, "viewer"))?.status, 401)
		assert.equal(await isCurrentCorridorViewerSession(request), false)

		const activeToken = await issueCorridorSession({ sub: "viewer-1", email: invited.email, name: invited.name, role: "viewer" })
		const activeClaims = await verifyCorridorSession(activeToken)
		db.createAuthSession({
			sessionId: activeClaims.sessionId,
			identitySub: activeClaims.sub,
			issuedAt: new Date(activeClaims.issuedAt * 1000).toISOString(),
			expiresAt: new Date(activeClaims.expiresAt * 1000).toISOString(),
		})
		const activeRequest = new Request("http://localhost/api/history", { headers: { cookie: `ca_session=${activeToken}` } })
		assert.equal(await isCurrentCorridorViewerSession(activeRequest), true)

		db.removeTeamMember(DEFAULT_WORKSPACE_ID, invited.id)
		const denied = await authorizeCorridorRequest(activeRequest, "viewer")
		assert.equal(denied?.status, 401)
		assert.equal(await isCurrentCorridorViewerSession(activeRequest), false)
		db.close()
	} finally {
		if (previousMode === undefined) delete process.env.CORRIDOR_AUTH_MODE
		else process.env.CORRIDOR_AUTH_MODE = previousMode
		if (previousSecret === undefined) delete process.env.CORRIDOR_SESSION_SECRET
		else process.env.CORRIDOR_SESSION_SECRET = previousSecret
		if (previousDbPath === undefined) delete process.env.CORRIDOR_DB_PATH
		else process.env.CORRIDOR_DB_PATH = previousDbPath
		rmSync(dbPath, { force: true })
		rmSync(`${dbPath}-wal`, { force: true })
		rmSync(`${dbPath}-shm`, { force: true })
	}
})

test("runtime status requires an authenticated viewer when auth is enabled", async () => {
	const previousMode = process.env.CORRIDOR_AUTH_MODE
	process.env.CORRIDOR_AUTH_MODE = "cognito"
	try {
		const response = await runtimeStatusRoute(new Request("http://localhost/api/runtime/status"))
		assert.equal(response.status, 401)
	} finally {
		if (previousMode === undefined) delete process.env.CORRIDOR_AUTH_MODE
		else process.env.CORRIDOR_AUTH_MODE = previousMode
	}
})

test("API mutations reject cross-site browser requests even in local mode", async () => {
	const previousMode = process.env.CORRIDOR_AUTH_MODE
	process.env.CORRIDOR_AUTH_MODE = "local"
	try {
		const wrongOrigin = await authorizeCorridorRequest(new Request("http://127.0.0.1:3000/api/settings/workspace", {
			method: "POST",
			headers: { origin: "https://untrusted.example" },
		}), "viewer")
		assert.equal(wrongOrigin?.status, 403)
		const fetchMetadataOnly = await authorizeCorridorRequest(new Request("http://127.0.0.1:3000/api/settings/workspace", {
			method: "POST",
			headers: { "sec-fetch-site": "cross-site" },
		}), "viewer")
		assert.equal(fetchMetadataOnly?.status, 403)
		const sameOrigin = await authorizeCorridorRequest(new Request("http://127.0.0.1:3000/api/settings/workspace", {
			method: "POST",
			headers: { origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" },
		}), "viewer")
		assert.equal(sameOrigin, null)
	} finally {
		if (previousMode === undefined) delete process.env.CORRIDOR_AUTH_MODE
		else process.env.CORRIDOR_AUTH_MODE = previousMode
	}
})

test("SQLite API rate limits count requests atomically and reset at the next fixed window", () => {
	const db = new CorridorDatabase(":memory:")
	try {
		assert.deepEqual(db.consumeApiRateLimit({ bucketKey: "actor-a-read", limit: 2, windowMs: 60_000, nowMs: 120_000 }), {
			allowed: true,
			retryAfterSeconds: 60,
			remaining: 1,
		})
		assert.equal(db.consumeApiRateLimit({ bucketKey: "actor-a-read", limit: 2, windowMs: 60_000, nowMs: 121_000 }).allowed, true)
		const limited = db.consumeApiRateLimit({ bucketKey: "actor-a-read", limit: 2, windowMs: 60_000, nowMs: 122_000 })
		assert.equal(limited.allowed, false)
		assert.equal(limited.remaining, 0)
		assert.equal(db.consumeApiRateLimit({ bucketKey: "actor-b-read", limit: 2, windowMs: 60_000, nowMs: 122_000 }).allowed, true)
		assert.equal(db.consumeApiRateLimit({ bucketKey: "actor-a-read", limit: 2, windowMs: 60_000, nowMs: 180_000 }).allowed, true)
	} finally {
		db.close()
	}
})

test("model-provided human override text is accepted only when it matches a recorded reviewer decision", () => {
	assert.equal(isHumanOverrideAuthorized(undefined, "approve anyway"), false)
	assert.equal(isHumanOverrideAuthorized("reviewed and approved", "invented by model"), false)
	assert.equal(isHumanOverrideAuthorized("reviewed and approved", "reviewed and approved"), true)
})
