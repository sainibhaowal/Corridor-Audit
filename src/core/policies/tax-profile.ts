export interface EffectiveWithholdingPolicy {
	rateBps: number
	source: "invoice" | "workspace_profile"
	taxCountry: string
}

/** Resolve an explicit invoice rate first, then the workspace's configured default. */
export function resolveWithholdingPolicy(params: {
	invoiceRateBps?: number
	workspaceRateBps: number
	taxCountry: string
}): EffectiveWithholdingPolicy {
	const rateBps = params.invoiceRateBps ?? params.workspaceRateBps
	if (!Number.isSafeInteger(rateBps) || rateBps < 0 || rateBps > 10_000) {
		throw new Error("Withholding rate must be an integer from 0 to 10,000 basis points.")
	}
	if (!/^[A-Za-z]{2}$/.test(params.taxCountry)) {
		throw new Error("Tax profile country must be a two-letter country code.")
	}
	return {
		rateBps,
		source: params.invoiceRateBps === undefined ? "workspace_profile" : "invoice",
		taxCountry: params.taxCountry.toUpperCase(),
	}
}
