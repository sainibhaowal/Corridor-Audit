import { redirect } from "next/navigation"

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
	if (process.env.NODE_ENV !== "production" && process.env.CORRIDOR_AUTH_MODE !== "cognito") redirect("/")
	const { error } = await searchParams
	return (
		<main className="flex min-h-screen items-center justify-center bg-[#080d12] px-5 text-[#e3edef]">
			<section className="w-full max-w-md rounded-2xl border border-[#263841] bg-[#101a20] p-7 shadow-2xl">
				<div className="mb-7 flex items-center gap-3">
					<div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-700 bg-[#0d2725] text-lg font-black text-[#75e4c7]">C</div>
					<div>
						<h1 className="text-lg font-bold">CorridorAudit</h1>
						<p className="text-xs text-[#81949a]">Secure workspace sign-in</p>
					</div>
				</div>
				{error && <p className="mb-4 rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-200">{error}</p>}
				<p className="mb-6 text-sm leading-6 text-[#bac8cc]">Sign in with your verified organization account. Access is granted only to active workspace members.</p>
				<a className="flex h-11 items-center justify-center rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-600" href="/api/auth/login">
					Continue with organization sign-in
				</a>
			</section>
		</main>
	)
}
