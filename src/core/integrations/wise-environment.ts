export type WiseEnvironment = "sandbox" | "production"

export interface WiseEnvironmentConfig {
	environment: WiseEnvironment
	apiBaseUrl: string
	authorizationUrl: string
	tokenUrl: string
	clientIdEnv: string
	clientSecretEnv: string
}

export function getWiseEnvironmentConfig(): WiseEnvironmentConfig {
	const configuredEnvironment = process.env.WISE_API_ENVIRONMENT?.trim().toLowerCase()
	if (configuredEnvironment && configuredEnvironment !== "sandbox" && configuredEnvironment !== "production") {
		throw new Error("WISE_API_ENVIRONMENT must be 'sandbox' or 'production'.")
	}
	if (!configuredEnvironment && process.env.NODE_ENV === "production") {
		throw new Error("WISE_API_ENVIRONMENT must be explicitly set to 'sandbox' or 'production' in production.")
	}
	const environment: WiseEnvironment = configuredEnvironment === "production" ? "production" : "sandbox"
	const apiVersion = process.env.WISE_API_VERSION?.trim() || "2026Q4"
	if (!/^20\d{2}Q[1-4]$/.test(apiVersion)) {
		throw new Error("WISE_API_VERSION must use the Wise API version format, for example '2026Q4'.")
	}
	const apiOrigin = environment === "sandbox" ? "https://api.wise-sandbox.com" : "https://api.wise.com"
	return {
		environment,
		apiBaseUrl: `${apiOrigin}/${apiVersion}`,
		authorizationUrl: environment === "sandbox"
			? "https://wise-sandbox.com/oauth/authorize/"
			: "https://wise.com/oauth/authorize/",
		tokenUrl: `${apiOrigin}/${apiVersion}/oauth/token`,
		clientIdEnv: environment === "sandbox" ? "WISE_SANDBOX_CLIENT_ID" : "WISE_PRODUCTION_CLIENT_ID",
		clientSecretEnv: environment === "sandbox" ? "WISE_SANDBOX_CLIENT_SECRET" : "WISE_PRODUCTION_CLIENT_SECRET",
	}
}
