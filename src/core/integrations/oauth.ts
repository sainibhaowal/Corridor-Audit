import { createHash, randomBytes } from "node:crypto"
import { getCorridorDb } from "../db/database"
import type { IntegrationCredentials } from "../db/schema"

interface OAuthProviderSpec {
	authUrl: string
	tokenUrl: string
	clientIdEnv: string
	clientSecretEnv?: string
	scope: string
	pkce?: boolean
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
		pkce: true,
		scope: "offline_access accounting.transactions.read accounting.reports.read",
	},
	open_banking: {
		authUrl: "https://auth.truelayer.com/",
		tokenUrl: "https://auth.truelayer.com/connect/token",
		clientIdEnv: "TRUELAYER_CLIENT_ID",
		clientSecretEnv: "TRUELAYER_CLIENT_SECRET",
		pkce: true,
		scope: "info accounts balance transactions offline_access",
	},
}

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
	const codeVerifier = spec.pkce ? randomBytes(32).toString("base64url") : undefined
	getCorridorDb().storeOAuthAuthorizationState({
		state,
		provider: params.provider,
		workspaceId: params.workspaceId,
		codeVerifier,
		expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
	})

	const redirectUri = `${params.origin}/api/integrations/${params.provider}/callback`
	const url = new URL(spec.authUrl)
	url.searchParams.set("response_type", "code")
	url.searchParams.set("client_id", clientId)
	url.searchParams.set("redirect_uri", redirectUri)
	url.searchParams.set("scope", spec.scope)
	url.searchParams.set("state", state)
	if (codeVerifier) {
		const codeChallenge = createHash("sha256").update(codeVerifier, "ascii").digest("base64url")
		url.searchParams.set("code_challenge", codeChallenge)
		url.searchParams.set("code_challenge_method", "S256")
	}

	return { url: url.toString(), state }
}

export function consumeOAuthState(state: string, expectedProvider: string): { workspaceId: string; codeVerifier?: string } {
	const entry = getCorridorDb().consumeOAuthAuthorizationState(state, expectedProvider)
	if (!entry) throw new Error("Invalid, expired, or already used OAuth2 state token.")
	return entry
}

export async function exchangeOAuthCode(params: {
	provider: string
	code: string
	origin: string
	codeVerifier?: string
}): Promise<{ credentials: IntegrationCredentials; externalAccountId?: string }> {
	const spec = OAUTH_SPECS[params.provider]
	if (!spec) {
		throw new Error(`OAuth2 token exchange is not supported for "${params.provider}".`)
	}
	const clientId = process.env[spec.clientIdEnv]?.trim()
	const clientSecret = spec.clientSecretEnv ? process.env[spec.clientSecretEnv]?.trim() : undefined
	if (!clientId || (spec.clientSecretEnv && !clientSecret)) {
		throw new Error(`Missing OAuth client configuration for ${params.provider}.`)
	}
	if (spec.pkce && !params.codeVerifier) throw new Error(`Missing PKCE verifier for ${params.provider} authorization.`)

	const redirectUri = `${params.origin}/api/integrations/${params.provider}/callback`
	const bodyParams: Record<string, string> = {
		grant_type: "authorization_code",
		code: params.code,
		redirect_uri: redirectUri,
		client_id: clientId,
	}
	if (clientSecret) bodyParams.client_secret = clientSecret
	if (params.codeVerifier) bodyParams.code_verifier = params.codeVerifier
	const body = new URLSearchParams(bodyParams)

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

export async function refreshOAuthCredentials(
	provider: string,
	credentials: IntegrationCredentials,
): Promise<IntegrationCredentials> {
	const spec = OAUTH_SPECS[provider]
	if (!spec || !credentials.refreshToken) {
		throw new Error(`A refresh token is not available for OAuth provider "${provider}". Reconnect this integration.`)
	}
	const clientId = process.env[spec.clientIdEnv]?.trim()
	const clientSecret = spec.clientSecretEnv ? process.env[spec.clientSecretEnv]?.trim() : undefined
	if (!clientId || (spec.clientSecretEnv && !clientSecret)) {
		throw new Error(`Missing OAuth client configuration for ${provider}.`)
	}
	const body = new URLSearchParams({
		grant_type: "refresh_token",
		refresh_token: credentials.refreshToken,
	})
	const basicSecret = clientSecret ?? ""
	const response = await fetch(spec.tokenUrl, {
		method: "POST",
		headers: {
			Authorization: `Basic ${Buffer.from(`${clientId}:${basicSecret}`).toString("base64")}`,
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
		},
		body: body.toString(),
		signal: AbortSignal.timeout(40_000),
	})
	if (!response.ok) {
		const message = (await response.text()).slice(0, 240)
		throw new Error(`${provider} OAuth token refresh failed (${response.status}): ${message}`)
	}
	const result = (await response.json()) as {
		access_token?: string
		refresh_token?: string
		expires_in?: number
	}
	if (!result.access_token) throw new Error(`${provider} did not return an access token during refresh.`)
	return {
		...credentials,
		accessToken: result.access_token,
		refreshToken: result.refresh_token || credentials.refreshToken,
		expiresAt: result.expires_in && Number.isFinite(result.expires_in)
			? new Date(Date.now() + result.expires_in * 1000).toISOString()
			: undefined,
	}
}
