import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CorridorDatabase } from "../src/core/db/database"

test("local_users supports seeded Test Admin login, registration, profile update, and password reset", () => {
	const dir = mkdtempSync(join(tmpdir(), "corridor-local-auth-"))
	const dbPath = join(dir, "corridor.sqlite")
	try {
		const db = new CorridorDatabase(dbPath)
		const seeded = db.ensureDefaultLocalUser()
		assert.equal(seeded.email, "testadmin@corridoraudit.local")
		assert.equal(seeded.name, "Test Admin")

		// Seeded Test Admin signs in
		const admin = db.authenticateOrRegisterLocalUser({
			email: "testadmin@corridoraudit.local",
			password: "Admin@1234",
			mode: "login",
		})
		assert.equal(admin.id, seeded.id)

		// Wrong password rejected
		assert.throws(
			() =>
				db.authenticateOrRegisterLocalUser({
					email: "testadmin@corridoraudit.local",
					password: "WrongPassword1!",
					mode: "login",
				}),
			/Invalid email or password/,
		)

		// Invalid email rejected
		assert.throws(
			() =>
				db.authenticateOrRegisterLocalUser({
					email: "invalid-email",
					password: "Strong@123",
					mode: "register",
				}),
			/valid email address/,
		)

		// Register new user
		const created = db.authenticateOrRegisterLocalUser({
			name: "Alex Morgan",
			email: "alex@example.com",
			password: "Strong@123",
			mode: "register",
		})
		assert.equal(created.name, "Alex Morgan")
		assert.equal(created.email, "alex@example.com")

		// Update profile & DP avatar color
		const updated = db.updateLocalUserProfile({
			userId: created.id,
			name: "Alex M.",
			avatarColor: "#a78bfa",
		})
		assert.equal(updated.name, "Alex M.")
		assert.equal(updated.avatarColor, "#a78bfa")

		// Reset password
		db.resetLocalUserPassword({
			userId: created.id,
			currentPassword: "Strong@123",
			newPassword: "NewStrong@456",
		})
		const signedInAfterReset = db.authenticateOrRegisterLocalUser({
			email: "alex@example.com",
			password: "NewStrong@456",
			mode: "login",
		})
		assert.equal(signedInAfterReset.id, created.id)
		db.close()
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
})
