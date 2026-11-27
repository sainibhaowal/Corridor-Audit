"use client"

import { useEffect, useState } from "react"
import { ArrowRight, CheckCircle2, Globe2, Moon, ShieldCheck, Sun, Zap } from "lucide-react"
import { LocalLoginForm } from "@/components/local-login-form"

interface LoginShellProps {
	cognitoMode: boolean
	error?: string
}

export function LoginShell({ cognitoMode, error }: LoginShellProps) {
	const [theme, setTheme] = useState<"dark" | "light">("dark")

	useEffect(() => {
		try {
			const saved = localStorage.getItem("corridor-theme") === "light" ? "light" : "dark"
			setTheme(saved)
			document.documentElement.dataset.theme = saved
		} catch {
			setTheme("dark")
		}
	}, [])

	const toggleTheme = () => {
		const next = theme === "dark" ? "light" : "dark"
		setTheme(next)
		try {
			localStorage.setItem("corridor-theme", next)
		} catch {
			// ignore storage errors
		}
		document.documentElement.dataset.theme = next
	}

	const isLight = theme === "light"

	return (
		<main
			className={`relative grid min-h-screen w-full grid-cols-1 lg:grid-cols-12 transition-colors ${
				isLight ? "bg-[#f4f7f9] text-[#17252c]" : "bg-[#060b10] text-[#e3edef]"
			}`}
		>
			{/* Theme toggle button */}
			<button
				type="button"
				onClick={toggleTheme}
				aria-label={isLight ? "Switch to dark theme" : "Switch to light theme"}
				title={isLight ? "Switch to dark theme" : "Switch to light theme"}
				className={`fixed top-4 right-4 z-30 inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold shadow-sm transition-colors ${
					isLight
						? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
						: "border-[#1f303b] bg-[#0d151d] text-[#c7d3d6] hover:bg-[#13202b]"
				}`}
			>
				{isLight ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5 text-amber-400" />}
				<span>{isLight ? "Dark" : "Light"}</span>
			</button>

			{/* LEFT COVER / HERO PANEL */}
			<section
				className={`relative flex flex-col justify-between overflow-hidden border-b p-8 sm:p-12 lg:col-span-6 lg:border-r lg:border-b-0 ${
					isLight
						? "border-slate-200 bg-gradient-to-br from-[#eef7f4] via-[#f4f9fb] to-[#eef2ff]"
						: "border-[#16232c] bg-gradient-to-br from-[#071119] via-[#09151d] to-[#0a1b1a]"
				}`}
			>
				{/* Subtle atmospheric glows */}
				<div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
					<div
						className={`absolute -top-24 -left-24 h-80 w-80 rounded-full blur-3xl ${
							isLight ? "bg-emerald-300/30" : "bg-emerald-500/15"
						}`}
					/>
					<div
						className={`absolute right-0 bottom-0 h-96 w-96 rounded-full blur-3xl ${
							isLight ? "bg-sky-300/30" : "bg-sky-500/15"
						}`}
					/>
					<div
						className="absolute inset-0 opacity-[0.04]"
						style={{
							backgroundImage:
								"linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
							backgroundSize: "36px 36px",
						}}
					/>
				</div>

				{/* Top Brand Bar with Real Logo */}
				<div className="relative z-10 flex items-center justify-between">
					<div className="flex items-center gap-3">
						<img
							src="/favicon.svg"
							alt="CorridorAudit logo"
							className="h-10 w-10 rounded-xl shadow-md"
						/>
						<div>
							<div className="flex items-center gap-2">
								<span className="text-lg font-bold tracking-tight">CorridorAudit</span>
								<span
									className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold ${
										isLight
									? "border-teal-300 bg-white/80 text-teal-800"
									: "border-[#24504c] bg-[#0c1c1c] text-[#62e1c3]"
									}`}
								>
									v0.3.0
								</span>
							</div>
							<p className={`text-xs ${isLight ? "text-slate-600" : "text-[#81949a]"}`}>
								Concurrent Mozaik Settlement Forensics
							</p>
						</div>
					</div>
				</div>

				{/* Center Cover Copy & Highlights */}
				<div className="relative z-10 my-10 max-w-xl space-y-6">
					<div
						className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold ${
							isLight
								? "border-emerald-300 bg-white/80 text-emerald-800 shadow-xs"
								: "border-[#225b51] bg-[#081513]/80 text-[#62e1c3]"
						}`}
					>
						<span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
						4-Agent Parallel Audit Pipeline · Live ECB Benchmark
					</div>

					<h1 className="text-3xl font-bold tracking-tight sm:text-4xl lg:text-[42px] lg:leading-[1.15]">
						Every cross-border cent,{" "}
						<span className={isLight ? "text-emerald-700" : "text-[#62e1c3]"}>
							verified by concurrent agents.
						</span>
					</h1>

					<p className={`text-sm leading-6 sm:text-base ${isLight ? "text-slate-600" : "text-[#a4b4b8]"}`}>
						Inspect invoice terms, live ECB FX spreads, hidden correspondent wire fees, and exception rules in
						parallel — with deterministic integer-unit ledger reconciliation and human-in-the-loop approval gates.
					</p>

					<div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-3">
						{[
							{
								icon: Zap,
								title: "Parallel Agents",
								desc: "Terms, FX & Wire specialists run concurrently",
							},
							{
								icon: Globe2,
								title: "Live ECB Rates",
								desc: "Frankfurter API spread & benchmark checks",
							},
							{
								icon: ShieldCheck,
								title: "Cent-Exact",
								desc: "Integer-unit balance math & audit trace",
							},
						].map((item) => (
							<div
								key={item.title}
								className={`rounded-xl border p-3.5 backdrop-blur-sm ${
									isLight
										? "border-slate-200/90 bg-white/80 shadow-xs"
										: "border-[#1c2a33] bg-[#0c141c]/80"
								}`}
							>
								<item.icon
									className={`mb-2 h-4 w-4 ${isLight ? "text-emerald-600" : "text-[#62e1c3]"}`}
								/>
								<div className="text-xs font-bold">{item.title}</div>
								<div className={`mt-0.5 text-[11px] leading-4 ${isLight ? "text-slate-600" : "text-[#81949a]"}`}>
									{item.desc}
								</div>
							</div>
						))}
					</div>
				</div>

				{/* Bottom Cover Footer */}
				<div
					className={`relative z-10 flex flex-wrap items-center justify-between gap-2 border-t pt-4 text-[11px] ${
						isLight ? "border-slate-200 text-slate-600" : "border-[#16232c] text-[#71858c]"
					}`}
				>
					<div className="flex items-center gap-2">
						<CheckCircle2 className={`h-3.5 w-3.5 ${isLight ? "text-emerald-600" : "text-emerald-400"}`} />
						<span>Powered by Mozaik @mozaik-ai/core 6.0</span>
					</div>
					<span className="font-mono">Synthetic &amp; Public ECB Data · Not Financial Advice</span>
				</div>
			</section>

			{/* RIGHT LOGIN FORM PANEL */}
			<section
				className={`flex flex-col items-center justify-center px-6 py-12 sm:px-10 lg:col-span-6 ${
					isLight ? "bg-white" : "bg-[#080d12]"
				}`}
			>
				<div className="w-full max-w-md space-y-6">
					<div className="flex items-center gap-3">
						<img
							src="/favicon.svg"
							alt="CorridorAudit"
							className="h-10 w-10 rounded-xl shadow-sm lg:hidden"
						/>
						<div>
							<h2 className="text-xl font-bold tracking-tight">
								{cognitoMode ? "Organization Sign-In" : "Welcome back"}
							</h2>
							<p className={`text-xs ${isLight ? "text-slate-600" : "text-[#81949a]"}`}>
								{cognitoMode
									? "Sign in with your verified organization account."
									: "Sign in to your CorridorAudit workspace or create a local profile."}
							</p>
						</div>
					</div>

					{error && (
						<p
							className={`rounded-lg border px-3 py-2 text-xs ${
								isLight
									? "border-rose-300 bg-rose-50 text-rose-800"
									: "border-red-900 bg-red-950/40 text-red-200"
							}`}
						>
							{error}
						</p>
					)}

					{cognitoMode ? (
						<div className="space-y-4">
							<p className={`text-sm leading-6 ${isLight ? "text-slate-600" : "text-[#bac8cc]"}`}>
								Access is granted only to active workspace members via your configured OAuth identity provider.
							</p>
							<a
								className="flex h-11 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
								href="/api/auth/login"
							>
								<span>Continue with organization sign-in</span>
								<ArrowRight className="h-4 w-4" />
							</a>
						</div>
					) : (
						<LocalLoginForm theme={theme} />
					)}
				</div>
			</section>
		</main>
	)
}
