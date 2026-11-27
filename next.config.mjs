import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

const packageInfo = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"))

function gitValue(args) {
	try {
		return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
	} catch {
		return ""
	}
}

const buildCommit =
	process.env.NEXT_PUBLIC_BUILD_COMMIT ||
	process.env.VERCEL_GIT_COMMIT_SHA ||
	gitValue(["rev-parse", "--short=12", "HEAD"]) ||
	"unknown"
const localStatus = gitValue(["status", "--porcelain", "--untracked-files=all"])
const sourceChanges = localStatus
	.split(/\r?\n/)
	.filter((line) => line && !/^\?\? tsconfig\.tsbuildinfo$/.test(line))
const buildTreeState =
	process.env.NEXT_PUBLIC_BUILD_TREE_STATE ||
	(process.env.VERCEL_GIT_COMMIT_SHA
		? "clean"
		: sourceChanges.length > 0
			? "modified"
			: "clean")

/** @type {import('next').NextConfig} */
const nextConfig = {
	serverExternalPackages: ["@mozaik-ai/core", "dotenv", "zod"],
	env: {
		NEXT_PUBLIC_APP_VERSION: packageInfo.version,
		NEXT_PUBLIC_BUILD_COMMIT: buildCommit,
		NEXT_PUBLIC_BUILD_TREE_STATE: buildTreeState,
		NEXT_PUBLIC_CORRIDOR_AUTH_MODE:
			process.env.CORRIDOR_AUTH_MODE || (process.env.NODE_ENV === "production" ? "cognito" : "local"),
	},
}

export default nextConfig
