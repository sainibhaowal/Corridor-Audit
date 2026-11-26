import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

const ALGORITHM = "aes-256-gcm"
const IV_BYTES = 12

let cachedKey: Buffer | null = null

function resolveVaultKey(): Buffer {
	if (cachedKey) return cachedKey

	const envKey = process.env.CORRIDOR_VAULT_KEY?.trim()
	if (envKey) {
		if (/^[0-9a-f]{64}$/i.test(envKey)) {
			cachedKey = Buffer.from(envKey, "hex")
			return cachedKey
		}
		cachedKey = createHash("sha256").update(envKey, "utf8").digest()
		return cachedKey
	}

	const keyPath = resolve(process.cwd(), process.env.CORRIDOR_VAULT_KEY_FILE || "data/.vault-key")
	if (existsSync(keyPath)) {
		const raw = readFileSync(keyPath, "utf8").trim()
		if (/^[0-9a-f]{64}$/i.test(raw)) {
			cachedKey = Buffer.from(raw, "hex")
			return cachedKey
		}
	}

	const generated = randomBytes(32)
	mkdirSync(dirname(keyPath), { recursive: true })
	writeFileSync(keyPath, generated.toString("hex"), { encoding: "utf8", mode: 0o600 })
	cachedKey = generated
	return cachedKey
}

/** Reset cached key (used in isolated tests when env changes). */
export function resetVaultKeyCache(): void {
	cachedKey = null
}

/** Encrypt a UTF-8 plaintext secret using AES-256-GCM. */
export function encryptSecret(plaintext: string): string {
	const key = resolveVaultKey()
	const iv = randomBytes(IV_BYTES)
	const cipher = createCipheriv(ALGORITHM, key, iv)
	const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
	const tag = cipher.getAuthTag()
	return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`
}

/** Decrypt an AES-256-GCM payload produced by encryptSecret. */
export function decryptSecret(payload: string): string {
	const parts = payload.split(":")
	if (parts.length !== 4 || parts[0] !== "v1") {
		throw new Error("Invalid encrypted vault payload format.")
	}
	const key = resolveVaultKey()
	const iv = Buffer.from(parts[1], "base64")
	const tag = Buffer.from(parts[2], "base64")
	const ciphertext = Buffer.from(parts[3], "base64")
	const decipher = createDecipheriv(ALGORITHM, key, iv)
	decipher.setAuthTag(tag)
	const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
	return decrypted.toString("utf8")
}

export function encryptJson(value: unknown): string {
	return encryptSecret(JSON.stringify(value))
}

export function decryptJson<T>(payload: string): T {
	return JSON.parse(decryptSecret(payload)) as T
}

export function maskSecret(secret?: string): string {
	if (!secret) return ""
	if (secret.length <= 8) return "••••••••"
	return `${secret.slice(0, 4)}••••${secret.slice(-4)}`
}
