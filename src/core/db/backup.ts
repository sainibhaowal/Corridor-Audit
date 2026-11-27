import { chmodSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"

export interface VerifiedDatabaseBackup {
	path: string
	integrity: "ok"
	sizeBytes: number
}

export function backupCorridorDatabase(sourcePath: string, destinationPath: string): VerifiedDatabaseBackup {
	if (sourcePath === ":memory:") throw new Error("An in-memory SQLite database cannot be backed up by this command.")
	const source = resolve(sourcePath)
	const destination = resolve(destinationPath)
	if (source === destination) throw new Error("Backup destination must differ from the source database.")
	if (!existsSync(source) || !statSync(source).isFile()) throw new Error(`Source database file does not exist: ${source}`)
	if (existsSync(destination)) throw new Error(`Backup destination already exists: ${destination}`)

	mkdirSync(dirname(destination), { recursive: true })
	const sourceDb = new DatabaseSync(source)
	try {
		sourceDb.prepare("VACUUM INTO ?").run(destination)
	} catch (error) {
		if (existsSync(destination)) rmSync(destination, { force: true })
		throw new Error(`SQLite backup creation failed: ${error instanceof Error ? error.message : String(error)}`)
	} finally {
		sourceDb.close()
	}

	try {
		const backupDb = new DatabaseSync(destination)
		let integrity: string
		try {
			const result = backupDb.prepare("PRAGMA integrity_check").get() as { integrity_check?: string } | undefined
			integrity = String(result?.integrity_check || "")
		} finally {
			backupDb.close()
		}
		if (integrity !== "ok") throw new Error(`SQLite backup integrity check failed: ${integrity || "no result"}`)
		chmodSync(destination, 0o600)
		return { path: destination, integrity: "ok", sizeBytes: statSync(destination).size }
	} catch (error) {
		if (existsSync(destination)) rmSync(destination, { force: true })
		throw new Error(`SQLite backup was created but could not be verified: ${error instanceof Error ? error.message : String(error)}`)
	}
}
