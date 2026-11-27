import type { AccountMode, IntegrationAuthMode, IntegrationCategory } from "../db/schema"
import { getWiseEnvironmentConfig } from "./wise-environment"

export interface IntegrationFieldSpec {
	key: string
	label: string
	type: "text" | "password" | "url"
	placeholder: string
	required: boolean
	secret?: boolean
}

export interface IntegrationCatalogItem {
	provider: string
	name: string
	category: IntegrationCategory
	audiences: AccountMode[]
	authModes: IntegrationAuthMode[]
	defaultAuthMode: IntegrationAuthMode
	description: string
	dataReceived: string
	oauthEnvVars?: { clientId: string; clientSecret?: string }
	fields: IntegrationFieldSpec[]
}

export type IntegrationAdapterMode = "native_provider_api" | "generic_json_endpoint" | "local_folder" | "email_webhook_adapter"

export interface IntegrationAdapterDetails {
	mode: IntegrationAdapterMode
	label: string
	scope: string
}

export function getIntegrationAdapterDetails(provider: string): IntegrationAdapterDetails {
	switch (provider) {
		case "stripe":
			return { mode: "native_provider_api", label: "Native provider API", scope: "Reads Stripe payout records. It does not fetch balance transactions, match invoices, or confirm receiving bank settlement." }
		case "wise":
			return { mode: "native_provider_api", label: "Native provider API", scope: "Reads Wise transfer amounts, currencies, rate, date, and reference with offset pagination. No incremental cursor or invoice and bank matching." }
		case "quickbooks":
			return { mode: "native_provider_api", label: "Native provider API", scope: "Reads QuickBooks invoices only. Payment and bank settlement evidence are not fetched; the unmatched wire is structural, not a payment record." }
		case "xero":
			return { mode: "native_provider_api", label: "Native provider API", scope: "Reads Xero invoices only. Payment and bank settlement evidence are not fetched; the unmatched wire is structural, not a payment record." }
		case "bank_sftp":
			return { mode: "local_folder", label: "Local folder adapter", scope: "Reads supported files from a local hot folder. This adapter does not open an SFTP connection." }
		case "email_inbound":
			return { mode: "email_webhook_adapter", label: "Email webhook adapter", scope: "Parses JSON delivered to the email webhook route. A mailbox and email provider delivery must be configured separately." }
		case "open_banking":
			return { mode: "generic_json_endpoint", label: "Generic JSON endpoint", scope: "Uses the configured OAuth or bearer token and performs one JSON GET. It does not link bank accounts or implement provider transaction pagination." }
		default:
			return { mode: "generic_json_endpoint", label: "Generic JSON endpoint", scope: "Performs one bearer authenticated JSON GET to the configured URL. Vendor specific pagination, cursors, payload mapping, and reconciliation are not implemented." }
	}
}

