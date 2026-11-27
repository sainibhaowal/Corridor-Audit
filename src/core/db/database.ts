import { createHash, randomBytes, randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { decryptJson, decryptSecret, encryptJson, encryptSecret, maskSecret } from "../security/vault"
import type { AuditVerdict, SettlementCase } from "../types"
import type { PendingBreakpointDecision } from "../types"
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
	type WorkspaceTaxPolicyRecord,
	type WorkspaceReviewPolicyRecord,
} from "./schema"

export const DEFAULT_WORKSPACE_ID = "ws-default"

function parseJsonStringArray(value: unknown): string[] {
	try {
		const parsed: unknown = JSON.parse(String(value ?? "[]"))
		return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : []
	} catch {
		return []
	}
}

export interface WebhookReceiptResult {
	duplicate: boolean
	conflict: boolean
	status: "received" | "queued" | "failed"
	ingestion: RawIngestionRecord
}

export interface StoredReviewDecision {
	decision: "approve" | "reject" | "stop"
	reason?: string
	approvalId: string
}

export type ResolvePendingApprovalResult =
	| { status: "resolved"; approvalId: string }
	| { status: "not_found" }
	| { status: "same_reviewer" }

export interface DeadLetterCaseRecord {
	caseId: string
	title: string
	attemptCount: number
	lastError: string
	updatedAt: string
	settlementCase: SettlementCase
}

export interface WorkspaceAuditEventInput {
	workspaceId?: string
	actorType: "user" | "system" | "local"
	actorId?: string
	actorEmail?: string
	actorRole?: string
	action: string
	targetType: string
	targetId?: string
	outcome?: "success" | "failure"
	requestId?: string
	metadata?: Record<string, string | number | boolean | null>
}

export interface WorkspaceAuditEvent extends Omit<WorkspaceAuditEventInput, "metadata" | "outcome" | "workspaceId"> {
	workspaceId: string
	sequence: number
	eventId: string
	occurredAt: string
	outcome: "success" | "failure"
	metadata: Record<string, string | number | boolean | null>
	previousHash: string
	eventHash: string
}

export const MAX_CASE_ATTEMPTS = 3

export class CorridorDatabase {
	private readonly db: DatabaseSync

