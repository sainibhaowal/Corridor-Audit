import "dotenv/config"
import { exec } from "node:child_process"
import { startCorridorServer } from "./server/app"

function openBrowser(url: string): void {
	const cmd =
		process.platform === "win32"
			? `start "" "${url}"`
			: process.platform === "darwin"
				? `open "${url}"`
				: `xdg-open "${url}"`
	exec(cmd, () => {
		// ignore browser launch errors on headless environments
	})
}

async function main() {
	const noOpen = process.argv.includes("--no-open") || process.env.NO_OPEN === "1"
	const { url, orchestrator } = await startCorridorServer()
	const status = orchestrator.router.getPublicStatus()

	console.log("====================================================================")
	console.log(` CorridorAudit Dashboard Ready: ${url}`)
	console.log(` Mozaik Runtime: @mozaik-ai/core@6.0.0 | Gate Mode: ${orchestrator.state.breakpointMode}`)
	console.log(` Active LLM: ${status.label} (${status.modelName}) [${status.mode.toUpperCase()}]`)
	console.log(` Hot Folder Watch: ./data/inbox`)
	console.log(" Synthetic & public ECB data only. Not financial or legal advice.")
	console.log("====================================================================")

	if (!noOpen) {
		openBrowser(url)
	}
}

main().catch((err) => {
	console.error("Failed to start CorridorAudit:", err)
	process.exit(1)
})
