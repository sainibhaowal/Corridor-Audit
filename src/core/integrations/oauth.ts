import { randomBytes } from "node:crypto"
import type { IntegrationCredentials } from "../db/schema"

interface OAuthProviderSpec {
	authUrl: string
	tokenUrl: string
	clientIdEnv: string
	clientSecretEnv: string
	scope: string
}

const OAUTH_SPECS: Record<string, OAuthProviderSpec> = {
	stripe: {
		authUrl: "https://connect.stripe.com/oauth/authorize",
		tokenUrl: "https://connect.stripe.com/oauth/token",
		clientIdEnv: "STRIPE_CLIENT_ID",
		clientSecretEnv: "STRIPE_CLIENT_SECRET",
		scope: "read_only",
	},
	wise: {
		authUrl: "https://sandbox.transferwise.tech/oauth/authorize",
		tokenUrl: "https://api.transferwise.com/oauth/token",
		clientIdEnv: "WISE_CLIENT_ID",
		clientSecretEnv: "WISE_CLIENT_SECRET",
		scope: "transfers.read balances.read",
	},
	quickbooks: {
		authUrl: "https://appcenter.intuit.com/connect/oauth2",
		tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
		clientIdEnv: "QUICKBOOKS_CLIENT_ID",
		clientSecretEnv: "QUICKBOOKS_CLIENT_SECRET",
		scope: "com.intuit.quickbooks.accounting",
	},
	xero: {
		authUrl: "https://login.xero.com/identity/connect/authorize",
		tokenUrl: "https://identity.xero.com/connect/token",
		clientIdEnv: "XERO_CLIENT_ID",
		clientSecretEnv: "XERO_CLIENT_SECRET",
		scope: "offline_access accounting.transactions.read accounting.reports.read",
	},
	open_banking: {
		authUrl: "https://auth.truelayer.com/",
		tokenUrl: "https://auth.truelayer.com/connect/token",
		clientIdEnv: "TRUELAYER_CLIENT_ID",
		clientSecretEnv: "TRUELAYER_CLIENT_SECRET",
		scope: "info accounts balance transactions offline_access",
	},
}

const stateStore = new Map<string, { provider: string; workspaceId: string; expiresAt: number }>()

export function createOAuthAuthorizationUrl(params: {
	provider: string
	workspaceId: string
	origin: string
}): { url: string; state: string } {
	const spec = OAUTH_SPECS[params.provider]
	if (!spec) {
		throw new Error(`OAuth2 is not supported for provider "${params.provider}". Use API token connection instead.`)
	}
	const clientId = process.env[spec.clientIdEnv]?.trim()
	if (!clientId) {
		throw new Error(
			`OAuth2 for "${params.provider}" requires ${spec.clientIdEnv} and ${spec.clientSecretEnv} in .env. Alternatively, connect using an API Token directly.`,
		)
	}

	const state = randomBytes(16).toString("hex")
	stateStore.set(state, {
		provider: params.provider,
		workspaceId: params.workspaceId,
		expiresAt: Date.now() + 10 * 60_000,
	})

	const redirectUri = `${params.origin}/api/integrations/${params.provider}/callback`
	const url = new URL(spec.authUrl)
	url.searchParams.set("response_type", "code")
	url.searchParams.set("client_id", clientId)
	url.searchParams.set("redirect_uri", redirectUri)
	url.searchParams.set("scope", spec.scope)
	url.searchParams.set("state", state)

	return { url: url.toString(), state }
}

export function consumeOAuthState(state: string, expectedProvider: string): { workspaceId: string } {
	const entry = stateStore.get(state)
	stateStore.delete(state)
	if (!entry || entry.provider !== expectedProvider || entry.expiresAt < Date.now()) {
		throw new Error("Invalid or expired OAuth2 state token.")
	}
	return { workspaceId: entry.workspaceId }
}

export async function exchangeOAuthCode(params: {
	provider: string
	code: string
	origin: string
}): Promise<{ credentials: IntegrationCredentials; externalAccountId?: string }> {
	const spec = OAUTH_SPECS[params.provider]
	if (!spec) {
		throw new Error(`OAuth2 token exchange is not supported for "${params.provider}".`)
	}
	const clientId = process.env[spec.clientIdEnv]?.trim()
	const clientSecret = process.env[spec.clientSecretEnv]?.trim()
	if (!clientId || !clientSecret) {
		throw new Error(`Missing ${spec.clientIdEnv} or ${spec.clientSecretEnv} in environment.`)
	}

	const redirectUri = `${params.origin}/api/integrations/${params.provider}/callback`
	const body = new URLSearchParams({
		grant_type: "authorization_code",
		code: params.code,
		redirect_uri: redirectUri,
		client_id: clientId,
		client_secret: clientSecret,
	})

	const res = await fetch(spec.tokenUrl, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
		body: body.toString(),
	})

	if (!res.ok) {
		const errText = await res.text()
		throw new Error(`OAuth token exchange failed (${res.status}): ${errText.slice(0, 240)}`)
	}

	const json = (await res.json()) as {
		access_token?: string
		refresh_token?: string
		expires_in?: number
		stripe_user_id?: string
	}

	if (!json.access_token) {
		throw new Error("OAuth provider did not return an access_token.")
	}

	return {
		credentials: {
			accessToken: json.access_token,
			refreshToken: json.refresh_token,
			expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000).toISOString() : undefined,
		},
		externalAccountId: json.stripe_user_id,
	}
}
