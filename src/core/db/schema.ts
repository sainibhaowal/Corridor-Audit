export type AccountMode = "b2c" | "b2b"
export type IntegrationCategory = "payouts" | "accounting" | "banking" | "email"
export type IntegrationAuthMode = "oauth2" | "api_token" | "open_banking" | "email_forward" | "sftp"
export type IntegrationStatus = "connected" | "disconnected" | "syncing" | "error"
export type TeamRole = "owner" | "controller" | "analyst" | "viewer"
export type RawIngestionChannel = "manual_upload" | "webhook" | "email" | "platform_sync" | "hot_folder"
export type RawIngestionParseStatus = "parsed" | "failed"

export interface RawIngestionRecord {
	id: string
	workspaceId: string
	sourceChannel: RawIngestionChannel
	sourceProvider: string
	filename: string
	format: string
	sha256: string
	sizeBytes: number
	rawContent?: string
	isBase64: boolean
	metadata: Record<string, string>
	parseStatus: RawIngestionParseStatus
	parseError?: string
	caseIds: string[]
	createdAt: string
}

export interface WorkspaceRecord {
	id: string
	name: string
	accountMode: AccountMode
	defaultCurrency: string
	taxCountry: string
	withholdingTaxBps: number
	varianceThresholdMinor: number
	inboundEmailAddress: string
	webhookSigningSecretMasked: string
	requireWebhookSignature: boolean
	createdAt: string
	updatedAt: string
}

export interface WorkspaceTaxPolicyRecord {
	id: string
	workspaceId: string
	country: string
	withholdingTaxBps: number
	effectiveAt: string
	createdAt: string
}

export interface TeamMemberRecord {
	id: string
	workspaceId: string
	email: string
	name: string
	role: TeamRole
	status: "active" | "invited"
	createdAt: string
}

export interface IntegrationRecord {
	id: string
	workspaceId: string
	provider: string
	category: IntegrationCategory
	authMode: IntegrationAuthMode
	status: IntegrationStatus
	accountLabel?: string
	externalAccountId?: string
	config: Record<string, string>
	lastSyncedAt?: string
	lastSyncStatus?: "success" | "failed"
	lastError?: string
	createdAt: string
	updatedAt: string
}

export interface SyncRunRecord {
	id: string
	integrationId: string
	workspaceId: string
	provider: string
	trigger: "manual" | "cron" | "webhook"
	status: "running" | "success" | "failed"
	recordsFetched: number
	casesQueued: number
	error?: string
	startedAt: string
	finishedAt?: string
}

export interface IntegrationCredentials {
	accessToken?: string
	refreshToken?: string
	apiKey?: string
	webhookSecret?: string
	expiresAt?: string
	extra?: Record<string, string>
}

export const CORRIDOR_SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspaces (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	account_mode TEXT NOT NULL DEFAULT 'b2b',
	default_currency TEXT NOT NULL DEFAULT 'USD',
	tax_country TEXT NOT NULL DEFAULT 'US',
	withholding_tax_bps INTEGER NOT NULL DEFAULT 0,
	variance_threshold_minor INTEGER NOT NULL DEFAULT 500,
	inbound_email_address TEXT NOT NULL,
	webhook_signing_secret_enc TEXT NOT NULL,
	require_webhook_signature INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_members (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	email TEXT NOT NULL,
	name TEXT NOT NULL,
	role TEXT NOT NULL DEFAULT 'analyst',
	status TEXT NOT NULL DEFAULT 'active',
	created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_tax_policies (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	country TEXT NOT NULL,
	withholding_tax_bps INTEGER NOT NULL,
	effective_at TEXT NOT NULL,
	created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integrations (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	provider TEXT NOT NULL,
	category TEXT NOT NULL,
	auth_mode TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'disconnected',
	account_label TEXT,
	external_account_id TEXT,
	credentials_enc TEXT,
	config_json TEXT NOT NULL DEFAULT '{}',
	last_synced_at TEXT,
	last_sync_status TEXT,
	last_error TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	UNIQUE(workspace_id, provider)
);

CREATE TABLE IF NOT EXISTS sync_runs (
	id TEXT PRIMARY KEY,
	integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
	workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	provider TEXT NOT NULL,
	trigger_type TEXT NOT NULL,
	status TEXT NOT NULL,
	records_fetched INTEGER NOT NULL DEFAULT 0,
	cases_queued INTEGER NOT NULL DEFAULT 0,
	error TEXT,
	started_at TEXT NOT NULL,
	finished_at TEXT
);

CREATE TABLE IF NOT EXISTS cases (
	case_id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	source_type TEXT NOT NULL,
	title TEXT NOT NULL,
	payload_json TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'queued',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_verdicts (
	case_id TEXT PRIMARY KEY REFERENCES cases(case_id) ON DELETE CASCADE,
	workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	status TEXT NOT NULL,
	verdict_json TEXT NOT NULL,
	completed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS raw_ingestions (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	source_channel TEXT NOT NULL,
	source_provider TEXT NOT NULL,
	filename TEXT NOT NULL,
	format TEXT NOT NULL,
	sha256 TEXT NOT NULL,
	size_bytes INTEGER NOT NULL,
	raw_content TEXT NOT NULL,
	raw_content_encrypted INTEGER NOT NULL DEFAULT 0,
	is_base64 INTEGER NOT NULL DEFAULT 0,
	metadata_json TEXT NOT NULL DEFAULT '{}',
	parse_status TEXT NOT NULL DEFAULT 'parsed',
	parse_error TEXT,
	case_ids_json TEXT NOT NULL DEFAULT '[]',
	created_at TEXT NOT NULL
);
`
