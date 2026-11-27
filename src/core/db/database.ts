import { createHash, randomBytes, randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { decryptJson, decryptSecret, encryptJson, encryptSecret, maskSecret } from "../security/vault"
import type { AuditVerdict, SettlementCase } from "../types"
import {
	CORRIDOR_SCHEMA_SQL,
	type AccountMode,
	type IntegrationAuthMode,
	type IntegrationCategory,
	type IntegrationCredentials,
	type IntegrationRecord,
	type IntegrationStatus,
	type RawIngestionChannel,
	type RawIngestionParseStatus,
	type RawIngestionRecord,
	type SyncRunRecord,
	type TeamMemberRecord,
	type TeamRole,
	type WorkspaceRecord,
} from "./schema"

export const DEFAULT_WORKSPACE_ID = "ws-default"

export class CorridorDatabase {
	private readonly db: DatabaseSync

	constructor(dbPath?: string) {
		const target = dbPath || process.env.CORRIDOR_DB_PATH || resolve(process.cwd(), "data/corridoraudit.db")
		if (target !== ":memory:") {
			mkdirSync(dirname(target), { recursive: true })
		}
		this.db = new DatabaseSync(target)
		this.db.exec(CORRIDOR_SCHEMA_SQL)
		this.ensureDefaultWorkspace()
	}

	private ensureDefaultWorkspace(): void {
		const existing = this.db
			.prepare("SELECT id FROM workspaces WHERE id = ?")
			.get(DEFAULT_WORKSPACE_ID) as { id: string } | undefined
		if (existing) return

		const now = new Date().toISOString()
		const secret = `whsec_${randomBytes(24).toString("hex")}`
		const domain = process.env.INBOUND_EMAIL_DOMAIN || "inbound.corridoraudit.com"
		this.db
			.prepare(
				`INSERT INTO workspaces (
					id, name, account_mode, default_currency, tax_country,
					withholding_tax_bps, variance_threshold_minor, inbound_email_address,
					webhook_signing_secret_enc, require_webhook_signature, created_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				DEFAULT_WORKSPACE_ID,
				"Primary Settlement Workspace",
				"b2b",
				"USD",
				"US",
				0,
				500,
				`inbox+${DEFAULT_WORKSPACE_ID}@${domain}`,
				encryptSecret(secret),
				0,
				now,
				now,
			)
	}

	getWorkspace(workspaceId = DEFAULT_WORKSPACE_ID): WorkspaceRecord {
		const row = this.db
			.prepare("SELECT * FROM workspaces WHERE id = ?")
			.get(workspaceId) as Record<string, unknown> | undefined
		if (!row) {
			throw new Error(`Workspace ${workspaceId} not found.`)
		}
		let secretMasked = "whsec_••••••••"
		try {
			const secret = decryptSecret(String(row.webhook_signing_secret_enc))
			secretMasked = maskSecret(secret)
		} catch {
			// Self-heal if local .vault-key was rotated/recreated after DB creation
			const regenerated = this.rotateWebhookSecret(workspaceId)
			secretMasked = maskSecret(regenerated)
		}
		return {
			id: String(row.id),
			name: String(row.name),
			accountMode: String(row.account_mode) as AccountMode,
			defaultCurrency: String(row.default_currency),
			taxCountry: String(row.tax_country),
			withholdingTaxBps: Number(row.withholding_tax_bps),
			varianceThresholdMinor: Number(row.variance_threshold_minor),
			inboundEmailAddress: String(row.inbound_email_address),
			webhookSigningSecretMasked: secretMasked,
			requireWebhookSignature: Boolean(row.require_webhook_signature),
			createdAt: String(row.created_at),
			updatedAt: String(row.updated_at),
		}
	}

	getRawWebhookSecret(workspaceId = DEFAULT_WORKSPACE_ID): string {
		const row = this.db
			.prepare("SELECT webhook_signing_secret_enc FROM workspaces WHERE id = ?")
			.get(workspaceId) as { webhook_signing_secret_enc: string } | undefined
		if (!row) throw new Error(`Workspace ${workspaceId} not found.`)
		try {
			return decryptSecret(row.webhook_signing_secret_enc)
		} catch {
			return this.rotateWebhookSecret(workspaceId)
		}
	}

	rotateWebhookSecret(workspaceId = DEFAULT_WORKSPACE_ID): string {
		const nextSecret = `whsec_${randomBytes(24).toString("hex")}`
		this.db
			.prepare("UPDATE workspaces SET webhook_signing_secret_enc = ?, updated_at = ? WHERE id = ?")
			.run(encryptSecret(nextSecret), new Date().toISOString(), workspaceId)
		return nextSecret
	}

	updateWorkspace(
		workspaceId: string,
		patch: Partial<{
			name: string
			accountMode: AccountMode
			defaultCurrency: string
			taxCountry: string
			withholdingTaxBps: number
			varianceThresholdMinor: number
			requireWebhookSignature: boolean
		}>,
	): WorkspaceRecord {
		const current = this.getWorkspace(workspaceId)
		const now = new Date().toISOString()
		this.db
			.prepare(
				`UPDATE workspaces SET
					name = ?, account_mode = ?, default_currency = ?, tax_country = ?,
					withholding_tax_bps = ?, variance_threshold_minor = ?, require_webhook_signature = ?, updated_at = ?
				WHERE id = ?`,
			)
			.run(
				patch.name?.trim() || current.name,
				patch.accountMode || current.accountMode,
				(patch.defaultCurrency || current.defaultCurrency).toUpperCase(),
				(patch.taxCountry || current.taxCountry).toUpperCase(),
				patch.withholdingTaxBps ?? current.withholdingTaxBps,
				patch.varianceThresholdMinor ?? current.varianceThresholdMinor,
				patch.requireWebhookSignature !== undefined
					? Number(patch.requireWebhookSignature)
					: Number(current.requireWebhookSignature),
				now,
				workspaceId,
			)
		return this.getWorkspace(workspaceId)
	}

	listTeamMembers(workspaceId = DEFAULT_WORKSPACE_ID): TeamMemberRecord[] {
		const rows = this.db
			.prepare("SELECT * FROM team_members WHERE workspace_id = ? ORDER BY created_at ASC")
			.all(workspaceId) as Array<Record<string, unknown>>
		return rows.map((r) => ({
			id: String(r.id),
			workspaceId: String(r.workspace_id),
			email: String(r.email),
			name: String(r.name),
			role: String(r.role) as TeamRole,
			status: String(r.status) as "active" | "invited",
			createdAt: String(r.created_at),
		}))
	}

	addTeamMember(params: {
		workspaceId?: string
		email: string
		name: string
		role: TeamRole
	}): TeamMemberRecord {
		const workspaceId = params.workspaceId || DEFAULT_WORKSPACE_ID
		const id = `tm_${randomUUID().slice(0, 8)}`
		const now = new Date().toISOString()
		this.db
			.prepare(
				`INSERT INTO team_members (id, workspace_id, email, name, role, status, created_at)
				VALUES (?, ?, ?, ?, ?, 'invited', ?)`,
			)
			.run(id, workspaceId, params.email.trim().toLowerCase(), params.name.trim(), params.role, now)
		return {
			id,
			workspaceId,
			email: params.email.trim().toLowerCase(),
			name: params.name.trim(),
			role: params.role,
			status: "invited",
			createdAt: now,
		}
	}

	activateVerifiedTeamMember(params: {
		workspaceId?: string
		email: string
		name: string
		bootstrapOwner?: boolean
	}): TeamMemberRecord | null {
		const workspaceId = params.workspaceId || DEFAULT_WORKSPACE_ID
		const email = params.email.trim().toLowerCase()
		if (params.bootstrapOwner) {
			const existing = this.db
				.prepare("SELECT id FROM team_members WHERE workspace_id = ? AND lower(email) = ? ORDER BY created_at ASC LIMIT 1")
				.get(workspaceId, email) as { id: string } | undefined
			if (existing) {
				this.db
					.prepare("UPDATE team_members SET role = 'owner', status = 'active' WHERE id = ? AND workspace_id = ?")
					.run(existing.id, workspaceId)
			} else {
				const id = `tm_${randomUUID().slice(0, 8)}`
				this.db
					.prepare(`INSERT INTO team_members (id, workspace_id, email, name, role, status, created_at)
						VALUES (?, ?, ?, ?, 'owner', 'active', ?)`)
					.run(id, workspaceId, email, params.name.trim() || email, new Date().toISOString())
			}
		}
		this.db
			.prepare("UPDATE team_members SET status = 'active' WHERE workspace_id = ? AND lower(email) = ? AND status = 'invited'")
			.run(workspaceId, email)
		return this.listTeamMembers(workspaceId).find((member) => member.email === email && member.status === "active") ?? null
	}

	removeTeamMember(workspaceId: string, memberId: string): void {
		this.db.prepare("DELETE FROM team_members WHERE id = ? AND workspace_id = ?").run(memberId, workspaceId)
	}

	private mapIntegrationRow(row: Record<string, unknown>): IntegrationRecord {
		return {
			id: String(row.id),
			workspaceId: String(row.workspace_id),
			provider: String(row.provider),
			category: String(row.category) as IntegrationCategory,
			authMode: String(row.auth_mode) as IntegrationAuthMode,
			status: String(row.status) as IntegrationStatus,
			accountLabel: row.account_label ? String(row.account_label) : undefined,
			externalAccountId: row.external_account_id ? String(row.external_account_id) : undefined,
			config: JSON.parse(String(row.config_json || "{}")) as Record<string, string>,
			lastSyncedAt: row.last_synced_at ? String(row.last_synced_at) : undefined,
			lastSyncStatus: row.last_sync_status ? (String(row.last_sync_status) as "success" | "failed") : undefined,
			lastError: row.last_error ? String(row.last_error) : undefined,
			createdAt: String(row.created_at),
			updatedAt: String(row.updated_at),
		}
	}

	listIntegrations(workspaceId = DEFAULT_WORKSPACE_ID): IntegrationRecord[] {
		const rows = this.db
			.prepare("SELECT * FROM integrations WHERE workspace_id = ? ORDER BY updated_at DESC")
			.all(workspaceId) as Array<Record<string, unknown>>
		return rows.map((r) => this.mapIntegrationRow(r))
	}

	getIntegration(workspaceId: string, provider: string): IntegrationRecord | null {
		const row = this.db
			.prepare("SELECT * FROM integrations WHERE workspace_id = ? AND provider = ?")
			.get(workspaceId, provider) as Record<string, unknown> | undefined
		return row ? this.mapIntegrationRow(row) : null
	}

	upsertIntegration(params: {
		workspaceId?: string
		provider: string
		category: IntegrationCategory
		authMode: IntegrationAuthMode
		status: IntegrationStatus
		accountLabel?: string
		externalAccountId?: string
		credentials?: IntegrationCredentials
		config?: Record<string, string>
	}): IntegrationRecord {
		const workspaceId = params.workspaceId || DEFAULT_WORKSPACE_ID
		const existing = this.getIntegration(workspaceId, params.provider)
		const now = new Date().toISOString()
		const id = existing?.id || `int_${randomUUID().slice(0, 10)}`
		const credentialsEnc = params.credentials ? encryptJson(params.credentials) : null

		if (existing) {
			this.db
				.prepare(
					`UPDATE integrations SET
						category = ?, auth_mode = ?, status = ?,
						account_label = COALESCE(?, account_label),
						external_account_id = COALESCE(?, external_account_id),
						credentials_enc = COALESCE(?, credentials_enc),
						config_json = ?, last_error = NULL, updated_at = ?
					WHERE id = ?`,
				)
				.run(
					params.category,
					params.authMode,
					params.status,
					params.accountLabel ?? null,
					params.externalAccountId ?? null,
					credentialsEnc,
					JSON.stringify({ ...existing.config, ...(params.config ?? {}) }),
					now,
					existing.id,
				)
		} else {
			this.db
				.prepare(
					`INSERT INTO integrations (
						id, workspace_id, provider, category, auth_mode, status,
						account_label, external_account_id, credentials_enc, config_json,
						created_at, updated_at
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					id,
					workspaceId,
					params.provider,
					params.category,
					params.authMode,
					params.status,
					params.accountLabel ?? null,
					params.externalAccountId ?? null,
					credentialsEnc,
					JSON.stringify(params.config ?? {}),
					now,
					now,
				)
		}

		return this.getIntegration(workspaceId, params.provider)!
	}

	getDecryptedCredentials(workspaceId: string, provider: string): IntegrationCredentials | null {
		const row = this.db
			.prepare("SELECT credentials_enc FROM integrations WHERE workspace_id = ? AND provider = ?")
			.get(workspaceId, provider) as { credentials_enc?: string | null } | undefined
		if (!row?.credentials_enc) return null
		return decryptJson<IntegrationCredentials>(row.credentials_enc)
	}

	disconnectIntegration(workspaceId: string, provider: string): void {
		this.db
			.prepare(
				`UPDATE integrations
				SET status = 'disconnected', credentials_enc = NULL, last_error = NULL, updated_at = ?
				WHERE workspace_id = ? AND provider = ?`,
			)
			.run(new Date().toISOString(), workspaceId, provider)
	}

	markIntegrationSyncState(params: {
		integrationId: string
		status: IntegrationStatus
		lastSyncStatus?: "success" | "failed"
		lastError?: string | null
		lastSyncedAt?: string
	}): void {
		this.db
			.prepare(
				`UPDATE integrations
				SET status = ?, last_sync_status = COALESCE(?, last_sync_status),
					last_error = ?, last_synced_at = COALESCE(?, last_synced_at), updated_at = ?
				WHERE id = ?`,
			)
			.run(
				params.status,
				params.lastSyncStatus ?? null,
				params.lastError ?? null,
				params.lastSyncedAt ?? null,
				new Date().toISOString(),
				params.integrationId,
			)
	}

	createSyncRun(params: {
		integrationId: string
		workspaceId: string
		provider: string
		trigger: "manual" | "cron" | "webhook"
	}): SyncRunRecord {
		const id = `sync_${randomUUID().slice(0, 10)}`
		const startedAt = new Date().toISOString()
		this.db
			.prepare(
				`INSERT INTO sync_runs (
					id, integration_id, workspace_id, provider, trigger_type, status, started_at
				) VALUES (?, ?, ?, ?, ?, 'running', ?)`,
			)
			.run(id, params.integrationId, params.workspaceId, params.provider, params.trigger, startedAt)
		return {
			id,
			integrationId: params.integrationId,
			workspaceId: params.workspaceId,
			provider: params.provider,
			trigger: params.trigger,
			status: "running",
			recordsFetched: 0,
			casesQueued: 0,
			startedAt,
		}
	}

	finishSyncRun(params: {
		id: string
		status: "success" | "failed"
		recordsFetched: number
		casesQueued: number
		error?: string
	}): void {
		this.db
			.prepare(
				`UPDATE sync_runs
				SET status = ?, records_fetched = ?, cases_queued = ?, error = ?, finished_at = ?
				WHERE id = ?`,
			)
			.run(
				params.status,
				params.recordsFetched,
				params.casesQueued,
				params.error ?? null,
				new Date().toISOString(),
				params.id,
			)
	}

	listRecentSyncRuns(workspaceId = DEFAULT_WORKSPACE_ID, limit = 20): SyncRunRecord[] {
		const rows = this.db
			.prepare("SELECT * FROM sync_runs WHERE workspace_id = ? ORDER BY started_at DESC LIMIT ?")
			.all(workspaceId, limit) as Array<Record<string, unknown>>
		return rows.map((r) => ({
			id: String(r.id),
			integrationId: String(r.integration_id),
			workspaceId: String(r.workspace_id),
			provider: String(r.provider),
			trigger: String(r.trigger_type) as "manual" | "cron" | "webhook",
			status: String(r.status) as "running" | "success" | "failed",
			recordsFetched: Number(r.records_fetched),
			casesQueued: Number(r.cases_queued),
			error: r.error ? String(r.error) : undefined,
			startedAt: String(r.started_at),
			finishedAt: r.finished_at ? String(r.finished_at) : undefined,
		}))
	}

	saveCase(settlementCase: SettlementCase, workspaceId = DEFAULT_WORKSPACE_ID): void {
		const now = new Date().toISOString()
		this.db
			.prepare(
				`INSERT INTO cases (case_id, workspace_id, source_type, title, payload_json, status, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)
				ON CONFLICT(case_id) DO UPDATE SET
					title = excluded.title,
					payload_json = excluded.payload_json,
					updated_at = excluded.updated_at`,
			)
			.run(
				settlementCase.caseId,
				workspaceId,
				settlementCase.channelLabel || settlementCase.wire.format || "inbound",
				settlementCase.title,
				JSON.stringify(settlementCase),
				now,
				now,
			)
	}

	saveAuditVerdict(verdict: AuditVerdict, workspaceId = DEFAULT_WORKSPACE_ID): void {
		this.db
			.prepare(
				`INSERT INTO audit_verdicts (case_id, workspace_id, status, verdict_json, completed_at)
				VALUES (?, ?, ?, ?, ?)
				ON CONFLICT(case_id) DO UPDATE SET
					status = excluded.status,
					verdict_json = excluded.verdict_json,
					completed_at = excluded.completed_at`,
			)
			.run(verdict.caseId, workspaceId, verdict.status, JSON.stringify(verdict), verdict.completedAt)
		this.db
			.prepare("UPDATE cases SET status = 'completed', updated_at = ? WHERE case_id = ?")
			.run(new Date().toISOString(), verdict.caseId)
	}

	listPersistedCases(workspaceId = DEFAULT_WORKSPACE_ID): SettlementCase[] {
		const rows = this.db
			.prepare("SELECT payload_json FROM cases WHERE workspace_id = ? ORDER BY created_at ASC")
			.all(workspaceId) as Array<{ payload_json: string }>
		return rows.map((r) => JSON.parse(r.payload_json) as SettlementCase)
	}

	listQueuedCases(workspaceId = DEFAULT_WORKSPACE_ID): SettlementCase[] {
		const rows = this.db
			.prepare("SELECT payload_json FROM cases WHERE workspace_id = ? AND status IN ('queued', 'running') ORDER BY created_at ASC")
			.all(workspaceId) as Array<{ payload_json: string }>
		return rows.map((r) => JSON.parse(r.payload_json) as SettlementCase)
	}

	markCaseRunning(caseId: string, workspaceId = DEFAULT_WORKSPACE_ID): void {
		this.db.prepare("UPDATE cases SET status = 'running', updated_at = ? WHERE case_id = ? AND workspace_id = ?")
			.run(new Date().toISOString(), caseId, workspaceId)
	}

	markCaseFailed(caseId: string, workspaceId = DEFAULT_WORKSPACE_ID): void {
		this.db.prepare("UPDATE cases SET status = 'failed', updated_at = ? WHERE case_id = ? AND workspace_id = ?")
			.run(new Date().toISOString(), caseId, workspaceId)
	}

	requeueInterruptedCases(workspaceId = DEFAULT_WORKSPACE_ID): void {
		this.db.prepare("UPDATE cases SET status = 'queued', updated_at = ? WHERE workspace_id = ? AND status = 'running'")
			.run(new Date().toISOString(), workspaceId)
	}

	listPersistedVerdicts(workspaceId = DEFAULT_WORKSPACE_ID): AuditVerdict[] {
		const rows = this.db
			.prepare("SELECT verdict_json FROM audit_verdicts WHERE workspace_id = ? ORDER BY completed_at ASC")
			.all(workspaceId) as Array<{ verdict_json: string }>
		return rows.map((r) => JSON.parse(r.verdict_json) as AuditVerdict)
	}

	private mapRawIngestionRow(row: Record<string, unknown>, includeContent: boolean): RawIngestionRecord {
		return {
			id: String(row.id),
			workspaceId: String(row.workspace_id),
			sourceChannel: String(row.source_channel) as RawIngestionChannel,
			sourceProvider: String(row.source_provider),
			filename: String(row.filename),
			format: String(row.format),
			sha256: String(row.sha256),
			sizeBytes: Number(row.size_bytes),
			rawContent: includeContent ? String(row.raw_content) : undefined,
			isBase64: Boolean(row.is_base64),
			metadata: JSON.parse(String(row.metadata_json || "{}")) as Record<string, string>,
			parseStatus: String(row.parse_status) as RawIngestionParseStatus,
			parseError: row.parse_error ? String(row.parse_error) : undefined,
			caseIds: JSON.parse(String(row.case_ids_json || "[]")) as string[],
			createdAt: String(row.created_at),
		}
	}

	saveRawIngestion(params: {
		workspaceId?: string
		sourceChannel: RawIngestionChannel
		sourceProvider: string
		filename: string
		format: string
		rawContent: string
		isBase64?: boolean
		metadata?: Record<string, string>
		parseStatus?: RawIngestionParseStatus
		parseError?: string
		caseIds?: string[]
	}): RawIngestionRecord {
		const workspaceId = params.workspaceId || DEFAULT_WORKSPACE_ID
		const id = `ing_${randomUUID().slice(0, 12)}`
		const buf = params.isBase64
			? Buffer.from(params.rawContent, "base64")
			: Buffer.from(params.rawContent, "utf8")
		const sha256 = createHash("sha256").update(buf).digest("hex")
		const sizeBytes = buf.byteLength
		const createdAt = new Date().toISOString()

		this.db
			.prepare(
				`INSERT INTO raw_ingestions (
					id, workspace_id, source_channel, source_provider, filename, format,
					sha256, size_bytes, raw_content, is_base64, metadata_json,
					parse_status, parse_error, case_ids_json, created_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				id,
				workspaceId,
				params.sourceChannel,
				params.sourceProvider,
				params.filename,
				params.format,
				sha256,
				sizeBytes,
				params.rawContent,
				Number(Boolean(params.isBase64)),
				JSON.stringify(params.metadata ?? {}),
				params.parseStatus ?? "parsed",
				params.parseError ?? null,
				JSON.stringify(params.caseIds ?? []),
				createdAt,
			)

		return this.getRawIngestion(id, true)!
	}

	updateRawIngestionOutcome(params: {
		id: string
		parseStatus: RawIngestionParseStatus
		parseError?: string
		caseIds?: string[]
	}): void {
		this.db
			.prepare(
				`UPDATE raw_ingestions
				SET parse_status = ?, parse_error = ?, case_ids_json = ?
				WHERE id = ?`,
			)
			.run(
				params.parseStatus,
				params.parseError ?? null,
				JSON.stringify(params.caseIds ?? []),
				params.id,
			)
	}

	listRawIngestions(params?: {
		workspaceId?: string
		channel?: string
		limit?: number
	}): RawIngestionRecord[] {
		const workspaceId = params?.workspaceId || DEFAULT_WORKSPACE_ID
		const limit = Math.min(200, Math.max(1, params?.limit ?? 100))
		const rows = params?.channel && params.channel !== "all"
			? (this.db
					.prepare(
						`SELECT id, workspace_id, source_channel, source_provider, filename, format,
							sha256, size_bytes, is_base64, metadata_json, parse_status, parse_error,
							case_ids_json, created_at
						FROM raw_ingestions
						WHERE workspace_id = ? AND source_channel = ?
						ORDER BY created_at DESC LIMIT ?`,
					)
					.all(workspaceId, params.channel, limit) as Array<Record<string, unknown>>)
			: (this.db
					.prepare(
						`SELECT id, workspace_id, source_channel, source_provider, filename, format,
							sha256, size_bytes, is_base64, metadata_json, parse_status, parse_error,
							case_ids_json, created_at
						FROM raw_ingestions
						WHERE workspace_id = ?
						ORDER BY created_at DESC LIMIT ?`,
					)
					.all(workspaceId, limit) as Array<Record<string, unknown>>)

		return rows.map((r) => this.mapRawIngestionRow(r, false))
	}

	getRawIngestion(id: string, includeContent = true): RawIngestionRecord | null {
		const row = this.db
			.prepare("SELECT * FROM raw_ingestions WHERE id = ?")
			.get(id) as Record<string, unknown> | undefined
		return row ? this.mapRawIngestionRow(row, includeContent) : null
	}

	getRawIngestionStats(workspaceId = DEFAULT_WORKSPACE_ID): Record<string, number> {
		const rows = this.db
			.prepare(
				`SELECT source_channel, parse_status, COUNT(*) as cnt
				FROM raw_ingestions WHERE workspace_id = ?
				GROUP BY source_channel, parse_status`,
			)
			.all(workspaceId) as Array<{ source_channel: string; parse_status: string; cnt: number }>

		const stats: Record<string, number> = {
			total: 0,
			manual_upload: 0,
			webhook: 0,
			email: 0,
			platform_sync: 0,
			hot_folder: 0,
			failed: 0,
		}
		for (const row of rows) {
			stats.total += row.cnt
			if (row.source_channel in stats) {
				stats[row.source_channel] += row.cnt
			}
			if (row.parse_status === "failed") {
				stats.failed += row.cnt
			}
		}
		return stats
	}

	close(): void {
		this.db.close()
	}
}

const globalDbStore = globalThis as typeof globalThis & {
	__corridorDb?: CorridorDatabase
}

export function getCorridorDb(): CorridorDatabase {
	if (!globalDbStore.__corridorDb) {
		globalDbStore.__corridorDb = new CorridorDatabase()
	}
	return globalDbStore.__corridorDb
}