	private inTransaction<T>(work: () => T): T {
		const nested = this.db.isTransaction
		const savepoint = `corridor_${randomUUID().replaceAll("-", "")}`
		this.db.exec(nested ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE")
		try {
			const result = work()
			this.db.exec(nested ? `RELEASE SAVEPOINT ${savepoint}` : "COMMIT")
			return result
		} catch (error) {
			if (nested) {
				this.db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`)
				this.db.exec(`RELEASE SAVEPOINT ${savepoint}`)
			} else {
				this.db.exec("ROLLBACK")
			}
			throw error
		}
	}

	transaction<T>(work: () => T): T {
		return this.inTransaction(work)
	}

	constructor(dbPath?: string) {
		const target = dbPath || process.env.CORRIDOR_DB_PATH || resolve(process.cwd(), "data/corridoraudit.db")
		if (target !== ":memory:") {
			mkdirSync(dirname(target), { recursive: true })
		}
		this.db = new DatabaseSync(target)
		this.db.exec(CORRIDOR_SCHEMA_SQL)
		this.ensureTeamIdentityColumn()
		this.ensureCaseQueueColumns()
		this.ensureSyncRunCaseIdsColumn()
		this.ensureSensitiveJsonEncryptionColumns()
		this.encryptLegacySensitiveJson()
		this.ensureRawContentEncryptionColumn()
		this.encryptLegacyRawContent()
		this.ensureRawMetadataEncryptionColumns()
		this.encryptLegacyRawMetadata()
		this.ensureDefaultWorkspace()
		this.ensureWorkspaceTaxPolicies()
		this.ensureWorkspaceReviewPolicies()
	}

	appendWorkspaceAuditEvent(input: WorkspaceAuditEventInput): WorkspaceAuditEvent {
		const workspaceId = input.workspaceId || DEFAULT_WORKSPACE_ID
		const metadata = input.metadata || {}
		const metadataJson = JSON.stringify(metadata)
		if (metadataJson.length > 4_096) throw new Error("Audit metadata exceeds the 4 KB limit.")
		for (const [label, value] of Object.entries({ action: input.action, targetType: input.targetType })) {
			if (!/^[a-z][a-z0-9_.-]{0,79}$/.test(value)) throw new Error(`Invalid audit ${label}.`)
		}
		const occurredAt = new Date().toISOString()
		const eventId = `evt_${randomUUID()}`
		const clean = (value: string | undefined, max: number) => value?.trim().slice(0, max) || null
		const nestedTransaction = this.db.isTransaction
		this.db.exec(nestedTransaction ? "SAVEPOINT audit_event_append" : "BEGIN IMMEDIATE")
		try {
			const previous = this.db.prepare(`SELECT sequence, event_hash FROM workspace_audit_log
				WHERE workspace_id = ? ORDER BY sequence DESC LIMIT 1`).get(workspaceId) as { sequence: number; event_hash: string } | undefined
			const sequence = (previous?.sequence || 0) + 1
			const event = {
				workspaceId,
				sequence,
				eventId,
				occurredAt,
				actorType: input.actorType,
				actorId: clean(input.actorId, 200),
				actorEmail: clean(input.actorEmail, 320)?.toLowerCase() || null,
				actorRole: clean(input.actorRole, 40),
				action: input.action,
				targetType: input.targetType,
				targetId: clean(input.targetId, 200),
				outcome: input.outcome || "success",
				requestId: clean(input.requestId, 200),
				metadataJson,
				previousHash: previous?.event_hash || "GENESIS",
			}
			const eventHash = createHash("sha256").update(JSON.stringify(event)).digest("hex")
			this.db.prepare(`INSERT INTO workspace_audit_log (
				workspace_id, sequence, event_id, occurred_at, actor_type, actor_id, actor_email, actor_role,
				action, target_type, target_id, outcome, request_id, metadata_json, previous_hash, event_hash
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
				event.workspaceId, event.sequence, event.eventId, event.occurredAt, event.actorType, event.actorId,
				event.actorEmail, event.actorRole, event.action, event.targetType, event.targetId, event.outcome,
				event.requestId, event.metadataJson, event.previousHash, eventHash,
			)
			this.db.exec(nestedTransaction ? "RELEASE SAVEPOINT audit_event_append" : "COMMIT")
			return {
				workspaceId, sequence, eventId, occurredAt, actorType: input.actorType,
				actorId: event.actorId || undefined, actorEmail: event.actorEmail || undefined,
				actorRole: event.actorRole || undefined, action: input.action, targetType: input.targetType,
				targetId: event.targetId || undefined, outcome: event.outcome,
				requestId: event.requestId || undefined, metadata, previousHash: event.previousHash, eventHash,
			}
		} catch (error) {
			if (nestedTransaction) {
				this.db.exec("ROLLBACK TO SAVEPOINT audit_event_append")
				this.db.exec("RELEASE SAVEPOINT audit_event_append")
			} else {
				this.db.exec("ROLLBACK")
			}
			throw error
		}
	}

	listWorkspaceAuditEvents(workspaceId = DEFAULT_WORKSPACE_ID, limit = 100): WorkspaceAuditEvent[] {
		const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)))
		const rows = this.db.prepare(`SELECT * FROM workspace_audit_log WHERE workspace_id = ?
			ORDER BY sequence DESC LIMIT ?`).all(workspaceId, boundedLimit) as Array<Record<string, unknown>>
		return rows.map((row) => ({
			workspaceId: String(row.workspace_id), sequence: Number(row.sequence), eventId: String(row.event_id),
			occurredAt: String(row.occurred_at), actorType: String(row.actor_type) as WorkspaceAuditEvent["actorType"],
			actorId: row.actor_id ? String(row.actor_id) : undefined,
			actorEmail: row.actor_email ? String(row.actor_email) : undefined,
			actorRole: row.actor_role ? String(row.actor_role) : undefined,
			action: String(row.action), targetType: String(row.target_type), targetId: row.target_id ? String(row.target_id) : undefined,
			outcome: String(row.outcome) as WorkspaceAuditEvent["outcome"], requestId: row.request_id ? String(row.request_id) : undefined,
			metadata: JSON.parse(String(row.metadata_json)) as WorkspaceAuditEvent["metadata"],
			previousHash: String(row.previous_hash), eventHash: String(row.event_hash),
		}))
	}

	verifyWorkspaceAuditChain(workspaceId = DEFAULT_WORKSPACE_ID): { valid: boolean; eventCount: number } {
		const rows = this.db.prepare(`SELECT * FROM workspace_audit_log WHERE workspace_id = ? ORDER BY sequence ASC`)
			.all(workspaceId) as Array<Record<string, unknown>>
		let previousHash = "GENESIS"
		for (let index = 0; index < rows.length; index += 1) {
			const row = rows[index]!
			const sequence = Number(row.sequence)
			const event = {
				workspaceId: String(row.workspace_id), sequence, eventId: String(row.event_id),
				occurredAt: String(row.occurred_at), actorType: String(row.actor_type),
				actorId: row.actor_id ? String(row.actor_id) : null,
				actorEmail: row.actor_email ? String(row.actor_email) : null,
				actorRole: row.actor_role ? String(row.actor_role) : null,
				action: String(row.action), targetType: String(row.target_type),
				targetId: row.target_id ? String(row.target_id) : null, outcome: String(row.outcome),
				requestId: row.request_id ? String(row.request_id) : null,
				metadataJson: String(row.metadata_json), previousHash: String(row.previous_hash),
			}
			const hash = createHash("sha256").update(JSON.stringify(event)).digest("hex")
			if (sequence !== index + 1 || event.previousHash !== previousHash || hash !== String(row.event_hash)) {
				return { valid: false, eventCount: rows.length }
			}
			previousHash = hash
		}
		return { valid: true, eventCount: rows.length }
	}

	private ensureCaseQueueColumns(): void {
		const columns = this.db.prepare("PRAGMA table_info(cases)").all() as Array<{ name: string }>
		const existing = new Set(columns.map((column) => column.name))
		if (!existing.has("attempt_count")) this.db.exec("ALTER TABLE cases ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0")
		if (!existing.has("next_attempt_at")) this.db.exec("ALTER TABLE cases ADD COLUMN next_attempt_at TEXT")
		if (!existing.has("last_error")) this.db.exec("ALTER TABLE cases ADD COLUMN last_error TEXT")
		if (!existing.has("worker_id")) this.db.exec("ALTER TABLE cases ADD COLUMN worker_id TEXT")
		if (!existing.has("lease_expires_at")) this.db.exec("ALTER TABLE cases ADD COLUMN lease_expires_at TEXT")
		if (!existing.has("submitted_by_sub")) this.db.exec("ALTER TABLE cases ADD COLUMN submitted_by_sub TEXT")
		this.db.prepare("UPDATE cases SET lease_expires_at = ? WHERE status = 'running' AND lease_expires_at IS NULL")
			.run(new Date(0).toISOString())
		this.db.exec(`UPDATE cases SET status = 'dead_letter', last_error = COALESCE(last_error, 'Migrated terminal failure for operator review.')
			WHERE status = 'failed'`)
		this.db.exec("CREATE INDEX IF NOT EXISTS idx_cases_queue_due ON cases(workspace_id, status, next_attempt_at, created_at)")
		this.db.exec("CREATE INDEX IF NOT EXISTS idx_cases_queue_lease ON cases(workspace_id, status, lease_expires_at, created_at)")
	}

	private ensureSyncRunCaseIdsColumn(): void {
		const columns = this.db.prepare("PRAGMA table_info(sync_runs)").all() as Array<{ name: string }>
		if (!columns.some((column) => column.name === "case_ids_json")) {
			this.db.exec("ALTER TABLE sync_runs ADD COLUMN case_ids_json TEXT NOT NULL DEFAULT '[]'")
		}
	}

	private ensureTeamIdentityColumn(): void {
		const columns = this.db.prepare("PRAGMA table_info(team_members)").all() as Array<{ name: string }>
		if (!columns.some((column) => column.name === "identity_sub")) {
			this.db.exec("ALTER TABLE team_members ADD COLUMN identity_sub TEXT")
		}
		this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_workspace_identity ON team_members(workspace_id, identity_sub) WHERE identity_sub IS NOT NULL")
	}

	private ensureSensitiveJsonEncryptionColumns(): void {
		const migrations: Array<{ table: string; column: string; flag: string }> = [
			{ table: "cases", column: "payload_json", flag: "payload_json_encrypted" },
			{ table: "audit_verdicts", column: "verdict_json", flag: "verdict_json_encrypted" },
			{ table: "review_approvals", column: "pending_json", flag: "pending_json_encrypted" },
		]
		for (const migration of migrations) {
			const columns = this.db.prepare(`PRAGMA table_info(${migration.table})`).all() as Array<{ name: string }>
			if (!columns.some((column) => column.name === migration.flag)) {
				this.db.exec(`ALTER TABLE ${migration.table} ADD COLUMN ${migration.flag} INTEGER NOT NULL DEFAULT 0`)
			}
		}
	}

	private encryptLegacySensitiveJson(): void {
		const fields = [
			{ table: "cases", content: "payload_json", flag: "payload_json_encrypted" },
			{ table: "audit_verdicts", content: "verdict_json", flag: "verdict_json_encrypted" },
			{ table: "review_approvals", content: "pending_json", flag: "pending_json_encrypted" },
		]
		for (const field of fields) {
			const rows = this.db.prepare(`SELECT rowid, ${field.content} AS content FROM ${field.table} WHERE ${field.flag} = 0`).all() as Array<{
				rowid: number
				content: string
			}>
			const update = this.db.prepare(`UPDATE ${field.table} SET ${field.content} = ?, ${field.flag} = 1 WHERE rowid = ?`)
			for (const row of rows) update.run(encryptSecret(row.content), row.rowid)
		}
	}

	private ensureWorkspaceTaxPolicies(): void {
		const workspaces = this.db.prepare("SELECT id, tax_country, withholding_tax_bps FROM workspaces").all() as Array<{
			id: string
			tax_country: string
			withholding_tax_bps: number
		}>
		const latest = this.db.prepare("SELECT id FROM workspace_tax_policies WHERE workspace_id = ? LIMIT 1")
		const insert = this.db.prepare(`INSERT INTO workspace_tax_policies
			(id, workspace_id, country, withholding_tax_bps, effective_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
		for (const workspace of workspaces) {
			if (latest.get(workspace.id)) continue
			const now = new Date().toISOString()
			insert.run(`taxp_${randomUUID().slice(0, 12)}`, workspace.id, workspace.tax_country, workspace.withholding_tax_bps, now, now)
		}
	}

	getCurrentTaxPolicy(workspaceId = DEFAULT_WORKSPACE_ID): WorkspaceTaxPolicyRecord {
		const row = this.db.prepare(`SELECT * FROM workspace_tax_policies WHERE workspace_id = ?
			ORDER BY rowid DESC LIMIT 1`).get(workspaceId) as Record<string, unknown> | undefined
		if (!row) throw new Error(`Tax policy for workspace ${workspaceId} not found.`)
		return {
			id: String(row.id),
			workspaceId: String(row.workspace_id),
			country: String(row.country),
			withholdingTaxBps: Number(row.withholding_tax_bps),
			effectiveAt: String(row.effective_at),
			createdAt: String(row.created_at),
		}
	}

	private ensureWorkspaceReviewPolicies(): void {
		const workspaces = this.db.prepare("SELECT id, variance_threshold_minor FROM workspaces").all() as Array<{
			id: string
			variance_threshold_minor: number
		}>
		const latest = this.db.prepare("SELECT id FROM workspace_review_policies WHERE workspace_id = ? LIMIT 1")
		const insert = this.db.prepare(`INSERT INTO workspace_review_policies
			(id, workspace_id, variance_threshold_minor, threshold_unit, created_at) VALUES (?, ?, ?, 'case_settlement_currency_minor', ?)`)
		for (const workspace of workspaces) {
			if (latest.get(workspace.id)) continue
			insert.run(`reviewp_${randomUUID().slice(0, 12)}`, workspace.id, workspace.variance_threshold_minor, new Date().toISOString())
		}
	}

	getCurrentReviewPolicy(workspaceId = DEFAULT_WORKSPACE_ID): WorkspaceReviewPolicyRecord {
		const row = this.db.prepare(`SELECT * FROM workspace_review_policies WHERE workspace_id = ? ORDER BY rowid DESC LIMIT 1`)
			.get(workspaceId) as Record<string, unknown> | undefined
		if (!row) throw new Error(`Review policy for workspace ${workspaceId} not found.`)
		return {
			id: String(row.id),
			workspaceId: String(row.workspace_id),
			varianceThresholdMinor: Number(row.variance_threshold_minor),
			thresholdUnit: String(row.threshold_unit) as WorkspaceReviewPolicyRecord["thresholdUnit"],
			createdAt: String(row.created_at),
		}
	}

	createPendingApproval(pending: PendingBreakpointDecision, workspaceId = DEFAULT_WORKSPACE_ID): string {
		const id = `approval_${randomUUID()}`
		const requestedAt = pending.createdAt || new Date().toISOString()
		const argsSha256 = createHash("sha256").update(pending.argsJson, "utf8").digest("hex")
		return this.inTransaction(() => {
			const existing = this.db.prepare(`SELECT id FROM review_approvals WHERE workspace_id = ? AND case_id = ?
				AND tool_name = ? AND action_type = ? AND args_sha256 = ? AND status = 'pending' ORDER BY requested_at DESC, rowid DESC LIMIT 1`)
				.get(workspaceId, pending.caseId, pending.toolName, pending.actionType, argsSha256) as { id: string } | undefined
			if (existing) return existing.id
			this.db.prepare(`INSERT INTO review_approvals
				(id, workspace_id, case_id, tool_name, action_type, args_sha256, pending_json, pending_json_encrypted, requested_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`)
				.run(id, workspaceId, pending.caseId, pending.toolName, pending.actionType, argsSha256, encryptSecret(JSON.stringify(pending)), requestedAt)
			this.appendWorkspaceAuditEvent({ workspaceId, actorType: "system", action: "review.requested", targetType: "case", targetId: pending.caseId, metadata: { approvalId: id, toolName: pending.toolName, actionType: pending.actionType } })
			return id
		})
	}

	listPendingApprovals(workspaceId = DEFAULT_WORKSPACE_ID): PendingBreakpointDecision[] {
		const rows = this.db.prepare(`SELECT id, pending_json, pending_json_encrypted, requested_at FROM review_approvals
			WHERE workspace_id = ? AND status = 'pending' ORDER BY requested_at ASC, rowid ASC`).all(workspaceId) as Array<{
			id: string
			pending_json: string
			pending_json_encrypted: number
			requested_at: string
		}>
		return rows.map((row) => {
			const pending = JSON.parse(row.pending_json_encrypted ? decryptSecret(row.pending_json) : row.pending_json) as PendingBreakpointDecision
			return { ...pending, approvalId: row.id, createdAt: pending.createdAt || row.requested_at }
		})
	}

	resolvePendingApproval(params: {
		caseId: string
		approvalId?: string
		decision: StoredReviewDecision["decision"]
		reason?: string
		reviewerSub: string
		reviewerEmail: string
		reviewerRole: string
		workspaceId?: string
		requireIndependentReviewer?: boolean
	}): ResolvePendingApprovalResult {
		const workspaceId = params.workspaceId || DEFAULT_WORKSPACE_ID
		this.db.exec("BEGIN IMMEDIATE")
		try {
			const row = params.approvalId
				? this.db.prepare(`SELECT a.id, c.submitted_by_sub FROM review_approvals a
					LEFT JOIN cases c ON c.case_id = a.case_id AND c.workspace_id = a.workspace_id
					WHERE a.workspace_id = ? AND a.case_id = ? AND a.id = ? AND a.status = 'pending'`)
					.get(workspaceId, params.caseId, params.approvalId) as { id: string; submitted_by_sub: string | null } | undefined
				: this.db.prepare(`SELECT a.id, c.submitted_by_sub FROM review_approvals a
					LEFT JOIN cases c ON c.case_id = a.case_id AND c.workspace_id = a.workspace_id
					WHERE a.workspace_id = ? AND a.case_id = ? AND a.status = 'pending'
					ORDER BY a.requested_at DESC, a.rowid DESC LIMIT 1`).get(workspaceId, params.caseId) as { id: string; submitted_by_sub: string | null } | undefined
			if (!row) {
				this.db.exec("COMMIT")
				return { status: "not_found" }
			}
			if (params.decision === "approve" && params.requireIndependentReviewer && row.submitted_by_sub === params.reviewerSub) {
				this.db.exec("COMMIT")
				return { status: "same_reviewer" }
			}
			const decidedAt = new Date().toISOString()
			const updated = this.db.prepare(`UPDATE review_approvals SET status = ?, decision = ?, reason = ?, reviewer_sub = ?,
				reviewer_email = ?, reviewer_role = ?, decided_at = ? WHERE id = ? AND status = 'pending'`)
				.run(params.decision === "approve" ? "approved" : params.decision === "reject" ? "rejected" : "stopped",
					params.decision, params.reason ?? null, params.reviewerSub, params.reviewerEmail, params.reviewerRole, decidedAt, row.id)
			if (Number(updated.changes) !== 1) {
				this.db.exec("COMMIT")
				return { status: "not_found" }
			}
			this.appendWorkspaceAuditEvent({ workspaceId, actorType: params.reviewerSub === "local-operator" ? "local" : "user", actorId: params.reviewerSub, actorEmail: params.reviewerEmail, actorRole: params.reviewerRole, action: "review.decision", targetType: "case", targetId: params.caseId, metadata: { decision: params.decision, approvalId: row.id } })
			this.db.exec("COMMIT")
			return { status: "resolved", approvalId: row.id }
		} catch (error) {
			this.db.exec("ROLLBACK")
			throw error
		}
	}

	findStoredReviewDecision(caseId: string, argsJson: string, workspaceId = DEFAULT_WORKSPACE_ID): StoredReviewDecision | null {
		const argsSha256 = createHash("sha256").update(argsJson, "utf8").digest("hex")
		const row = this.db.prepare(`SELECT id, decision, reason FROM review_approvals WHERE workspace_id = ? AND case_id = ?
			AND args_sha256 = ? AND status IN ('approved', 'rejected', 'stopped')
			ORDER BY decided_at DESC, rowid DESC LIMIT 1`).get(workspaceId, caseId, argsSha256) as {
			id: string
			decision: StoredReviewDecision["decision"]
			reason: string | null
		} | undefined
		return row ? { approvalId: row.id, decision: row.decision, reason: row.reason ?? undefined } : null
	}

	findStoredHumanOverride(caseId: string, note: string, workspaceId = DEFAULT_WORKSPACE_ID): boolean {
		if (!note.trim()) return false
		const row = this.db.prepare(`SELECT 1 AS allowed FROM review_approvals WHERE workspace_id = ? AND case_id = ?
			AND status = 'rejected' AND decision = 'reject' AND reason = ? ORDER BY decided_at DESC, rowid DESC LIMIT 1`)
			.get(workspaceId, caseId, note) as { allowed: number } | undefined
		return Boolean(row)
	}

	private ensureRawContentEncryptionColumn(): void {
		const columns = this.db.prepare("PRAGMA table_info(raw_ingestions)").all() as Array<{ name: string }>
		if (!columns.some((column) => column.name === "raw_content_encrypted")) {
			this.db.exec("ALTER TABLE raw_ingestions ADD COLUMN raw_content_encrypted INTEGER NOT NULL DEFAULT 0")
		}
	}

	private encryptLegacyRawContent(): void {
		const rows = this.db
			.prepare("SELECT id, raw_content FROM raw_ingestions WHERE raw_content_encrypted = 0")
			.all() as Array<{ id: string; raw_content: string }>
		const update = this.db.prepare("UPDATE raw_ingestions SET raw_content = ?, raw_content_encrypted = 1 WHERE id = ?")
		for (const row of rows) update.run(encryptSecret(row.raw_content), row.id)
	}

	private ensureRawMetadataEncryptionColumns(): void {
		const columns = this.db.prepare("PRAGMA table_info(raw_ingestions)").all() as Array<{ name: string }>
		const existing = new Set(columns.map((column) => column.name))
		for (const flag of ["filename_encrypted", "metadata_json_encrypted", "parse_error_encrypted"]) {
			if (!existing.has(flag)) this.db.exec(`ALTER TABLE raw_ingestions ADD COLUMN ${flag} INTEGER NOT NULL DEFAULT 0`)
		}
	}

	private encryptLegacyRawMetadata(): void {
		const fields = [
			{ column: "filename", flag: "filename_encrypted", nullable: false },
			{ column: "metadata_json", flag: "metadata_json_encrypted", nullable: false },
			{ column: "parse_error", flag: "parse_error_encrypted", nullable: true },
		]
		for (const field of fields) {
			const rows = this.db.prepare(`SELECT rowid, ${field.column} AS content FROM raw_ingestions WHERE ${field.flag} = 0`).all() as Array<{
				rowid: number
				content: string | null
			}>
			const update = this.db.prepare(`UPDATE raw_ingestions SET ${field.column} = ?, ${field.flag} = 1 WHERE rowid = ?`)
			for (const row of rows) {
				const encrypted = row.content === null && field.nullable ? null : encryptSecret(String(row.content ?? ""))
				update.run(encrypted, row.rowid)
			}
		}
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
			throw new Error(`Cannot decrypt webhook signing secret for workspace ${workspaceId}. Verify the configured vault key.`)
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
			throw new Error(`Cannot decrypt webhook signing secret for workspace ${workspaceId}. Verify the configured vault key.`)
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
		const updated = this.getWorkspace(workspaceId)
		if (updated.taxCountry !== current.taxCountry || updated.withholdingTaxBps !== current.withholdingTaxBps) {
			const now = new Date().toISOString()
			this.db.prepare(`INSERT INTO workspace_tax_policies
				(id, workspace_id, country, withholding_tax_bps, effective_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
				.run(`taxp_${randomUUID().slice(0, 12)}`, workspaceId, updated.taxCountry, updated.withholdingTaxBps, now, now)
		}
		if (updated.varianceThresholdMinor !== current.varianceThresholdMinor) {
			this.db.prepare(`INSERT INTO workspace_review_policies
				(id, workspace_id, variance_threshold_minor, threshold_unit, created_at) VALUES (?, ?, ?, 'case_settlement_currency_minor', ?)`)
				.run(`reviewp_${randomUUID().slice(0, 12)}`, workspaceId, updated.varianceThresholdMinor, new Date().toISOString())
		}
		return updated
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

	getTeamMemberByIdentitySub(workspaceId: string, identitySub: string): TeamMemberRecord | null {
		const row = this.db.prepare(`SELECT id, workspace_id, email, name, role, status, created_at FROM team_members
			WHERE workspace_id = ? AND identity_sub = ? AND status = 'active'`).get(workspaceId, identitySub) as Record<string, unknown> | undefined
		return row ? {
			id: String(row.id), workspaceId: String(row.workspace_id), email: String(row.email), name: String(row.name),
			role: String(row.role) as TeamRole, status: String(row.status) as "active" | "invited", createdAt: String(row.created_at),
		} : null
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
		identitySub?: string
	}): TeamMemberRecord | null {
		const workspaceId = params.workspaceId || DEFAULT_WORKSPACE_ID
		const email = params.email.trim().toLowerCase()
		const identitySub = params.identitySub?.trim()
		if (identitySub) {
			const activeIdentity = this.getTeamMemberByIdentitySub(workspaceId, identitySub)
			if (activeIdentity) {
				const conflictingEmail = this.db.prepare(`SELECT id FROM team_members WHERE workspace_id = ? AND lower(email) = ? AND id <> ? LIMIT 1`)
					.get(workspaceId, email, activeIdentity.id) as { id: string } | undefined
				if (conflictingEmail) return null
				if (activeIdentity.email !== email || activeIdentity.name !== (params.name.trim() || email)) {
					this.inTransaction(() => {
						this.db.prepare(`UPDATE team_members SET email = ?, name = ? WHERE workspace_id = ? AND identity_sub = ? AND status = 'active'`)
							.run(email, params.name.trim() || email, workspaceId, identitySub)
						this.appendWorkspaceAuditEvent({ workspaceId, actorType: "user", actorId: identitySub, actorEmail: email, actorRole: activeIdentity.role, action: "team_member.identity_refresh", targetType: "team_member", targetId: activeIdentity.id, metadata: { emailChanged: activeIdentity.email !== email } })
					})
				}
				return this.getTeamMemberByIdentitySub(workspaceId, identitySub)
			}
			const existing = this.db.prepare(`SELECT id, identity_sub FROM team_members
				WHERE workspace_id = ? AND lower(email) = ? ORDER BY created_at ASC LIMIT 1`)
				.get(workspaceId, email) as { id: string; identity_sub: string | null } | undefined
			if (existing?.identity_sub && existing.identity_sub !== identitySub) return null
		}
		if (params.bootstrapOwner) {
			const existing = this.db
				.prepare("SELECT id, identity_sub FROM team_members WHERE workspace_id = ? AND lower(email) = ? ORDER BY created_at ASC LIMIT 1")
				.get(workspaceId, email) as { id: string; identity_sub: string | null } | undefined
			if (existing) {
				if (identitySub && existing.identity_sub && existing.identity_sub !== identitySub) return null
				this.db
					.prepare("UPDATE team_members SET role = 'owner', status = 'active', identity_sub = COALESCE(identity_sub, ?) WHERE id = ? AND workspace_id = ?")
					.run(identitySub ?? null, existing.id, workspaceId)
			} else {
				const id = `tm_${randomUUID().slice(0, 8)}`
				this.db
					.prepare(`INSERT INTO team_members (id, workspace_id, identity_sub, email, name, role, status, created_at)
						VALUES (?, ?, ?, ?, ?, 'owner', 'active', ?)`)
					.run(id, workspaceId, identitySub ?? null, email, params.name.trim() || email, new Date().toISOString())
			}
		}
		if (identitySub) {
			this.db.prepare(`UPDATE team_members SET status = 'active', identity_sub = ?
				WHERE workspace_id = ? AND lower(email) = ? AND status = 'invited'
				AND (identity_sub IS NULL OR identity_sub = ?)`)
				.run(identitySub, workspaceId, email, identitySub)
			this.db.prepare(`UPDATE team_members SET identity_sub = ?
				WHERE workspace_id = ? AND lower(email) = ? AND status = 'active' AND identity_sub IS NULL`)
				.run(identitySub, workspaceId, email)
			return this.getTeamMemberByIdentitySub(workspaceId, identitySub)
		}
		this.db.prepare("UPDATE team_members SET status = 'active' WHERE workspace_id = ? AND lower(email) = ? AND status = 'invited'")
			.run(workspaceId, email)
		return this.listTeamMembers(workspaceId).find((member) => member.email === email && member.status === "active") ?? null
	}

	removeTeamMember(workspaceId: string, memberId: string): "removed" | "not_found" | "last_owner" {
		return this.inTransaction(() => {
			const member = this.db.prepare("SELECT role, status FROM team_members WHERE id = ? AND workspace_id = ?")
				.get(memberId, workspaceId) as { role: TeamRole; status: string } | undefined
			if (!member) return "not_found"
			if (member.role === "owner" && member.status === "active") {
				const owners = this.db.prepare("SELECT COUNT(*) AS count FROM team_members WHERE workspace_id = ? AND role = 'owner' AND status = 'active'")
					.get(workspaceId) as { count: number }
				if (Number(owners.count) <= 1) return "last_owner"
			}
			this.db.prepare("DELETE FROM team_members WHERE id = ? AND workspace_id = ?").run(memberId, workspaceId)
			return "removed"
		})
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

	updateIntegrationCredentials(workspaceId: string, provider: string, credentials: IntegrationCredentials): void {
		const updated = this.db.prepare(`UPDATE integrations SET credentials_enc = ?, updated_at = ?
			WHERE workspace_id = ? AND provider = ? AND status <> 'disconnected'`)
			.run(encryptJson(credentials), new Date().toISOString(), workspaceId, provider)
		if (Number(updated.changes) !== 1) throw new Error(`Cannot update credentials for disconnected integration "${provider}".`)
	}

	claimIntegrationRefreshLease(params: {
		workspaceId: string
		provider: string
		ownerId: string
		leaseMs: number
	}): boolean {
		const now = new Date()
		const nowIso = now.toISOString()
		const expiresAt = new Date(now.getTime() + Math.max(1_000, params.leaseMs)).toISOString()
		const row = this.db.prepare(`INSERT INTO integration_refresh_leases
			(workspace_id, provider, owner_id, lease_expires_at, created_at)
			VALUES (?, ?, ?, ?, ?)
			ON CONFLICT (workspace_id, provider) DO UPDATE SET
				owner_id = excluded.owner_id,
				lease_expires_at = excluded.lease_expires_at,
				created_at = excluded.created_at
			WHERE integration_refresh_leases.lease_expires_at <= ?
			RETURNING owner_id`).get(
			params.workspaceId,
			params.provider,
			params.ownerId,
			expiresAt,
			nowIso,
			nowIso,
		) as { owner_id: string } | undefined
		return row?.owner_id === params.ownerId
	}

	releaseIntegrationRefreshLease(params: { workspaceId: string; provider: string; ownerId: string }): void {
		this.db.prepare(`DELETE FROM integration_refresh_leases
			WHERE workspace_id = ? AND provider = ? AND owner_id = ?`)
			.run(params.workspaceId, params.provider, params.ownerId)
	}

	claimIntegrationSyncLease(params: { workspaceId: string; provider: string; ownerId: string; leaseMs: number }): boolean {
		const now = new Date()
		const nowIso = now.toISOString()
		const expiresAt = new Date(now.getTime() + Math.max(1_000, params.leaseMs)).toISOString()
		const row = this.db.prepare(`INSERT INTO integration_sync_leases
			(workspace_id, provider, owner_id, lease_expires_at, created_at)
			VALUES (?, ?, ?, ?, ?)
			ON CONFLICT (workspace_id, provider) DO UPDATE SET
				owner_id = excluded.owner_id,
				lease_expires_at = excluded.lease_expires_at,
				created_at = excluded.created_at
			WHERE integration_sync_leases.lease_expires_at <= ?
			RETURNING owner_id`).get(params.workspaceId, params.provider, params.ownerId, expiresAt, nowIso, nowIso) as { owner_id: string } | undefined
		return row?.owner_id === params.ownerId
	}

	renewIntegrationSyncLease(params: { workspaceId: string; provider: string; ownerId: string; leaseMs: number }): boolean {
		const now = new Date()
		const nowIso = now.toISOString()
		const expiresAt = new Date(now.getTime() + Math.max(1_000, params.leaseMs)).toISOString()
		const result = this.db.prepare(`UPDATE integration_sync_leases SET lease_expires_at = ?
			WHERE workspace_id = ? AND provider = ? AND owner_id = ? AND lease_expires_at > ?`)
			.run(expiresAt, params.workspaceId, params.provider, params.ownerId, nowIso)
		return Number(result.changes) === 1
	}

	releaseIntegrationSyncLease(params: { workspaceId: string; provider: string; ownerId: string }): void {
		this.db.prepare("DELETE FROM integration_sync_leases WHERE workspace_id = ? AND provider = ? AND owner_id = ?")
			.run(params.workspaceId, params.provider, params.ownerId)
	}

	failInterruptedIntegrationSyncRuns(workspaceId: string, provider: string): number {
		const now = new Date().toISOString()
		this.db.exec("BEGIN IMMEDIATE")
		try {
			const interrupted = this.db.prepare(`UPDATE sync_runs SET status = 'failed', error = ?, finished_at = ?
				WHERE workspace_id = ? AND provider = ? AND status = 'running' RETURNING id`)
				.all("Previous sync worker stopped before reporting completion.", now, workspaceId, provider) as Array<{ id: string }>
			for (const run of interrupted) this.appendWorkspaceAuditEvent({
				workspaceId,
				actorType: "system",
				action: "integration.sync.interrupted",
				targetType: "integration",
				targetId: provider,
				outcome: "failure",
				metadata: { syncRunId: run.id, reason: "lease_expired" },
			})
			this.db.exec("COMMIT")
			return interrupted.length
		} catch (error) {
			this.db.exec("ROLLBACK")
			throw error
		}
	}

	storeOAuthAuthorizationState(params: {
		state: string
		provider: string
		workspaceId: string
		codeVerifier?: string
		expiresAt: string
	}): void {
		const now = new Date().toISOString()
		this.db.prepare("DELETE FROM oauth_authorization_states WHERE expires_at <= ?").run(now)
		this.db.prepare(`INSERT INTO oauth_authorization_states
			(state, provider, workspace_id, code_verifier_enc, expires_at, created_at)
			VALUES (?, ?, ?, ?, ?, ?)`)
			.run(params.state, params.provider, params.workspaceId, params.codeVerifier ? encryptSecret(params.codeVerifier) : null, params.expiresAt, now)
	}

	consumeOAuthAuthorizationState(state: string, expectedProvider: string): { workspaceId: string; codeVerifier?: string } | null {
		const row = this.db.prepare(`DELETE FROM oauth_authorization_states
			WHERE state = ? AND provider = ? AND expires_at > ?
			RETURNING workspace_id, code_verifier_enc`).get(state, expectedProvider, new Date().toISOString()) as {
			workspace_id: string
			code_verifier_enc: string | null
		} | undefined
		if (!row) return null
		return {
			workspaceId: row.workspace_id,
			codeVerifier: row.code_verifier_enc ? decryptSecret(row.code_verifier_enc) : undefined,
		}
	}

	disconnectIntegration(workspaceId: string, provider: string): boolean {
		const result = this.db
			.prepare(
				`UPDATE integrations
				SET status = 'disconnected', credentials_enc = NULL, last_error = NULL, updated_at = ?
				WHERE workspace_id = ? AND provider = ?`,
			)
			.run(new Date().toISOString(), workspaceId, provider)
		return Number(result.changes) === 1
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
		this.inTransaction(() => {
			this.db
				.prepare(
					`INSERT INTO sync_runs (
						id, integration_id, workspace_id, provider, trigger_type, status, started_at
					) VALUES (?, ?, ?, ?, ?, 'running', ?)`,
				)
				.run(id, params.integrationId, params.workspaceId, params.provider, params.trigger, startedAt)
			this.appendWorkspaceAuditEvent({ workspaceId: params.workspaceId, actorType: "system", action: "integration.sync.start", targetType: "integration", targetId: params.provider, metadata: { syncRunId: id, trigger: params.trigger } })
		})
		return {
			id,
			integrationId: params.integrationId,
			workspaceId: params.workspaceId,
			provider: params.provider,
			trigger: params.trigger,
			status: "running",
			auditStatus: "not_queued",
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
		caseIds?: string[]
		error?: string
	}): void {
		this.db.exec("BEGIN IMMEDIATE")
		try {
			const run = this.db.prepare(`UPDATE sync_runs
				SET status = ?, records_fetched = ?, cases_queued = ?, case_ids_json = ?, error = ?, finished_at = ?
				WHERE id = ? RETURNING workspace_id, provider, trigger_type`).get(
				params.status, params.recordsFetched, params.casesQueued, JSON.stringify(params.caseIds ?? []), params.error ?? null, new Date().toISOString(), params.id,
			) as { workspace_id: string; provider: string; trigger_type: string } | undefined
			if (run) this.appendWorkspaceAuditEvent({
				workspaceId: run.workspace_id,
				actorType: "system",
				action: "integration.sync.complete",
				targetType: "integration",
				targetId: run.provider,
				outcome: params.status === "success" ? "success" : "failure",
				metadata: { status: params.status, trigger: run.trigger_type, recordsFetched: params.recordsFetched, casesQueued: params.casesQueued },
			})
			this.db.exec("COMMIT")
		} catch (error) {
			this.db.exec("ROLLBACK")
			throw error
		}
	}

	listRecentSyncRuns(workspaceId = DEFAULT_WORKSPACE_ID, limit = 20): SyncRunRecord[] {
		const rows = this.db
			.prepare("SELECT * FROM sync_runs WHERE workspace_id = ? ORDER BY started_at DESC LIMIT ?")
			.all(workspaceId, limit) as Array<Record<string, unknown>>
		return rows.map((r) => {
			const caseIds = parseJsonStringArray(r.case_ids_json)
			const auditStatus = this.getSyncRunAuditStatus(String(r.workspace_id), String(r.status), Number(r.cases_queued), caseIds)
			return ({
			id: String(r.id),
			integrationId: String(r.integration_id),
			workspaceId: String(r.workspace_id),
			provider: String(r.provider),
			trigger: String(r.trigger_type) as "manual" | "cron" | "webhook",
			status: String(r.status) as "running" | "success" | "failed",
			auditStatus,
			recordsFetched: Number(r.records_fetched),
			casesQueued: Number(r.cases_queued),
			error: r.error ? String(r.error) : undefined,
			startedAt: String(r.started_at),
			finishedAt: r.finished_at ? String(r.finished_at) : undefined,
			})
		})
	}

	private getSyncRunAuditStatus(
		workspaceId: string,
		fetchStatus: string,
		casesQueued: number,
		caseIds: string[],
	): SyncRunRecord["auditStatus"] {
		if (casesQueued === 0) return fetchStatus === "running" ? "unknown" : "not_queued"
		if (caseIds.length === 0 || caseIds.length !== casesQueued) return "unknown"
		const statuses = caseIds.map((caseId) => this.getCaseQueueState(caseId, workspaceId)?.status)
		if (statuses.some((status) => !status)) return "unknown"
		const completed = statuses.filter((status) => status === "completed").length
		const failed = statuses.filter((status) => status === "dead_letter").length
		if (completed === statuses.length) return "completed"
		if (failed === statuses.length) return "failed"
		if (completed > 0 && failed > 0) return "partial"
		if (statuses.includes("running")) return "running"
		return "queued"
	}

	saveCase(settlementCase: SettlementCase, workspaceId = DEFAULT_WORKSPACE_ID, submittedBySub?: string): void {
		const now = new Date().toISOString()
		const result = this.db
			.prepare(
				`INSERT INTO cases (case_id, workspace_id, source_type, title, payload_json, payload_json_encrypted, status, submitted_by_sub, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, 1, 'queued', ?, ?, ?)
				ON CONFLICT(case_id) DO UPDATE SET
					title = excluded.title,
					payload_json = excluded.payload_json,
					payload_json_encrypted = 1,
					submitted_by_sub = COALESCE(cases.submitted_by_sub, excluded.submitted_by_sub),
					updated_at = excluded.updated_at
				WHERE cases.workspace_id = excluded.workspace_id`,
			)
			.run(
				settlementCase.caseId,
				workspaceId,
				settlementCase.channelLabel || settlementCase.wire.format || "inbound",
				settlementCase.title,
				encryptSecret(JSON.stringify(settlementCase)),
				submittedBySub ?? null,
				now,
				now,
			)
		if (Number(result.changes) !== 1) {
			throw new Error(`Case ID ${settlementCase.caseId} is already owned by another workspace.`)
		}
	}

	saveAuditVerdict(verdict: AuditVerdict, workspaceId = DEFAULT_WORKSPACE_ID, workerId?: string): void {
		this.db.exec("BEGIN IMMEDIATE")
		try {
			if (workerId) {
				const update = this.db.prepare(`UPDATE cases SET status = 'completed', next_attempt_at = NULL, last_error = NULL,
					worker_id = NULL, lease_expires_at = NULL, updated_at = ?
					WHERE case_id = ? AND workspace_id = ? AND status = 'running' AND worker_id = ? AND lease_expires_at > ?`)
					.run(new Date().toISOString(), verdict.caseId, workspaceId, workerId, new Date().toISOString())
				if (Number(update.changes) !== 1) throw new Error(`Case lease lost before completion: ${verdict.caseId}`)
			} else {
				const update = this.db.prepare(`UPDATE cases SET status = 'completed', next_attempt_at = NULL, last_error = NULL,
					worker_id = NULL, lease_expires_at = NULL, updated_at = ? WHERE case_id = ? AND workspace_id = ?`)
					.run(new Date().toISOString(), verdict.caseId, workspaceId)
				if (Number(update.changes) !== 1) throw new Error(`Case ${verdict.caseId} does not belong to workspace ${workspaceId}.`)
			}
			this.upsertAuditVerdict(verdict, workspaceId)
			this.appendWorkspaceAuditEvent({ workspaceId, actorType: "system", action: "case.audit.complete", targetType: "case", targetId: verdict.caseId, metadata: { verdictStatus: verdict.status } })
			this.db.exec("COMMIT")
		} catch (error) {
			this.db.exec("ROLLBACK")
			throw error
		}
	}

	private upsertAuditVerdict(verdict: AuditVerdict, workspaceId: string): void {
		const result = this.db
			.prepare(
				`INSERT INTO audit_verdicts (case_id, workspace_id, status, verdict_json, verdict_json_encrypted, completed_at)
				VALUES (?, ?, ?, ?, 1, ?)
				ON CONFLICT(case_id) DO UPDATE SET
					status = excluded.status,
					verdict_json = excluded.verdict_json,
					verdict_json_encrypted = 1,
					completed_at = excluded.completed_at
				WHERE audit_verdicts.workspace_id = excluded.workspace_id`,
			)
			.run(verdict.caseId, workspaceId, verdict.status, encryptSecret(JSON.stringify(verdict)), verdict.completedAt)
		if (Number(result.changes) !== 1) {
			throw new Error(`Verdict case ID ${verdict.caseId} is already owned by another workspace.`)
		}
	}

	listPersistedCases(workspaceId = DEFAULT_WORKSPACE_ID): SettlementCase[] {
		const rows = this.db
			.prepare("SELECT payload_json, payload_json_encrypted FROM cases WHERE workspace_id = ? ORDER BY created_at ASC")
			.all(workspaceId) as Array<{ payload_json: string; payload_json_encrypted: number }>
		return rows.map((r) => JSON.parse(r.payload_json_encrypted ? decryptSecret(r.payload_json) : r.payload_json) as SettlementCase)
	}

	getPersistedCase(caseId: string, workspaceId = DEFAULT_WORKSPACE_ID): SettlementCase | null {
		const row = this.db.prepare(`SELECT payload_json, payload_json_encrypted FROM cases
			WHERE case_id = ? AND workspace_id = ?`).get(caseId, workspaceId) as
			{ payload_json: string; payload_json_encrypted: number } | undefined
		return row ? JSON.parse(row.payload_json_encrypted ? decryptSecret(row.payload_json) : row.payload_json) as SettlementCase : null
	}

	listQueuedCases(workspaceId = DEFAULT_WORKSPACE_ID, limit = 100): SettlementCase[] {
		const now = new Date().toISOString()
		this.db.exec("BEGIN IMMEDIATE")
		try {
			const expired = this.db.prepare(`UPDATE cases SET status = 'dead_letter', last_error = COALESCE(last_error, 'Processing lease expired after the maximum attempt count.'),
			worker_id = NULL, lease_expires_at = NULL, updated_at = ?
			WHERE workspace_id = ? AND status = 'running' AND lease_expires_at <= ? AND attempt_count >= ? RETURNING case_id, attempt_count`)
			.all(now, workspaceId, now, MAX_CASE_ATTEMPTS) as Array<{ case_id: string; attempt_count: number }>
			for (const row of expired) this.appendWorkspaceAuditEvent({ workspaceId, actorType: "system", action: "case.queue.dead_letter", targetType: "case", targetId: row.case_id, metadata: { attempt: row.attempt_count, reason: "lease_exhausted" } })
			this.db.exec("COMMIT")
		} catch (error) {
			this.db.exec("ROLLBACK")
			throw error
		}
		const rows = this.db
			.prepare(`SELECT payload_json, payload_json_encrypted FROM cases WHERE workspace_id = ? AND
				((status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)) OR
				(status = 'running' AND lease_expires_at <= ? AND attempt_count < ?))
				ORDER BY created_at ASC LIMIT ?`)
			.all(workspaceId, now, now, MAX_CASE_ATTEMPTS, limit) as Array<{ payload_json: string; payload_json_encrypted: number }>
		return rows.map((r) => JSON.parse(r.payload_json_encrypted ? decryptSecret(r.payload_json) : r.payload_json) as SettlementCase)
	}

	countQueuedCases(workspaceId = DEFAULT_WORKSPACE_ID): number {
		const row = this.db.prepare("SELECT COUNT(*) AS count FROM cases WHERE workspace_id = ? AND status = 'queued'")
			.get(workspaceId) as { count: number }
		return Number(row.count)
	}

	claimCase(caseId: string, workerId: string, leaseMs = 60_000, workspaceId = DEFAULT_WORKSPACE_ID): boolean {
		const now = new Date()
		const nowIso = now.toISOString()
		this.db.exec("BEGIN IMMEDIATE")
		try {
			const result = this.db.prepare(`UPDATE cases SET status = 'running', attempt_count = attempt_count + 1,
			next_attempt_at = NULL, last_error = NULL, worker_id = ?, lease_expires_at = ?, updated_at = ?
			WHERE case_id = ? AND workspace_id = ? AND attempt_count < ? AND
			((status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)) OR
			(status = 'running' AND lease_expires_at <= ?)) RETURNING attempt_count`)
				.get(workerId, new Date(now.getTime() + leaseMs).toISOString(), nowIso, caseId, workspaceId, MAX_CASE_ATTEMPTS, nowIso, nowIso) as { attempt_count: number } | undefined
			if (result) this.appendWorkspaceAuditEvent({ workspaceId, actorType: "system", actorId: workerId, action: "case.queue.claim", targetType: "case", targetId: caseId, metadata: { attempt: result.attempt_count } })
			this.db.exec("COMMIT")
			return Boolean(result)
		} catch (error) {
			this.db.exec("ROLLBACK")
			throw error
		}
	}

	renewCaseLease(caseId: string, workerId: string, leaseMs = 60_000, workspaceId = DEFAULT_WORKSPACE_ID): boolean {
		const now = new Date()
		const result = this.db.prepare(`UPDATE cases SET lease_expires_at = ?, updated_at = ?
			WHERE case_id = ? AND workspace_id = ? AND status = 'running' AND worker_id = ? AND lease_expires_at > ?`)
			.run(new Date(now.getTime() + leaseMs).toISOString(), now.toISOString(), caseId, workspaceId, workerId, now.toISOString())
		return Number(result.changes) === 1
	}

	getCaseQueueState(caseId: string, workspaceId = DEFAULT_WORKSPACE_ID): { status: string; leaseExpiresAt: string | null } | null {
		const row = this.db.prepare("SELECT status, lease_expires_at FROM cases WHERE case_id = ? AND workspace_id = ?")
			.get(caseId, workspaceId) as { status: string; lease_expires_at: string | null } | undefined
		return row ? { status: row.status, leaseExpiresAt: row.lease_expires_at } : null
	}

	getAuditVerdict(caseId: string, workspaceId = DEFAULT_WORKSPACE_ID): AuditVerdict | null {
		const row = this.db.prepare("SELECT verdict_json, verdict_json_encrypted FROM audit_verdicts WHERE case_id = ? AND workspace_id = ?")
			.get(caseId, workspaceId) as { verdict_json: string; verdict_json_encrypted: number } | undefined
		return row ? JSON.parse(row.verdict_json_encrypted ? decryptSecret(row.verdict_json) : row.verdict_json) as AuditVerdict : null
	}

	markCaseRunning(caseId: string, workspaceId = DEFAULT_WORKSPACE_ID): void {
		this.claimCase(caseId, `legacy-${randomUUID()}`, 60_000, workspaceId)
	}

	markCaseRetry(caseId: string, error: string, retryAt: string, workspaceId = DEFAULT_WORKSPACE_ID, workerId?: string): void {
		this.db.exec("BEGIN IMMEDIATE")
		try {
			const updated = this.db.prepare(`UPDATE cases SET status = 'queued', last_error = ?, next_attempt_at = ?, worker_id = NULL,
			lease_expires_at = NULL, updated_at = ? WHERE case_id = ? AND workspace_id = ? AND status = 'running'
			AND (? IS NULL OR (worker_id = ? AND lease_expires_at > ?)) RETURNING attempt_count`)
				.get(error.slice(0, 2000), retryAt, new Date().toISOString(), caseId, workspaceId, workerId ?? null, workerId ?? null, new Date().toISOString()) as { attempt_count: number } | undefined
			if (updated) this.appendWorkspaceAuditEvent({ workspaceId, actorType: "system", actorId: workerId, action: "case.queue.retry", targetType: "case", targetId: caseId, metadata: { attempt: updated.attempt_count, retryAt } })
			this.db.exec("COMMIT")
		} catch (cause) {
			this.db.exec("ROLLBACK")
			throw cause
		}
	}

	markCaseDeadLetter(caseId: string, error: string, workspaceId = DEFAULT_WORKSPACE_ID, workerId?: string): void {
		this.db.exec("BEGIN IMMEDIATE")
		try {
			const updated = this.db.prepare(`UPDATE cases SET status = 'dead_letter', last_error = ?, next_attempt_at = NULL, worker_id = NULL,
			lease_expires_at = NULL, updated_at = ? WHERE case_id = ? AND workspace_id = ?
			AND (? IS NULL OR (worker_id = ? AND lease_expires_at > ?)) RETURNING attempt_count`)
				.get(error.slice(0, 2000), new Date().toISOString(), caseId, workspaceId, workerId ?? null, workerId ?? null, new Date().toISOString()) as { attempt_count: number } | undefined
			if (updated) this.appendWorkspaceAuditEvent({ workspaceId, actorType: "system", actorId: workerId, action: "case.queue.dead_letter", targetType: "case", targetId: caseId, metadata: { attempt: updated.attempt_count, reason: "processing_failed" } })
			this.db.exec("COMMIT")
		} catch (cause) {
			this.db.exec("ROLLBACK")
			throw cause
		}
	}

	markCaseFailed(caseId: string, workspaceId = DEFAULT_WORKSPACE_ID): void {
		this.markCaseDeadLetter(caseId, "Case processing failed and was moved to dead letter handling.", workspaceId)
	}

	getCaseAttemptCount(caseId: string, workspaceId = DEFAULT_WORKSPACE_ID): number {
		const row = this.db.prepare("SELECT attempt_count FROM cases WHERE case_id = ? AND workspace_id = ?")
			.get(caseId, workspaceId) as { attempt_count: number } | undefined
		return Number(row?.attempt_count || 0)
	}

	listDeadLetterCases(workspaceId = DEFAULT_WORKSPACE_ID, limit = 100): DeadLetterCaseRecord[] {
		const rows = this.db.prepare(`SELECT case_id, title, payload_json, payload_json_encrypted, attempt_count, last_error, updated_at
			FROM cases WHERE workspace_id = ? AND status = 'dead_letter' ORDER BY updated_at DESC LIMIT ?`)
			.all(workspaceId, limit) as Array<Record<string, unknown>>
		return rows.map((row) => ({
			caseId: String(row.case_id),
			title: String(row.title),
			settlementCase: JSON.parse(Number(row.payload_json_encrypted) ? decryptSecret(String(row.payload_json)) : String(row.payload_json)) as SettlementCase,
			attemptCount: Number(row.attempt_count),
			lastError: String(row.last_error || "No error detail recorded."),
			updatedAt: String(row.updated_at),
		}))
	}

	retryDeadLetterCase(caseId: string, workspaceId = DEFAULT_WORKSPACE_ID): SettlementCase | null {
		const now = new Date().toISOString()
		this.db.exec("BEGIN IMMEDIATE")
		try {
			const prior = this.db.prepare(`SELECT attempt_count FROM cases WHERE case_id = ? AND workspace_id = ? AND status = 'dead_letter'`)
				.get(caseId, workspaceId) as { attempt_count: number } | undefined
			if (!prior) {
				this.db.exec("COMMIT")
				return null
			}
			const update = this.db.prepare(`UPDATE cases SET status = 'queued', attempt_count = 0, worker_id = NULL, lease_expires_at = NULL,
			next_attempt_at = NULL, last_error = NULL, updated_at = ?
			WHERE case_id = ? AND workspace_id = ? AND status = 'dead_letter'`).run(now, caseId, workspaceId)
			if (Number(update.changes) !== 1) {
				this.db.exec("COMMIT")
				return null
			}
			const row = this.db.prepare("SELECT payload_json, payload_json_encrypted FROM cases WHERE case_id = ? AND workspace_id = ?")
				.get(caseId, workspaceId) as { payload_json: string; payload_json_encrypted: number } | undefined
			this.appendWorkspaceAuditEvent({ workspaceId, actorType: "local", action: "case.queue.replay", targetType: "case", targetId: caseId, metadata: { previousAttempts: prior.attempt_count } })
			this.db.exec("COMMIT")
			return row ? JSON.parse(row.payload_json_encrypted ? decryptSecret(row.payload_json) : row.payload_json) as SettlementCase : null
		} catch (error) {
			this.db.exec("ROLLBACK")
			throw error
		}
	}

	requeueInterruptedCases(workspaceId = DEFAULT_WORKSPACE_ID): void {
		const now = new Date().toISOString()
		this.db.exec("BEGIN IMMEDIATE")
		try {
			const queued = this.db.prepare(`UPDATE cases SET status = 'queued', next_attempt_at = NULL, worker_id = NULL, lease_expires_at = NULL,
			last_error = 'Processing was interrupted by an application restart.', updated_at = ?
			WHERE workspace_id = ? AND status = 'running' AND attempt_count < ? RETURNING case_id, attempt_count`)
				.all(now, workspaceId, MAX_CASE_ATTEMPTS) as Array<{ case_id: string; attempt_count: number }>
			for (const row of queued) this.appendWorkspaceAuditEvent({ workspaceId, actorType: "system", action: "case.queue.recovered", targetType: "case", targetId: row.case_id, metadata: { attempt: row.attempt_count } })
			const dead = this.db.prepare(`UPDATE cases SET status = 'dead_letter', next_attempt_at = NULL, worker_id = NULL, lease_expires_at = NULL,
			last_error = 'Processing was interrupted after the maximum attempt count.', updated_at = ?
			WHERE workspace_id = ? AND status = 'running' AND attempt_count >= ? RETURNING case_id, attempt_count`)
				.all(now, workspaceId, MAX_CASE_ATTEMPTS) as Array<{ case_id: string; attempt_count: number }>
			for (const row of dead) this.appendWorkspaceAuditEvent({ workspaceId, actorType: "system", action: "case.queue.dead_letter", targetType: "case", targetId: row.case_id, metadata: { attempt: row.attempt_count, reason: "restart_after_attempt_limit" } })
			this.db.exec("COMMIT")
		} catch (error) {
			this.db.exec("ROLLBACK")
			throw error
		}
	}

	listPersistedVerdicts(workspaceId = DEFAULT_WORKSPACE_ID): AuditVerdict[] {
		const rows = this.db
			.prepare("SELECT verdict_json, verdict_json_encrypted FROM audit_verdicts WHERE workspace_id = ? ORDER BY completed_at ASC")
			.all(workspaceId) as Array<{ verdict_json: string; verdict_json_encrypted: number }>
		return rows.map((r) => JSON.parse(r.verdict_json_encrypted ? decryptSecret(r.verdict_json) : r.verdict_json) as AuditVerdict)
	}

	private mapRawIngestionRow(row: Record<string, unknown>, includeContent: boolean): RawIngestionRecord {
		const filename = Boolean(row.filename_encrypted) ? decryptSecret(String(row.filename)) : String(row.filename)
		const metadataJson = Boolean(row.metadata_json_encrypted)
			? decryptSecret(String(row.metadata_json))
			: String(row.metadata_json || "{}")
		const parseError = row.parse_error
			? (Boolean(row.parse_error_encrypted) ? decryptSecret(String(row.parse_error)) : String(row.parse_error))
			: undefined
		return {
			id: String(row.id),
			workspaceId: String(row.workspace_id),
			sourceChannel: String(row.source_channel) as RawIngestionChannel,
			sourceProvider: String(row.source_provider),
			filename,
			format: String(row.format),
			sha256: String(row.sha256),
			sizeBytes: Number(row.size_bytes),
			rawContent: includeContent
				? (Boolean(row.raw_content_encrypted) ? decryptSecret(String(row.raw_content)) : String(row.raw_content))
				: undefined,
			isBase64: Boolean(row.is_base64),
			metadata: JSON.parse(metadataJson) as Record<string, string>,
			parseStatus: String(row.parse_status) as RawIngestionParseStatus,
			parseError,
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

		this.inTransaction(() => {
			this.db
				.prepare(
				`INSERT INTO raw_ingestions (
					id, workspace_id, source_channel, source_provider, filename, filename_encrypted, format,
					sha256, size_bytes, raw_content, raw_content_encrypted, is_base64, metadata_json,
					metadata_json_encrypted, parse_status, parse_error, parse_error_encrypted, case_ids_json, created_at
				) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 1, ?, ?, 1, ?, ?, ?, ?, ?)`,
				)
			.run(
				id,
				workspaceId,
				params.sourceChannel,
				params.sourceProvider,
				encryptSecret(params.filename),
				params.format,
				sha256,
				sizeBytes,
				encryptSecret(params.rawContent),
				Number(Boolean(params.isBase64)),
				encryptSecret(JSON.stringify(params.metadata ?? {})),
				params.parseStatus ?? "parsed",
				params.parseError ? encryptSecret(params.parseError) : null,
				Number(Boolean(params.parseError)),
				JSON.stringify(params.caseIds ?? []),
				createdAt,
				)
			this.appendWorkspaceAuditEvent({
					workspaceId,
					actorType: "system",
					action: "ingestion.received",
					targetType: "raw_ingestion",
					targetId: id,
					outcome: params.parseStatus === "failed" ? "failure" : "success",
					metadata: { channel: params.sourceChannel, provider: params.sourceProvider, format: params.format, sizeBytes, sha256 },
				})
		})

		return this.getRawIngestion(id, true, workspaceId)!
	}

	updateRawIngestionOutcome(params: {
		id: string
		workspaceId?: string
		parseStatus: RawIngestionParseStatus
		parseError?: string
		caseIds?: string[]
	}): void {
		this.inTransaction(() => {
			const updated = this.db
				.prepare(
				`UPDATE raw_ingestions
				SET parse_status = ?, parse_error = ?, parse_error_encrypted = ?, case_ids_json = ?
				WHERE id = ? AND workspace_id = ? RETURNING source_channel, source_provider, size_bytes`,
			)
			.get(
				params.parseStatus,
				params.parseError ? encryptSecret(params.parseError) : null,
				Number(Boolean(params.parseError)),
				JSON.stringify(params.caseIds ?? []),
				params.id,
				params.workspaceId || DEFAULT_WORKSPACE_ID,
			) as { source_channel: string; source_provider: string; size_bytes: number } | undefined
			if (updated) this.appendWorkspaceAuditEvent({
				workspaceId: params.workspaceId || DEFAULT_WORKSPACE_ID,
				actorType: "system",
				action: params.parseStatus === "failed" ? "ingestion.parse.failed" : "ingestion.parse.complete",
				targetType: "raw_ingestion",
				targetId: params.id,
				outcome: params.parseStatus === "failed" ? "failure" : "success",
				metadata: { channel: updated.source_channel, provider: updated.source_provider, caseCount: params.caseIds?.length || 0 },
			})
		})
	}

	recordWebhookReceipt(params: {
		workspaceId?: string
		provider: string
		eventId: string
		sourceChannel: "webhook" | "email"
		filename: string
		format: string
		rawContent: string
		metadata?: Record<string, string>
	}): WebhookReceiptResult {
		const workspaceId = params.workspaceId || DEFAULT_WORKSPACE_ID
		const sha256 = createHash("sha256").update(params.rawContent, "utf8").digest("hex")
		this.db.exec("BEGIN IMMEDIATE")
		try {
			const existing = this.db.prepare(`SELECT payload_sha256, ingestion_id, status FROM webhook_receipts
				WHERE workspace_id = ? AND provider = ? AND event_id = ?`)
				.get(workspaceId, params.provider, params.eventId) as {
					payload_sha256: string
					ingestion_id: string
					status: WebhookReceiptResult["status"]
				} | undefined
			if (existing) {
				const ingestion = this.getRawIngestion(existing.ingestion_id, true, workspaceId)
				if (!ingestion) throw new Error("Webhook receipt references a missing raw ingestion record.")
				this.db.exec("COMMIT")
				return {
					duplicate: true,
					conflict: existing.payload_sha256 !== sha256,
					status: existing.status,
					ingestion,
				}
			}

			const ingestion = this.saveRawIngestion({
				workspaceId,
				sourceChannel: params.sourceChannel,
				sourceProvider: params.provider,
				filename: params.filename,
				format: params.format,
				rawContent: params.rawContent,
				metadata: params.metadata,
			})
			const now = new Date().toISOString()
			this.db.prepare(`INSERT INTO webhook_receipts
				(workspace_id, provider, event_id, payload_sha256, ingestion_id, status, received_at, updated_at)
				VALUES (?, ?, ?, ?, ?, 'received', ?, ?)`)
				.run(workspaceId, params.provider, params.eventId, sha256, ingestion.id, now, now)
			this.db.exec("COMMIT")
			return { duplicate: false, conflict: false, status: "received", ingestion }
		} catch (error) {
			this.db.exec("ROLLBACK")
			throw error
		}
	}

	markWebhookReceiptStatus(params: {
		workspaceId?: string
		provider: string
		eventId: string
		status: WebhookReceiptResult["status"]
	}): void {
		const workspaceId = params.workspaceId || DEFAULT_WORKSPACE_ID
		this.inTransaction(() => {
			const updated = this.db.prepare(`UPDATE webhook_receipts SET status = ?, updated_at = ?
				WHERE workspace_id = ? AND provider = ? AND event_id = ? RETURNING event_id`)
				.get(params.status, new Date().toISOString(), workspaceId, params.provider, params.eventId)
			if (updated) this.appendWorkspaceAuditEvent({ workspaceId, actorType: "system", action: `webhook.status.${params.status}`, targetType: "webhook_event", targetId: params.eventId, outcome: params.status === "failed" ? "failure" : "success", metadata: { provider: params.provider } })
		})
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
						`SELECT id, workspace_id, source_channel, source_provider, filename, filename_encrypted, format,
							sha256, size_bytes, is_base64, metadata_json, metadata_json_encrypted, parse_status, parse_error, parse_error_encrypted,
							case_ids_json, created_at
						FROM raw_ingestions
						WHERE workspace_id = ? AND source_channel = ?
						ORDER BY created_at DESC LIMIT ?`,
					)
					.all(workspaceId, params.channel, limit) as Array<Record<string, unknown>>)
			: (this.db
					.prepare(
						`SELECT id, workspace_id, source_channel, source_provider, filename, filename_encrypted, format,
							sha256, size_bytes, is_base64, metadata_json, metadata_json_encrypted, parse_status, parse_error, parse_error_encrypted,
							case_ids_json, created_at
						FROM raw_ingestions
						WHERE workspace_id = ?
						ORDER BY created_at DESC LIMIT ?`,
					)
					.all(workspaceId, limit) as Array<Record<string, unknown>>)

		return rows.map((r) => this.mapRawIngestionRow(r, false))
	}

	getRawIngestion(id: string, includeContent = true, workspaceId = DEFAULT_WORKSPACE_ID): RawIngestionRecord | null {
		const row = this.db
			.prepare("SELECT * FROM raw_ingestions WHERE id = ? AND workspace_id = ?")
			.get(id, workspaceId) as Record<string, unknown> | undefined
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

	createAuthSession(params: { sessionId: string; identitySub: string; issuedAt: string; expiresAt: string }): void {
		this.inTransaction(() => {
			const now = new Date().toISOString()
			this.db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ? OR (revoked_at IS NOT NULL AND revoked_at <= ?)")
				.run(now, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
			this.db.prepare("INSERT INTO auth_sessions (session_id, identity_sub, issued_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, NULL)")
				.run(params.sessionId, params.identitySub, params.issuedAt, params.expiresAt)
		})
	}

	isAuthSessionActive(sessionId: string, identitySub: string, now = new Date().toISOString()): boolean {
		const row = this.db.prepare(`SELECT 1 AS active FROM auth_sessions
			WHERE session_id = ? AND identity_sub = ? AND revoked_at IS NULL AND expires_at > ?`)
			.get(sessionId, identitySub, now) as { active: number } | undefined
		return Boolean(row)
	}

	revokeAuthSession(sessionId: string, now = new Date().toISOString()): boolean {
		return Number(this.db.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL")
			.run(now, sessionId).changes) === 1
	}

	consumeApiRateLimit(params: {
		bucketKey: string
		limit: number
		windowMs: number
		nowMs?: number
	}): { allowed: boolean; retryAfterSeconds: number; remaining: number } {
		const nowMs = params.nowMs ?? Date.now()
		const windowStartMs = Math.floor(nowMs / params.windowMs) * params.windowMs
		const row = this.db.prepare(`INSERT INTO api_rate_limit_buckets (bucket_key, window_start_ms, request_count)
			VALUES (?, ?, 1)
			ON CONFLICT(bucket_key) DO UPDATE SET
				window_start_ms = excluded.window_start_ms,
				request_count = CASE
					WHEN api_rate_limit_buckets.window_start_ms = excluded.window_start_ms
					THEN api_rate_limit_buckets.request_count + 1
					ELSE 1
				END
			RETURNING request_count`).get(params.bucketKey, windowStartMs) as { request_count: number }
		if (nowMs % (params.windowMs * 10) < 1000) {
			this.db.prepare("DELETE FROM api_rate_limit_buckets WHERE window_start_ms < ?").run(nowMs - params.windowMs * 2)
		}
		const resetAt = windowStartMs + params.windowMs
		return {
			allowed: row.request_count <= params.limit,
			retryAfterSeconds: Math.max(1, Math.ceil((resetAt - nowMs) / 1000)),
			remaining: Math.max(0, params.limit - row.request_count),
		}
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
