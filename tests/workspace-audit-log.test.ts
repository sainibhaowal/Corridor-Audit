import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"
import { CorridorDatabase, DEFAULT_WORKSPACE_ID } from "../src/core/db/database"

test("workspace audit log appends verifiable secret-safe events and caps reads", () => {
	const db = new CorridorDatabase(":memory:")
	for (let index = 0; index < 4; index += 1) {
		db.appendWorkspaceAuditEvent({
			workspaceId: DEFAULT_WORKSPACE_ID,
			actorType: "user",
			actorId: "user-1",
			actorEmail: "OWNER@example.test",
			actorRole: "owner",
			action: "workspace.settings.update",
			targetType: "workspace",
			targetId: DEFAULT_WORKSPACE_ID,
			metadata: { changedFields: "defaultCurrency", index },
		})
	}
	assert.equal(db.verifyWorkspaceAuditChain().valid, true)
	assert.equal(db.verifyWorkspaceAuditChain().eventCount, 4)
	assert.equal(db.listWorkspaceAuditEvents(DEFAULT_WORKSPACE_ID, 2).length, 2)
	assert.equal(db.listWorkspaceAuditEvents(DEFAULT_WORKSPACE_ID, 10_000).length, 4)
	assert.equal(db.listWorkspaceAuditEvents()[0]?.actorEmail, "owner@example.test")
	assert.equal(JSON.stringify(db.listWorkspaceAuditEvents()).includes("secret"), false)
})

test("workspace audit chain reports local database edits", () => {
	const path = resolve(tmpdir(), `corridor-audit-chain-${process.pid}-${Date.now()}.db`)
	const db = new CorridorDatabase(path)
	try {
		db.appendWorkspaceAuditEvent({ actorType: "local", action: "integration.connect", targetType: "integration", targetId: "stripe" })
		assert.equal(db.verifyWorkspaceAuditChain().valid, true)
		const writer = new DatabaseSync(path)
		writer.prepare("UPDATE workspace_audit_log SET action = 'workspace.settings.update' WHERE sequence = 1").run()
		writer.close()
		assert.equal(db.verifyWorkspaceAuditChain().valid, false)
	} finally {
		db.close()
		rmSync(path, { force: true })
		rmSync(`${path}-wal`, { force: true })
		rmSync(`${path}-shm`, { force: true })
	}
})

test("workspace audit events reject oversized metadata and invalid action labels", () => {
	const db = new CorridorDatabase(":memory:")
	assert.throws(() => db.appendWorkspaceAuditEvent({ actorType: "local", action: "bad action", targetType: "workspace" }))
	assert.throws(() => db.appendWorkspaceAuditEvent({ actorType: "local", action: "workspace.settings.update", targetType: "workspace", metadata: { note: "x".repeat(5_000) } }))
	assert.equal(db.verifyWorkspaceAuditChain().eventCount, 0)
})

test("workspace mutation and audit append roll back together", () => {
	const db = new CorridorDatabase(":memory:")
	const originalName = db.getWorkspace(DEFAULT_WORKSPACE_ID).name
	assert.throws(() => db.transaction(() => {
		db.updateWorkspace(DEFAULT_WORKSPACE_ID, { name: "Partially changed" })
		db.appendWorkspaceAuditEvent({ actorType: "local", action: "invalid action", targetType: "workspace" })
	}))
	assert.equal(db.getWorkspace(DEFAULT_WORKSPACE_ID).name, originalName)
	assert.equal(db.verifyWorkspaceAuditChain().eventCount, 0)
	db.close()
})
