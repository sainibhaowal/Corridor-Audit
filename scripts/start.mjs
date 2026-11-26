import "dotenv/config"
import { exec, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

function openBrowser(url) {
	const cmd =
		process.platform === "win32"
			? `start "" "${url}"`
			: process.platform === "darwin"
				? `open "${url}"`
				: `xdg-open "${url}"`
	exec(cmd, () => {
		// ignore headless launch errors
	})
}

function runCommand(bin, args) {
	return new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(bin, args, {
			stdio: "inherit",
			shell: process.platform === "win32",
			env: process.env,
		})
		child.on("exit", (code) => {
			if (code === 0) resolvePromise()
			else rejectPromise(new Error(`${bin} ${args.join(" ")} exited with code ${code}`))
		})
		child.on("error", rejectPromise)
	})
}

async function main() {
	const host = (process.env.HOST || "127.0.0.1").trim()
	const port = (process.env.PORT || "3000").trim()
	const noOpen = process.argv.includes("--no-open") || process.env.NO_OPEN === "1"
	const nextBin = resolve(
		process.cwd(),
		"node_modules/.bin",
		process.platform === "win32" ? "next.cmd" : "next",
	)

	if (!existsSync(resolve(process.cwd(), ".next/BUILD_ID"))) {
		console.log("Building CorridorAudit Next.js production bundle (first run)...")
		await runCommand(nextBin, ["build"])
	}

	const displayHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host
	const url = `http://${displayHost}:${port}`

	console.log("====================================================================")
	console.log(` CorridorAudit (Next.js 15 + Tailwind + Mozaik 6.0): ${url}`)
	console.log(" Hot Folder Watch: ./data/inbox")
	console.log(" Synthetic & public ECB data only. Not financial or legal advice.")
	console.log("====================================================================")

	const child = spawn(nextBin, ["start", "-H", host, "-p", port], {
		stdio: "inherit",
		shell: process.platform === "win32",
		env: process.env,
	})

	if (!noOpen) {
		setTimeout(() => openBrowser(url), 1800)
	}

	child.on("exit", (code) => {
		process.exit(code ?? 0)
	})
}

main().catch((err) => {
	console.error("Failed to start CorridorAudit Next.js server:", err)
	process.exit(1)
})
