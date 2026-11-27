"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Eye, EyeOff, Lock, Mail, Sparkles, User } from "lucide-react"

export function LocalLoginForm() {
	const router = useRouter()
	const [mode, setMode] = useState<"login" | "register">("login")
	const [name, setName] = useState("Test Admin")
	const [email, setEmail] = useState("testadmin@corridoraudit.local")
	const [password, setPassword] = useState("Admin@1234")
	const [showPassword, setShowPassword] = useState(false)
	const [busy, setBusy] = useState(false)
	const [errorMsg, setErrorMsg] = useState<string | null>(null)

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

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			<div className="flex items-center justify-between gap-2 rounded-lg border border-[#1c2a33] bg-[#080d12] p-1">
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
							mode === tab.id ? "bg-[#12222c] text-[#62e1c3]" : "text-[#81949a] hover:text-[#e3edef]"
						}`}
					>
						{tab.label}
					</button>
				))}
			</div>

			<div className="flex items-center justify-between rounded-lg border border-[#225b51]/60 bg-[#0d2725]/40 px-3 py-2 text-[11px]">
				<div className="text-[#c7d3d6]">
					Quick demo: <span className="font-mono text-[#75e4c7]">testadmin@corridoraudit.local</span>
				</div>
				<button
					type="button"
					onClick={fillTestAdmin}
					className="inline-flex items-center gap-1 rounded-md border border-[#2c4a43] bg-[#0e2620] px-2 py-1 font-semibold text-[#62e1c3] hover:bg-[#14352d]"
				>
					<Sparkles className="h-3 w-3" />
					Fill Test Admin
				</button>
			</div>

			{errorMsg && (
				<div className="rounded-lg border border-red-900/70 bg-red-950/40 px-3 py-2 text-xs text-red-200">
					{errorMsg}
				</div>
			)}

			{mode === "register" && (
				<div className="space-y-1">
					<label className="block text-[11px] font-semibold uppercase tracking-wider text-[#81949a]">
						Full Name
					</label>
					<div className="relative">
						<User className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#71858c]" />
						<input
							type="text"
							required
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Alex Morgan"
							className="h-10 w-full rounded-lg border border-[#263841] bg-[#080d12] pr-3 pl-9 text-sm text-[#e3edef] outline-none focus:border-[#62e1c3]"
						/>
					</div>
				</div>
			)}

			<div className="space-y-1">
				<label className="block text-[11px] font-semibold uppercase tracking-wider text-[#81949a]">
					Email Address
				</label>
				<div className="relative">
					<Mail className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#71858c]" />
					<input
						type="email"
						required
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						placeholder="name@example.com"
						className="h-10 w-full rounded-lg border border-[#263841] bg-[#080d12] pr-3 pl-9 text-sm text-[#e3edef] outline-none focus:border-[#62e1c3]"
					/>
				</div>
			</div>

			<div className="space-y-1">
				<label className="block text-[11px] font-semibold uppercase tracking-wider text-[#81949a]">
					Password
				</label>
				<div className="relative">
					<Lock className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#71858c]" />
					<input
						type={showPassword ? "text" : "password"}
						required
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						placeholder="Min 8 chars (letters + number/symbol)"
						className="h-10 w-full rounded-lg border border-[#263841] bg-[#080d12] pr-10 pl-9 text-sm text-[#e3edef] outline-none focus:border-[#62e1c3]"
					/>
					<button
						type="button"
						aria-label={showPassword ? "Hide password" : "Show password"}
						onClick={() => setShowPassword((v) => !v)}
						className="absolute top-1/2 right-2.5 -translate-y-1/2 text-[#81949a] hover:text-[#e3edef]"
					>
						{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
					</button>
				</div>
			</div>

			<button
				type="submit"
				disabled={busy}
				className="flex h-11 w-full items-center justify-center rounded-lg bg-[#0d8b6f] px-4 text-sm font-semibold text-white transition hover:bg-[#10a382] disabled:opacity-50"
			>
				{busy ? "Signing in..." : mode === "login" ? "Sign in to CorridorAudit" : "Create Account & Enter"}
			</button>
		</form>
	)
}
