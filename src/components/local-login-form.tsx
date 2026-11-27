"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Eye, EyeOff, Lock, Mail, Sparkles, User } from "lucide-react"

interface LocalLoginFormProps {
	theme?: "dark" | "light"
}

export function LocalLoginForm({ theme = "dark" }: LocalLoginFormProps) {
	const router = useRouter()
	const [mode, setMode] = useState<"login" | "register">("login")
	const [name, setName] = useState("Test Admin")
	const [email, setEmail] = useState("testadmin@corridoraudit.local")
	const [password, setPassword] = useState("Admin@1234")
	const [showPassword, setShowPassword] = useState(false)
	const [busy, setBusy] = useState(false)
	const [errorMsg, setErrorMsg] = useState<string | null>(null)

	const isLight = theme === "light"

	const fillTestAdmin = () => {
		setMode("login")
		setName("Test Admin")
		setEmail("testadmin@corridoraudit.local")
		setPassword("Admin@1234")
		setErrorMsg(null)
	}

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		setErrorMsg(null)
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
			setErrorMsg("Please enter a valid email address with @ (e.g. name@example.com).")
			return
		}
		if (password.length < 8) {
			setErrorMsg("Password must be at least 8 characters with letters and a number/symbol.")
			return
		}
		setBusy(true)
		try {
			const res = await fetch("/api/auth/local", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					mode,
					name: mode === "register" ? name.trim() : undefined,
					email: email.trim(),
					password,
				}),
			})
			const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
			if (!res.ok || !json.ok) {
				throw new Error(json.error || `Sign in failed (HTTP ${res.status})`)
			}
			router.push("/")
			router.refresh()
		} catch (err) {
			setErrorMsg(err instanceof Error ? err.message : String(err))
		} finally {
			setBusy(false)
		}
	}

	const inputClass = isLight
		? "h-10 w-full rounded-lg border border-slate-300 bg-white pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15"
		: "h-10 w-full rounded-lg border border-[#263841] bg-[#0c141c] pr-3 pl-9 text-sm text-[#e3edef] placeholder:text-[#5c7078] outline-none focus:border-[#62e1c3] focus:ring-2 focus:ring-[#62e1c3]/15"

	const labelClass = isLight
		? "block text-[11px] font-semibold uppercase tracking-wider text-slate-600"
		: "block text-[11px] font-semibold uppercase tracking-wider text-[#81949a]"

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			<div
				className={`flex items-center justify-between gap-1.5 rounded-lg border p-1 ${
					isLight ? "border-slate-200 bg-slate-100" : "border-[#1c2a33] bg-[#0c141c]"
				}`}
			>
				{(
					[
						{ id: "login", label: "Sign In" },
						{ id: "register", label: "Create Account" },
					] as const
				).map((tab) => (
					<button
						key={tab.id}
						type="button"
						onClick={() => {
							setMode(tab.id)
							setErrorMsg(null)
							if (tab.id === "register" && email === "testadmin@corridoraudit.local") {
								setName("")
								setEmail("")
								setPassword("")
							}
						}}
						className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors ${
							mode === tab.id
								? isLight
									? "bg-white text-emerald-700 shadow-xs"
									: "bg-[#12222c] text-[#62e1c3]"
								: isLight
									? "text-slate-600 hover:text-slate-900"
									: "text-[#81949a] hover:text-[#e3edef]"
						}`}
					>
						{tab.label}
					</button>
				))}
			</div>

			<div
				className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[11px] ${
					isLight
						? "border-slate-200 bg-slate-50 text-slate-700"
						: "border-[#225b51]/60 bg-[#0d2725]/40 text-[#c7d3d6]"
				}`}
			>
				<div className="truncate">
					Quick demo:{" "}
					<span className={`font-mono ${isLight ? "font-semibold text-emerald-800" : "text-[#75e4c7]"}`}>
						testadmin@corridoraudit.local
					</span>
				</div>
				<button
					type="button"
					onClick={fillTestAdmin}
					className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-1 font-semibold transition-colors ${
						isLight
							? "border-emerald-700 bg-emerald-700 text-white hover:border-emerald-800 hover:bg-emerald-800"
							: "border-[#2c4a43] bg-[#0e2620] text-[#62e1c3] hover:bg-[#14352d]"
					}`}
				>
					<Sparkles className="h-3 w-3" />
					Fill Test Admin
				</button>
			</div>
			<div
				className={`flex items-start gap-2 rounded-lg px-3 py-2 text-[11px] leading-4 ${
					isLight ? "bg-sky-50 text-slate-600" : "bg-[#0c1720] text-[#a4b4b8]"
				}`}
				role="note"
			>
				<span className={`mt-0.5 shrink-0 font-bold ${isLight ? "text-sky-700" : "text-sky-300"}`}>
					DEMO
				</span>
				<p>
					Click <span className="font-semibold">Fill Test Admin</span>, then click{" "}
					<span className="font-semibold">Sign in to CorridorAudit</span> to open the demo workspace.
				</p>
			</div>

			{errorMsg && (
				<div
					className={`rounded-lg border px-3 py-2 text-xs ${
						isLight
							? "border-rose-300 bg-rose-50 text-rose-800"
							: "border-red-900/70 bg-red-950/40 text-red-200"
					}`}
				>
					{errorMsg}
				</div>
			)}

			{mode === "register" && (
				<div className="space-y-1">
					<label className={labelClass}>Full Name</label>
					<div className="relative">
						<User
							className={`pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 ${
								isLight ? "text-slate-400" : "text-[#71858c]"
							}`}
						/>
						<input
							type="text"
							required
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Alex Morgan"
							className={inputClass}
						/>
					</div>
				</div>
			)}

			<div className="space-y-1">
				<label className={labelClass}>Email Address</label>
				<div className="relative">
					<Mail
						className={`pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 ${
							isLight ? "text-slate-400" : "text-[#71858c]"
						}`}
					/>
					<input
						type="email"
						required
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						placeholder="name@example.com"
						className={inputClass}
					/>
				</div>
			</div>

			<div className="space-y-1">
				<label className={labelClass}>Password</label>
				<div className="relative">
					<Lock
						className={`pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 ${
							isLight ? "text-slate-400" : "text-[#71858c]"
						}`}
					/>
					<input
						type={showPassword ? "text" : "password"}
						required
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						placeholder="Min 8 chars (letters + number/symbol)"
						className={`${inputClass} pr-10`}
					/>
					<button
						type="button"
						aria-label={showPassword ? "Hide password" : "Show password"}
						onClick={() => setShowPassword((v) => !v)}
						className={`absolute top-1/2 right-2.5 -translate-y-1/2 ${
							isLight ? "text-slate-400 hover:text-slate-700" : "text-[#81949a] hover:text-[#e3edef]"
						}`}
					>
						{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
					</button>
				</div>
			</div>

			<button
				type="submit"
				disabled={busy}
				className="flex h-11 w-full items-center justify-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
			>
				{busy ? "Signing in..." : mode === "login" ? "Sign in to CorridorAudit" : "Create Account & Enter"}
			</button>
		</form>
	)
}
