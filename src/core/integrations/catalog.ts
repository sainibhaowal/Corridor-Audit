import type { AccountMode, IntegrationAuthMode, IntegrationCategory } from "../db/schema"

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
	oauthEnvVars?: { clientId: string; clientSecret: string }
	fields: IntegrationFieldSpec[]
}

export const INTEGRATION_CATALOG: IntegrationCatalogItem[] = [
	{
		provider: "stripe",
		name: "Stripe",
		category: "payouts",
		audiences: ["b2c", "b2b"],
		authModes: ["oauth2", "api_token"],
		defaultAuthMode: "oauth2",
		description: "Connect Stripe Connect or paste a Restricted API Key to sync payouts, balance transactions, and FX fees.",
		dataReceived: "Payout webhooks, gross/net settlement amounts, processing fees, currency conversions",
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
		description: "Sync multi-currency Wise transfers, applied exchange rates, and fee breakdowns automatically.",
		dataReceived: "Transfer webhooks, Wise applied FX rate, source/target amounts, transfer fees",
		oauthEnvVars: { clientId: "WISE_CLIENT_ID", clientSecret: "WISE_CLIENT_SECRET" },
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
		description: "Pull global marketplace payouts and cross-currency withdrawal fees.",
		dataReceived: "Payout status, withdrawal FX spread, platform fees",
		fields: [
			{ key: "apiKey", label: "Payoneer API Token", type: "password", placeholder: "Bearer token", required: true, secret: true },
			{ key: "accountId", label: "Payoneer Account / Program ID", type: "text", placeholder: "e.g. 10004291", required: true },
			{ key: "apiBaseUrl", label: "API Endpoint", type: "url", placeholder: "https://api.payoneer.com/v4", required: false },
		],
	},
	{
		provider: "upwork",
		name: "Upwork",
		category: "payouts",
		audiences: ["b2c"],
		authModes: ["oauth2", "email_forward"],
		defaultAuthMode: "oauth2",
		description: "Track freelance escrow releases, 10% platform fees, and local currency payout spreads.",
		dataReceived: "Earnings & withdrawal statements, platform service fees, net landed payout",
		fields: [
			{ key: "apiKey", label: "Upwork OAuth Access Token", type: "password", placeholder: "OAuth2 bearer token", required: true, secret: true },
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
		description: "Sync multi-currency Revolut account transactions and weekend/interbank FX markups.",
		dataReceived: "Account transactions, applied FX legs, international wire fees",
		fields: [
			{ key: "apiKey", label: "Revolut Business API Key", type: "password", placeholder: "oa_prod_...", required: true, secret: true },
			{ key: "apiBaseUrl", label: "API Base URL", type: "url", placeholder: "https://b2b.revolut.com/api/1.0", required: false },
		],
	},
	{
		provider: "mercury",
		name: "Mercury / Brex Treasury",
		category: "banking",
		audiences: ["b2b"],
		authModes: ["api_token"],
		defaultAuthMode: "api_token",
		description: "Connect B2B corporate treasury accounts for real-time ACH & international SWIFT wire tracking.",
		dataReceived: "Outbound/inbound wires, intermediary bank deductions, SWIFT references",
		fields: [
			{ key: "apiKey", label: "Treasury API Token", type: "password", placeholder: "secret-token:...", required: true, secret: true },
			{ key: "apiBaseUrl", label: "API Base URL", type: "url", placeholder: "https://api.mercury.com/api/v1", required: false },
		],
	},
	{
		provider: "quickbooks",
		name: "QuickBooks Online",
		category: "accounting",
		audiences: ["b2b"],
		authModes: ["oauth2", "api_token"],
		defaultAuthMode: "oauth2",
		description: "Sync company invoices, contracted currencies, and payment terms for automatic wire matching.",
		dataReceived: "Open/paid invoices, customer/vendor details, contracted amounts & tax codes",
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
		description: "Continuously import Xero invoices and bills so every incoming wire has contracted terms.",
		dataReceived: "Invoices, credit notes, withholding tax lines, expected settlement currency",
		oauthEnvVars: { clientId: "XERO_CLIENT_ID", clientSecret: "XERO_CLIENT_SECRET" },
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
		description: "Enterprise ERP invoice & vendor bill sync via RESTlet / SuiteTalk token auth.",
		dataReceived: "Subsidiary invoices, intercompany wires, WHT & FX ledger postings",
		fields: [
			{ key: "apiKey", label: "SuiteTalk Bearer / TBA Token", type: "password", placeholder: "NetSuite token", required: true, secret: true },
			{ key: "accountId", label: "NetSuite Account ID", type: "text", placeholder: "1234567_SB1", required: true },
			{ key: "apiBaseUrl", label: "REST Base URL", type: "url", placeholder: "https://<account>.suitetalk.api.netsuite.com", required: false },
		],
	},
	{
		provider: "open_banking",
		name: "Open Banking (Plaid / TrueLayer)",
		category: "banking",
		audiences: ["b2c", "b2b"],
		authModes: ["open_banking", "api_token"],
		defaultAuthMode: "open_banking",
		description: "Connect HSBC, Citi, Deutsche Bank, JPMorgan, or local bank accounts via Open Banking.",
		dataReceived: "Live bank statement transactions, value dates, FX settlements, bank fees",
		oauthEnvVars: { clientId: "TRUELAYER_CLIENT_ID", clientSecret: "TRUELAYER_CLIENT_SECRET" },
		fields: [
			{ key: "apiKey", label: "Access Token", type: "password", placeholder: "Plaid or TrueLayer access token", required: true, secret: true },
			{ key: "apiBaseUrl", label: "Provider Transactions Endpoint", type: "url", placeholder: "https://api.truelayer.com/data/v1/accounts", required: false },
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
		description: "Watch automated SWIFT MT103 and ISO 20022 camt.053 XML drops from enterprise treasury feeds.",
		dataReceived: "SWIFT MT103 (:32A:, :33B:, :36:, :71A:, :71G:) & camt.053 bank statements",
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
		description: "Forward client PDF invoices, Upwork receipts, or SWIFT wire advices to your unique audit inbox.",
		dataReceived: "PDF invoices, CSV exports, MT103/camt.053 email attachments via Postmark/Resend/Mailgun",
		fields: [
			{ key: "accountLabel", label: "Allowed Sender Domain (optional)", type: "text", placeholder: "e.g. @acme.com", required: false },
		],
	},
]

export function getCatalogItem(provider: string): IntegrationCatalogItem | undefined {
	return INTEGRATION_CATALOG.find((item) => item.provider === provider)
}

export function isOAuthConfiguredForProvider(item: IntegrationCatalogItem): boolean {
	if (!item.oauthEnvVars) return false
	return Boolean(process.env[item.oauthEnvVars.clientId]?.trim() && process.env[item.oauthEnvVars.clientSecret]?.trim())
}
