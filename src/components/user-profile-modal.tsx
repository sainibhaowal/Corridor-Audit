"use client"

import { useState } from "react"
import { Eye, EyeOff, KeyRound, LogOut, Mail, Shield, UserCheck, X } from "lucide-react"
import { Button } from "@/components/ui/button"

export interface LocalUserProfile {
	id: string
	workspaceId: string
	email: string
	name: string
	avatarColor: string
	role: string
}

interface UserProfileModalProps {
	open: boolean
	user: LocalUserProfile | null
	onClose: () => void
	onUpdated: (user: LocalUserProfile) => void
}

const AVATAR_COLORS = ["#10b981", "#38bdf8", "#a78bfa", "#f59e0b", "#f43f5e", "#6366f1"]

export function getInitials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean)
	if (parts.length === 0) return "TA"
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function UserProfileModal({ open, user, onClose, onUpdated }: UserProfileModalProps) {
	const [name, setName] = useState(user?.name || "Test Admin")
	const [avatarColor, setAvatarColor] = useState(user?.avatarColor || "#10b981")
	const [currentPassword, setCurrentPassword] = useState("")
	const [newPassword, setNewPassword] = useState("")
	const [showPwd, setShowPwd] = useState(false)
	const [busy, setBusy] = useState(false)
	const [statusMsg, setStatusMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null)

	if (!open || !user) return null

	const saveProfile = async (e: React.FormEvent) => {
		e.preventDefault()
		setBusy(true)
		setStatusMsg(null)
		try {
			const res = await fetch("/api/profile", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "update_profile", name: name.trim(), avatarColor }),
			})
			const json = (await res.json().catch(() => ({}))) as { ok?: boolean; user?: LocalUserProfile; error?: string }
			if (!res.ok || !json.user) throw new Error(json.error || "Failed to update profile.")
			onUpdated(json.user)
			setStatusMsg({ kind: "ok", text: "Profile updated." })
		} catch (err) {
			setStatusMsg({ kind: "err", text: err instanceof Error ? err.message : String(err) })
		} finally {
			setBusy(false)
		}
	}

	const resetPassword = async (e: React.FormEvent) => {
		e.preventDefault()
		setBusy(true)
		setStatusMsg(null)
		try {
			const res = await fetch("/api/profile", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					action: "reset_password",
					currentPassword: currentPassword || undefined,
					newPassword,
				}),
			})
			const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string }
			if (!res.ok || !json.ok) throw new Error(json.error || "Password reset failed.")
			setCurrentPassword("")
			setNewPassword("")
			setStatusMsg({ kind: "ok", text: json.message || "Password updated." })
		} catch (err) {
			setStatusMsg({ kind: "err", text: err instanceof Error ? err.message : String(err) })
		} finally {
			setBusy(false)
		}
	}

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-[#080d12]/70 p-4 backdrop-blur-[2px]"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose()
			}}
		>
			<div
				role="dialog"
				aria-modal="true"
				className="w-full max-w-md overflow-hidden rounded-xl border border-[#263841] bg-[#0d141b] shadow-2xl"
			>
				<div className="flex items-center justify-between border-b border-[#1c2a33] px-5 py-3.5">
					<div className="flex items-center gap-3">
						<div
							style={{ backgroundColor: avatarColor }}
							className="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-black text-white shadow"
						>
							{getInitials(name || user.name)}
						</div>
						<div>
							<h2 className="text-sm font-bold text-[#e3edef]">{user.name}</h2>
							<div className="flex items-center gap-1.5 text-[11px] text-[#81949a]">
								<Mail className="h-3 w-3" />
								<span>{user.email}</span>
							</div>
						</div>
					</div>
					<Button variant="outline" size="sm" onClick={onClose}>
						<X className="h-3.5 w-3.5" />
					</Button>
				</div>

				<div className="space-y-5 p-5">
					{statusMsg && (
						<div
							className={`rounded-lg border px-3 py-2 text-xs ${
								statusMsg.kind === "ok"
									? "border-[#2c4a43] bg-[#0e2620] text-[#62e1c3]"
									: "border-red-900/70 bg-red-950/40 text-red-200"
							}`}
						>
							{statusMsg.text}
						</div>
					)}

					<form onSubmit={saveProfile} className="space-y-3">
						<div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[#81949a]">
							<span className="flex items-center gap-1.5">
								<UserCheck className="h-3.5 w-3.5 text-[#62e1c3]" />
								Profile &amp; DP Avatar
							</span>
							<span className="inline-flex items-center gap-1 font-mono text-[#75e4c7]">
								<Shield className="h-3 w-3" />
								{user.role}
							</span>
						</div>

						<input
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Display Name"
							className="h-9 w-full rounded-lg border border-[#263841] bg-[#080d12] px-3 text-xs text-[#e3edef] outline-none focus:border-[#62e1c3]"
						/>

						<div className="flex items-center gap-2">
							<span className="text-[11px] text-[#81949a]">DP Color:</span>
							{AVATAR_COLORS.map((hex) => (
								<button
									key={hex}
									type="button"
									onClick={() => setAvatarColor(hex)}
									style={{ backgroundColor: hex }}
									className={`h-5 w-5 rounded-md transition-transform ${
										avatarColor === hex ? "scale-110 ring-2 ring-white" : "opacity-75 hover:opacity-100"
									}`}
								/>
							))}
						</div>

						<Button type="submit" size="sm" disabled={busy} className="w-full">
							Save Profile
						</Button>
					</form>

					<div className="h-px bg-[#1c2a33]" />

					<form onSubmit={resetPassword} className="space-y-2.5">
						<div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#81949a]">
							<KeyRound className="h-3.5 w-3.5 text-amber-400" />
							Reset Password
						</div>
						<input
							type={showPwd ? "text" : "password"}
							value={currentPassword}
							onChange={(e) => setCurrentPassword(e.target.value)}
							placeholder="Current password (e.g. Admin@1234)"
							className="h-9 w-full rounded-lg border border-[#263841] bg-[#080d12] px-3 text-xs text-[#e3edef] outline-none focus:border-[#62e1c3]"
						/>
						<div className="relative">
							<input
								type={showPwd ? "text" : "password"}
								required
								value={newPassword}
								onChange={(e) => setNewPassword(e.target.value)}
								placeholder="New strong password (min 8 chars)"
								className="h-9 w-full rounded-lg border border-[#263841] bg-[#080d12] pr-9 pl-3 text-xs text-[#e3edef] outline-none focus:border-[#62e1c3]"
							/>
							<button
								type="button"
								onClick={() => setShowPwd((v) => !v)}
								className="absolute top-1/2 right-2.5 -translate-y-1/2 text-[#81949a] hover:text-[#e3edef]"
							>
								{showPwd ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
							</button>
						</div>
						<Button type="submit" variant="outline" size="sm" disabled={busy} className="w-full">
							Update Password
						</Button>
					</form>

					<div className="h-px bg-[#1c2a33]" />

					<form action="/api/auth/logout" method="post">
						<Button
							type="submit"
							variant="outline"
							className="w-full border-red-900/60 bg-red-950/20 text-red-300 hover:bg-red-950/40"
						>
							<LogOut className="h-3.5 w-3.5" />
							Logout &amp; Switch Account
						</Button>
					</form>
				</div>
			</div>
		</div>
	)
}
