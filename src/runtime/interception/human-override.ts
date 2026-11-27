export function isHumanOverrideAuthorized(storedNote: string | undefined, proposedNote: unknown): proposedNote is string {
	return typeof proposedNote === "string" && proposedNote.length > 0 && storedNote === proposedNote
}
