import type { CorridorDatabase } from "../../core/db/database"

export interface InProcessPendingApproval {
	approvalId?: string
	resolve: (decision: { decision: "approve" | "reject" | "stop"; reason?: string }) => void
}

export function resolveInvalidatedPendingApprovals(params: {
	db: CorridorDatabase
	workspaceId?: string
	pendingApprovals: Map<string, InProcessPendingApproval>
}): number {
	const currentApprovalIds = new Set(params.db.listPendingApprovals(params.workspaceId).map((approval) => approval.approvalId))
	let resolved = 0
	for (const pending of params.pendingApprovals.values()) {
		if (!pending.approvalId || currentApprovalIds.has(pending.approvalId)) continue
		pending.resolve({
			decision: "stop",
			reason: "Review request expired or the case evidence or policy changed. Re-run the audit for a current review.",
		})
		resolved += 1
	}
	return resolved
}
