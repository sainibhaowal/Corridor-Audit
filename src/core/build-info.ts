export type WorkingTreeState = "clean" | "modified" | "unknown"

export interface BuildProvenance {
	appVersion: string
	sourceRevision: string
	workingTree: WorkingTreeState
	auditRulesVersion: string
}

const appVersion = process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0"
const sourceRevision = process.env.NEXT_PUBLIC_BUILD_COMMIT || "unknown"
const treeState = process.env.NEXT_PUBLIC_BUILD_TREE_STATE

export const BUILD_PROVENANCE: BuildProvenance = {
	appVersion,
	sourceRevision,
	workingTree: treeState === "clean" || treeState === "modified" ? treeState : "unknown",
	auditRulesVersion: "0.1.0",
}

export function formatBuildLabel(provenance = BUILD_PROVENANCE): string {
	const treeLabel = provenance.workingTree === "modified" ? " · local changes" : ""
	const revisionLabel = provenance.sourceRevision === "unknown" ? "" : ` · ${provenance.sourceRevision}`
	return `v${provenance.appVersion}${revisionLabel}${treeLabel}`
}
