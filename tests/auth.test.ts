import assert from "node:assert/strict"
import { rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"
import { NextRequest } from "next/server"
import { CorridorDatabase, DEFAULT_WORKSPACE_ID, getCorridorDb } from "../src/core/db/database"
import { issueCorridorSession, verifyCorridorSession } from "../src/core/security/auth"
import { authorizeCorridorRequest } from "../src/core/security/authorization"
import { middleware } from "../src/middleware"

test("verified invited identities activate with their assigned role; bootstrap owner is provisioned", () => {
	const db = new CorridorDatabase(":memory:")
	const invited = db.addTeamMember({ workspaceId: DEFAULT_WORKSPACE_ID, email: "analyst@example.test", name: "Analyst", role: "analyst" })
	const active = db.activateVerifiedTeamMember({
		workspaceId: DEFAULT_WORKSPACE_ID,
		email: invited.email,
		name: invited.name,
	})
	assert.equal(active?.status, "active")
	assert.equal(active?.role, "analyst")

	const owner = db.activateVerifiedTeamMember({
		workspaceId: DEFAULT_WORKSPACE_ID,
		email: "owner@example.test",
		name: "Owner",
		bootstrapOwner: true,
	})
	assert.equal(owner?.role, "owner")
	assert.equal(owner?.status, "active")
})

test("signed sessions validate claims and reject tampering", async () => {
	const previousSecret = process.env.CORRIDOR_SESSION_SECRET
	process.env.CORRIDOR_SESSION_SECRET = "test-session-secret-with-at-least-32-bytes"
	try {
		const token = await issueCorridorSession({ sub: "user-1", email: "user@example.test", name: "User", role: "analyst" })
		assert.deepEqual(await verifyCorridorSession(token), {
			sub: "user-1",
			email: "user@example.test",
			name: "User",
			role: "analyst",
		})
		await assert.rejects(verifyCorridorSession(`${token.slice(0, -1)}x`))
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
		db.activateVerifiedTeamMember({ email: invited.email, name: invited.name })
		const token = await issueCorridorSession({ sub: "viewer-1", email: invited.email, name: invited.name, role: "viewer" })
		const request = new Request("http://localhost/api/history", { headers: { cookie: `ca_session=${token}` } })
		assert.equal(await authorizeCorridorRequest(request, "viewer"), null)

		db.removeTeamMember(DEFAULT_WORKSPACE_ID, invited.id)
		const denied = await authorizeCorridorRequest(request, "viewer")
		assert.equal(denied?.status, 401)
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