export const INTEGRATION_CATALOG: IntegrationCatalogItem[] = [
	{
		provider: "stripe",
		name: "Stripe",
		category: "payouts",
		audiences: ["b2c", "b2b"],
		authModes: ["oauth2", "api_token"],
		defaultAuthMode: "oauth2",
		description: "Connect Stripe Connect or an API key to import payout records.",
		dataReceived: "Payout ID, amount, currency, status, creation time, arrival date, and description from the Payouts API",
		oauthEnvVars: { clientId: "STRIPE_CLIENT_ID", clientSecret: "STRIPE_CLIENT_SECRET" },
		fields: [
			{ key: "apiKey", label: "Restricted / Secret API Key", type: "password", placeholder: "rk_live_... or sk_live_...", required: true, secret: true },
			{ key: "webhookSecret", label: "Webhook Signing Secret (optional)", type: "password", placeholder: "whsec_...", required: false, secret: true },
			{ key: "accountLabel", label: "Account Label", type: "text", placeholder: "Main Stripe USD/EUR", required: false },
		],
	},
	{
		provider: "wise",
		name: "Wise (Personal & Business)",
		category: "payouts",
		audiences: ["b2c", "b2b"],
		authModes: ["oauth2", "api_token"],
		defaultAuthMode: "oauth2",
		description: "Import Wise transfer records and their reported source and destination amounts.",
		dataReceived: "Transfer ID, source and destination currencies and amounts, reported rate, creation time, and reference",
		oauthEnvVars: { clientId: "WISE_SANDBOX_CLIENT_ID", clientSecret: "WISE_SANDBOX_CLIENT_SECRET" },
		fields: [
			{ key: "apiKey", label: "Wise API Token", type: "password", placeholder: "Wise personal or business token", required: true, secret: true },
			{ key: "profileId", label: "Wise Profile ID (optional)", type: "text", placeholder: "Auto-detected if blank", required: false },
			{ key: "webhookSecret", label: "Webhook Signing Secret (optional)", type: "password", placeholder: "Wise X-Signature-SHA256 secret", required: false, secret: true },
		],
	},
	{
		provider: "payoneer",
		name: "Payoneer",
		category: "payouts",
		audiences: ["b2c", "b2b"],
		authModes: ["api_token", "oauth2"],
		defaultAuthMode: "api_token",
		description: "Use a configured JSON endpoint to import normalized payout records.",
		dataReceived: "The endpoint response must use the supported CorridorAudit JSON input shape; no native Payoneer mapping is implemented",
		fields: [
			{ key: "apiKey", label: "Payoneer API Token", type: "password", placeholder: "Bearer token", required: true, secret: true },
			{ key: "accountId", label: "Payoneer Account / Program ID", type: "text", placeholder: "e.g. 10004291", required: true },
			{ key: "apiBaseUrl", label: "JSON API Endpoint", type: "url", placeholder: "https://your-provider.example/api/records", required: true },
		],
	},
	{
		provider: "upwork",
		name: "Upwork",
		category: "payouts",
		audiences: ["b2c"],
		authModes: ["api_token", "email_forward"],
		defaultAuthMode: "api_token",
		description: "Use a configured JSON endpoint or the separate email webhook adapter to import records.",
		dataReceived: "The generic endpoint must return the supported CorridorAudit JSON input shape; no native Upwork API mapping is implemented",
		fields: [
			{ key: "apiKey", label: "Upwork OAuth Access Token", type: "password", placeholder: "OAuth2 bearer token", required: true, secret: true },
			{ key: "apiBaseUrl", label: "JSON API Endpoint", type: "url", placeholder: "https://your-provider.example/api/records", required: true },
			{ key: "accountLabel", label: "Freelancer / Agency Name", type: "text", placeholder: "My Upwork Profile", required: false },
		],
	},
	{
		provider: "revolut",
		name: "Revolut Business",
		category: "payouts",
		audiences: ["b2c", "b2b"],
		authModes: ["api_token", "oauth2"],
		defaultAuthMode: "api_token",
		description: "Use a configured JSON endpoint to import normalized payout or transaction records.",
		dataReceived: "The endpoint response must use the supported CorridorAudit JSON input shape; no native Revolut mapping is implemented",
		fields: [
			{ key: "apiKey", label: "Revolut Business API Key", type: "password", placeholder: "oa_prod_...", required: true, secret: true },
			{ key: "apiBaseUrl", label: "JSON API Endpoint", type: "url", placeholder: "https://your-provider.example/api/records", required: true },
		],
	},
	{
		provider: "mercury",
		name: "Mercury / Brex Treasury",
		category: "banking",
		audiences: ["b2b"],
		authModes: ["api_token"],
		defaultAuthMode: "api_token",
		description: "Use a configured JSON endpoint to import normalized treasury records.",
		dataReceived: "The endpoint response must use the supported CorridorAudit JSON input shape; no native Mercury or Brex mapping is implemented",
		fields: [
			{ key: "apiKey", label: "Treasury API Token", type: "password", placeholder: "secret-token:...", required: true, secret: true },
			{ key: "apiBaseUrl", label: "JSON API Endpoint", type: "url", placeholder: "https://your-provider.example/api/records", required: true },
		],
	},
	{
		provider: "quickbooks",
		name: "QuickBooks Online",
		category: "accounting",
		audiences: ["b2b"],
		authModes: ["oauth2", "api_token"],
		defaultAuthMode: "oauth2",
		description: "Import invoice records for review. This connection does not perform automatic payment matching.",
		dataReceived: "Invoice number, total, transaction date, currency, and customer name",
		oauthEnvVars: { clientId: "QUICKBOOKS_CLIENT_ID", clientSecret: "QUICKBOOKS_CLIENT_SECRET" },
		fields: [
			{ key: "apiKey", label: "OAuth2 Access Token", type: "password", placeholder: "Intuit OAuth access token", required: true, secret: true },
			{ key: "realmId", label: "Company Realm ID", type: "text", placeholder: "913035...", required: true },
		],
	},
	{
		provider: "xero",
		name: "Xero",
		category: "accounting",
		audiences: ["b2b"],
		authModes: ["oauth2", "api_token"],
		defaultAuthMode: "oauth2",
		description: "Import Xero invoice records for review. This connection does not import payment or bank settlement evidence.",
		dataReceived: "Invoice number, total, currency, date, and contact name",
		oauthEnvVars: { clientId: "XERO_CLIENT_ID" },
		fields: [
			{ key: "apiKey", label: "OAuth2 Access Token", type: "password", placeholder: "Xero bearer token", required: true, secret: true },
			{ key: "tenantId", label: "Xero Tenant ID", type: "text", placeholder: "xero-tenant-uuid", required: true },
		],
	},
	{
		provider: "netsuite",
		name: "Oracle NetSuite",
		category: "accounting",
		audiences: ["b2b"],
		authModes: ["api_token"],
		defaultAuthMode: "api_token",
		description: "Use a configured JSON endpoint to import normalized ERP records.",
		dataReceived: "The endpoint response must use the supported CorridorAudit JSON input shape; no native NetSuite mapping is implemented",
		fields: [
			{ key: "apiKey", label: "SuiteTalk Bearer / TBA Token", type: "password", placeholder: "NetSuite token", required: true, secret: true },
			{ key: "accountId", label: "NetSuite Account ID", type: "text", placeholder: "1234567_SB1", required: true },
			{ key: "apiBaseUrl", label: "JSON API Endpoint", type: "url", placeholder: "https://your-provider.example/api/records", required: true },
		],
	},
	{
		provider: "open_banking",
		name: "Open Banking (Plaid / TrueLayer)",
		category: "banking",
		audiences: ["b2c", "b2b"],
		authModes: ["open_banking", "api_token"],
		defaultAuthMode: "open_banking",
		description: "Configure a TrueLayer OAuth token flow or bearer token with a JSON endpoint.",
		dataReceived: "The configured endpoint response must use the supported CorridorAudit JSON input shape; no account linking or native Plaid mapping is implemented",
		oauthEnvVars: { clientId: "TRUELAYER_CLIENT_ID", clientSecret: "TRUELAYER_CLIENT_SECRET" },
		fields: [
			{ key: "apiKey", label: "Access Token", type: "password", placeholder: "Plaid or TrueLayer access token", required: true, secret: true },
			{ key: "apiBaseUrl", label: "JSON Transactions Endpoint", type: "url", placeholder: "https://api.truelayer.com/data/v1/transactions", required: true },
			{ key: "accountLabel", label: "Bank & Account Name", type: "text", placeholder: "HSBC EUR Treasury", required: false },
		],
	},
	{
		provider: "bank_sftp",
		name: "Bank SFTP / ISO 20022 Hot Folder",
		category: "banking",
		audiences: ["b2b"],
		authModes: ["sftp"],
		defaultAuthMode: "sftp",
		description: "Import supported files placed in a local hot folder. Configure an external SFTP process to deliver files if needed.",
		dataReceived: "Local JSON, CSV, TXT, XML, MT103, and camt.053 files supported by the existing parsers",
		fields: [
			{ key: "hotFolder", label: "Inbox Directory Path", type: "text", placeholder: "data/inbox", required: false },
			{ key: "accountLabel", label: "Treasury Feed Name", type: "text", placeholder: "Citi Host-to-Host SFTP", required: false },
		],
	},
	{
		provider: "email_inbound",
		name: "Inbound Email Forwarding",
		category: "email",
		audiences: ["b2c", "b2b"],
		authModes: ["email_forward"],
		defaultAuthMode: "email_forward",
		description: "Connect an email delivery service that POSTs its parsed message payload and attachments to the email webhook.",
		dataReceived: "Email webhook JSON and supported PDF, CSV, MT103, and camt.053 attachments; no mailbox provider is provisioned by this app",
		fields: [
			{ key: "accountLabel", label: "Allowed Sender Domain (optional)", type: "text", placeholder: "e.g. @acme.com", required: false },
		],
	},
]

export function getCatalogItem(provider: string): IntegrationCatalogItem | undefined {
	return INTEGRATION_CATALOG.find((item) => item.provider === provider)
}

export function isOAuthConfiguredForProvider(item: IntegrationCatalogItem): boolean {
	if (item.provider === "wise") {
		try {
			const config = getWiseEnvironmentConfig()
			return Boolean(process.env[config.clientIdEnv]?.trim() && process.env[config.clientSecretEnv]?.trim())
		} catch {
			return false
		}
	}
	if (!item.oauthEnvVars) return false
	return Boolean(
		process.env[item.oauthEnvVars.clientId]?.trim() &&
		(!item.oauthEnvVars.clientSecret || process.env[item.oauthEnvVars.clientSecret]?.trim()),
	)
}
