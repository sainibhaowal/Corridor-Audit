import "dotenv/config"
import { resolve } from "node:path"
import { backupCorridorDatabase } from "../core/db/backup"

const sourcePath = process.env.CORRIDOR_DB_PATH || resolve(process.cwd(), "data/corridoraudit.db")
const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
const destinationPath = process.env.CORRIDOR_BACKUP_PATH
	|| resolve(process.cwd(), "data/backups", `corridoraudit-${timestamp}.sqlite`)

try {
	const backup = backupCorridorDatabase(sourcePath, destinationPath)
	console.info(`Verified SQLite backup: ${backup.path} (${backup.sizeBytes} bytes, integrity ${backup.integrity})`)
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error))
	process.exitCode = 1
}
