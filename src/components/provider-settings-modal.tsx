"use client"

import { Building2, CheckCircle2, Cpu, KeyRound, RefreshCw, ShieldAlert, ShieldCheck, Trash2, Users, X, XCircle } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { PROVIDER_DEFAULT_MODELS, type ProviderId, type ProviderStatus } from "./corridor-types"

const PROVIDERS: Array<{ id: ProviderId; label: string }> = [
	{ id: "nvidia", label: "NVIDIA NIM ($0)" },
	{ id: "gemini", label: "Google Gemini" },
	{ id: "groq", label: "Groq" },
	{ id: "openrouter", label: "OpenRouter" },
	{ id: "openai", label: "OpenAI" },
	{ id: "anthropic", label: "Anthropic" },
	{ id: "ollama", label: "Ollama (Local)" },
]

type SettingsTab = "ai" | "gate" | "workspace" | "team"

interface WorkspaceSettingsState {
	name: string
	accountMode: "b2c" | "b2b"
	defaultCurrency: string
	taxCountry: string
	withholdingTaxBps: number
	varianceThresholdMinor: number
	webhookSigningSecretMasked: string
	requireWebhookSignature: boolean
}

interface TeamMemberItem {
	id: string
	email: string
	name: string
	role: "owner" | "controller" | "analyst" | "viewer"
	status: "active" | "invited"
}

interface ProviderSettingsModalProps {
	open: boolean
	current: ProviderStatus
	breakpointMode?: "risk_only" | "step_tool"
	onBreakpointModeChange?: (mode: "risk_only" | "step_tool") => void
	onSaved: (next: ProviderStatus) => void
	onClose: () => void
}

export function ProviderSettingsModal({
	open,
	current,
	breakpointMode = "risk_only",
	onBreakpointModeChange,
	onSaved,
	onClose,
}: ProviderSettingsModalProps) {
	const [tab, setTab] = useState<SettingsTab>("ai")
	const [selected, setSelected] = useState<ProviderId>(current.provider)
	const [modelName, setModelName] = useState(current.modelName)
	const [apiKey, setApiKey] = useState("")
	const [testing, setTesting] = useState(false)
	const [testStatus, setTestStatus] = useState<{ ok: boolean; text: string } | null>(null)

	const [gateMode, setGateMode] = useState<"risk_only" | "step_tool">(breakpointMode)
	const [workspace, setWorkspace] = useState<WorkspaceSettingsState>({
		name: "Primary Settlement Workspace",
		accountMode: "b2b",
		defaultCurrency: "USD",
		taxCountry: "US",
		withholdingTaxBps: 0,
		varianceThresholdMinor: 500,
		webhookSigningSecretMasked: "whsec_••••••••",
		requireWebhookSignature: false,
	})
	const [teamMembers, setTeamMembers] = useState<TeamMemberItem[]>([])
	const [memberName, setMemberName] = useState("")
	const [memberEmail, setMemberEmail] = useState("")
	const [memberRole, setMemberRole] = useState<"controller" | "analyst" | "viewer">("analyst")
	const [rotatedSecret, setRotatedSecret] = useState<string | null>(null)
	const [saveNotice, setSaveNotice] = useState<string | null>(null)

	const loadWorkspace = useCallback(async () => {
		try {
			const res = await fetch("/api/settings/workspace")
			const data = (await res.json()) as {
				ok: boolean
				workspace?: WorkspaceSettingsState
				teamMembers?: TeamMemberItem[]
			}
			if (data.ok && data.workspace) {
				setWorkspace(data.workspace)
				setTeamMembers(data.teamMembers ?? [])
			}
		} catch {
			// ignore
		}
	}, [])

	useEffect(() => {
		if (open) {
			setSelected(current.provider)
			setModelName(current.modelName)
			setGateMode(breakpointMode)
			setApiKey("")
			setTestStatus(null)
			setRotatedSecret(null)
			setSaveNotice(null)
			void loadWorkspace()
		}
	}, [open, current, breakpointMode, loadWorkspace])

	if (!open) return null

	const saveProviderConfig = async () => {
		const res = await fetch("/api/settings/provider", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				provider: selected,
				modelName: modelName.trim(),
				apiKey: apiKey.trim() || undefined,
				breakpointMode: gateMode,
			}),
		})
		const data = (await res.json()) as { provider: ProviderStatus }
		onSaved(data.provider)
		onBreakpointModeChange?.(gateMode)
		return data.provider
	}

	const saveWorkspaceConfig = async () => {
		const res = await fetch("/api/settings/workspace", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				action: "update_workspace",
				name: workspace.name,
				accountMode: workspace.accountMode,
				defaultCurrency: workspace.defaultCurrency,
				taxCountry: workspace.taxCountry,
				withholdingTaxBps: Number(workspace.withholdingTaxBps) || 0,
				varianceThresholdMinor: Number(workspace.varianceThresholdMinor) || 0,
				requireWebhookSignature: workspace.requireWebhookSignature,
			}),
		})
		const data = (await res.json()) as { ok: boolean; workspace?: WorkspaceSettingsState }
		if (data.ok && data.workspace) {
			setWorkspace(data.workspace)
			setSaveNotice("Workspace & security settings saved to encrypted SQLite vault.")
		}
	}

	const handleTest = async () => {
		setTesting(true)
		setTestStatus(null)
		try {
			await saveProviderConfig()
			const res = await fetch("/api/settings/test", { method: "POST" })
			const data = (await res.json()) as { ok: boolean; message: string; latencyMs: number }
			setTestStatus({ ok: data.ok, text: `${data.message} (${data.latencyMs}ms)` })
		} catch (err) {
			setTestStatus({ ok: false, text: err instanceof Error ? err.message : String(err) })
		} finally {
			setTesting(false)
		}
	}

	const handleSaveAndClose = async () => {
		await saveProviderConfig()
		await saveWorkspaceConfig()
		onClose()
	}

	const handleAddMember = async () => {
		if (!memberName.trim() || !memberEmail.trim()) return
		const res = await fetch("/api/settings/workspace", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				action: "add_member",
				memberName,
				memberEmail,
				memberRole,
			}),
		})
		const data = (await res.json()) as { ok: boolean; teamMembers?: TeamMemberItem[] }
		if (data.ok) {
			setTeamMembers(data.teamMembers ?? [])
			setMemberName("")
			setMemberEmail("")
		}
	}

	const handleRemoveMember = async (memberId: string) => {
		const res = await fetch("/api/settings/workspace", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "remove_member", memberId }),
		})
		const data = (await res.json()) as { ok: boolean; teamMembers?: TeamMemberItem[] }
		if (data.ok) setTeamMembers(data.teamMembers ?? [])
	}

	const handleRotateSecret = async () => {
		const res = await fetch("/api/settings/workspace", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "rotate_webhook_secret" }),
		})
		const data = (await res.json()) as {
			ok: boolean
			rotatedSecret?: string
			workspace?: WorkspaceSettingsState
		}
		if (data.ok) {
			if (data.rotatedSecret) setRotatedSecret(data.rotatedSecret)
			if (data.workspace) setWorkspace(data.workspace)
		}
	}

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-[#080d12]/70 p-4 backdrop-blur-[1px]"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose()
			}}
		>
			<div
				role="dialog"
				aria-modal="true"
				className="w-full max-w-3xl overflow-hidden rounded-xl border border-[#32454d] bg-[#0d141b] shadow-2xl"
			>
				<div className="flex items-center justify-between border-b border-[#1c2a33] px-5 py-3.5">
					<h2 className="text-base font-extrabold text-[#e3edef]">System Settings</h2>
					<Button variant="outline" size="sm" onClick={onClose}>
						<X className="h-3.5 w-3.5" />
					</Button>
				</div>

				{/* TAB BAR */}
				<div className="flex flex-wrap gap-1 border-b border-[#1c2a33] bg-[#080d12] px-5 py-2">
					{(
						[
							{ id: "ai", label: "AI Model & Key", icon: Cpu },
							{ id: "gate", label: "Review Gate", icon: ShieldAlert },
							{ id: "workspace", label: "Workspace & Tax", icon: Building2 },
							{ id: "team", label: "Team & Security", icon: Users },
						] as const
					).map((item) => (
						<button
							key={item.id}
							type="button"
							onClick={() => setTab(item.id)}
							className={cn(
								"inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
								tab === item.id
									? "bg-[#121c24] text-[#75e4c7]"
									: "text-[#81949a] hover:bg-[#101820] hover:text-[#e3edef]",
							)}
						>
							<item.icon className="h-3.5 w-3.5" />
							{item.label}
						</button>
					))}
				</div>

				<div className="max-h-[75vh] space-y-4 overflow-y-auto p-5">
					{saveNotice && (
						<div className="rounded-md border border-[#225b51] bg-[#0d2725] px-3 py-2 text-xs text-[#75e4c7]">
							{saveNotice}
						</div>
					)}

					{tab === "ai" && (
						<>
							<div className="flex items-start gap-2.5 rounded-lg border border-[#1c2a33] border-l-4 border-l-emerald-600 bg-[#080d12] p-3 text-xs text-[#c7d3d6]">
								<ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#62e1c3]" />
								<div>
									<strong>In-Memory Security:</strong> LLM API keys entered here remain strictly in server RAM for this session — never written to disk or Git.
								</div>
							</div>

							<div>
								<div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#81949a]">
									Select LLM Provider (Zero Lock-In)
								</div>
								<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
									{PROVIDERS.map((p) => (
										<button
											key={p.id}
											type="button"
											onClick={() => {
												setSelected(p.id)
												setModelName(PROVIDER_DEFAULT_MODELS[p.id])
											}}
											className={cn(
												"h-10 rounded-md border px-2 text-xs font-semibold transition-colors",
												selected === p.id
													? "border-[#29434c] bg-[#121c24] text-white"
													: "border-[#1c2a33] bg-[#0d141b] text-[#c7d3d6] hover:bg-[#080d12]",
											)}
										>
											{p.label}
										</button>
									))}
								</div>
							</div>

							<div className="space-y-3">
								<div>
									<label className="mb-1 block text-xs font-semibold text-[#c7d3d6]">Model ID</label>
									<input
										type="text"
										value={modelName}
										onChange={(e) => setModelName(e.target.value)}
										className="h-9 w-full rounded-md border border-[#32454d] bg-[#080d12] px-3 font-mono text-xs text-[#e3edef] focus:border-emerald-600 focus:outline-none"
									/>
								</div>
								<div>
									<label className="mb-1 block text-xs font-semibold text-[#c7d3d6]">
										API Key (optional if already configured in .env)
									</label>
									<input
										type="password"
										value={apiKey}
										onChange={(e) => setApiKey(e.target.value)}
										placeholder="Leave blank to keep existing .env / RAM key"
										className="h-9 w-full rounded-md border border-[#32454d] bg-[#080d12] px-3 font-mono text-xs text-[#e3edef] focus:border-emerald-600 focus:outline-none"
									/>
								</div>
							</div>

							{testStatus && (
								<div
									className={cn(
										"flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium",
										testStatus.ok
											? "border-[#225b51] bg-[#0d2725] text-[#75e4c7]"
											: "border-red-500/40 bg-red-950/30 text-red-300",
									)}
								>
									{testStatus.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
									<span>{testStatus.text}</span>
								</div>
							)}
						</>
					)}

					{tab === "gate" && (
						<div className="space-y-4">
							<div>
								<label className="mb-1.5 block text-xs font-semibold text-[#c7d3d6]">
									Mozaik InterceptionHandler Breakpoint Mode
								</label>
								<div className="grid gap-2 sm:grid-cols-2">
									{(
										[
											{
												id: "risk_only",
												title: "Auto-Risk Gate",
												desc: "Pause only on recoverable OUR violations, duplicates, BEC changes, or unexplained variance.",
											},
											{
												id: "step_tool",
												title: "Step Every Tool",
												desc: "Pause before finalizing every settlement action for strict human-in-the-loop sign-off.",
											},
										] as const
									).map((opt) => (
										<button
											key={opt.id}
											type="button"
											onClick={() => setGateMode(opt.id)}
											className={cn(
												"rounded-lg border p-3 text-left transition-colors",
												gateMode === opt.id
													? "border-[#225b51] bg-[#0d2725] text-[#e3edef]"
													: "border-[#1c2a33] bg-[#080d12] text-[#a4b4b8]",
											)}
										>
											<div className="text-xs font-bold">{opt.title}</div>
											<div className="mt-1 text-[11px] opacity-85">{opt.desc}</div>
										</button>
									))}
								</div>
							</div>

							<div>
								<label className="mb-1 block text-xs font-semibold text-[#c7d3d6]">
									Variance Alert Threshold (Minor Units / Cents — e.g. 500 = $5.00)
								</label>
								<input
									type="number"
									min={0}
									value={workspace.varianceThresholdMinor}
									onChange={(e) =>
										setWorkspace((w) => ({ ...w, varianceThresholdMinor: Number(e.target.value) || 0 }))
									}
									className="h-9 w-full rounded-md border border-[#32454d] bg-[#080d12] px-3 font-mono text-xs text-[#e3edef] focus:border-emerald-600 focus:outline-none"
								/>
							</div>
						</div>
					)}

					{tab === "workspace" && (
						<div className="grid gap-3 sm:grid-cols-2">
							<div className="sm:col-span-2">
								<label className="mb-1 block text-xs font-semibold text-[#c7d3d6]">Workspace / Entity Name</label>
								<input
									type="text"
									value={workspace.name}
									onChange={(e) => setWorkspace((w) => ({ ...w, name: e.target.value }))}
									className="h-9 w-full rounded-md border border-[#32454d] bg-[#080d12] px-3 text-xs text-[#e3edef]"
								/>
							</div>
							<div>
								<label className="mb-1 block text-xs font-semibold text-[#c7d3d6]">Account Profile</label>
								<select
									value={workspace.accountMode}
									onChange={(e) =>
										setWorkspace((w) => ({ ...w, accountMode: e.target.value as "b2c" | "b2b" }))
									}
									className="h-9 w-full rounded-md border border-[#32454d] bg-[#080d12] px-3 text-xs text-[#e3edef]"
								>
									<option value="b2b">B2B Finance / Treasury Team</option>
									<option value="b2c">B2C Freelancer / Solo Operator</option>
								</select>
							</div>
							<div>
								<label className="mb-1 block text-xs font-semibold text-[#c7d3d6]">Default Reporting Currency</label>
								<input
									type="text"
									maxLength={3}
									value={workspace.defaultCurrency}
									onChange={(e) => setWorkspace((w) => ({ ...w, defaultCurrency: e.target.value.toUpperCase() }))}
									className="h-9 w-full rounded-md border border-[#32454d] bg-[#080d12] px-3 font-mono text-xs text-[#e3edef]"
								/>
							</div>
							<div>
								<label className="mb-1 block text-xs font-semibold text-[#c7d3d6]">Tax Jurisdiction (ISO-2)</label>
								<input
									type="text"
									maxLength={2}
									value={workspace.taxCountry}
									onChange={(e) => setWorkspace((w) => ({ ...w, taxCountry: e.target.value.toUpperCase() }))}
									className="h-9 w-full rounded-md border border-[#32454d] bg-[#080d12] px-3 font-mono text-xs text-[#e3edef]"
								/>
							</div>
							<div>
								<label className="mb-1 block text-xs font-semibold text-[#c7d3d6]">Default Withholding Tax (bps)</label>
								<input
									type="number"
									min={0}
									value={workspace.withholdingTaxBps}
									onChange={(e) =>
										setWorkspace((w) => ({ ...w, withholdingTaxBps: Number(e.target.value) || 0 }))
									}
									className="h-9 w-full rounded-md border border-[#32454d] bg-[#080d12] px-3 font-mono text-xs text-[#e3edef]"
								/>
							</div>
						</div>
					)}

					{tab === "team" && (
						<div className="space-y-4">
							<div className="rounded-lg border border-[#1c2a33] bg-[#080d12] p-3.5">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<div>
										<div className="flex items-center gap-1.5 text-xs font-bold text-[#e3edef]">
											<KeyRound className="h-3.5 w-3.5 text-[#62e1c3]" />
											Webhook Signing Secret (HMAC-SHA256)
										</div>
										<div className="mt-1 font-mono text-xs text-[#81949a]">
											{rotatedSecret ? rotatedSecret : workspace.webhookSigningSecretMasked}
										</div>
									</div>
									<Button size="sm" variant="outline" onClick={() => void handleRotateSecret()}>
										<RefreshCw className="h-3.5 w-3.5" />
										Rotate Secret
									</Button>
								</div>
								<label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-[#c7d3d6]">
									<input
										type="checkbox"
										checked={workspace.requireWebhookSignature}
										onChange={(e) =>
											setWorkspace((w) => ({ ...w, requireWebhookSignature: e.target.checked }))
										}
									/>
									Require valid HMAC signature on all inbound webhook requests (`401` if unsigned)
								</label>
							</div>

							<div className="space-y-2">
								<div className="text-xs font-bold text-[#e3edef]">B2B Team Members</div>
								<div className="grid gap-2 sm:grid-cols-4">
									<input
										type="text"
										placeholder="Name"
										value={memberName}
										onChange={(e) => setMemberName(e.target.value)}
										className="h-8 rounded-md border border-[#32454d] bg-[#080d12] px-2.5 text-xs text-[#e3edef]"
									/>
									<input
										type="email"
										placeholder="email@company.com"
										value={memberEmail}
										onChange={(e) => setMemberEmail(e.target.value)}
										className="h-8 rounded-md border border-[#32454d] bg-[#080d12] px-2.5 text-xs text-[#e3edef]"
									/>
									<select
										value={memberRole}
										onChange={(e) =>
											setMemberRole(e.target.value as "controller" | "analyst" | "viewer")
										}
										className="h-8 rounded-md border border-[#32454d] bg-[#080d12] px-2 text-xs text-[#e3edef]"
									>
										<option value="controller">Controller</option>
										<option value="analyst">Analyst</option>
										<option value="viewer">Viewer</option>
									</select>
									<Button size="sm" variant="emerald" onClick={() => void handleAddMember()}>
										Invite Member
									</Button>
								</div>

								<div className="space-y-1.5 pt-1">
									{teamMembers.length === 0 ? (
										<div className="text-xs text-[#81949a]">No additional team members invited yet.</div>
									) : (
										teamMembers.map((m) => (
											<div
												key={m.id}
												className="flex items-center justify-between rounded border border-[#1c2a33] bg-[#080d12] px-3 py-2 text-xs"
											>
												<div>
													<span className="font-semibold text-[#e3edef]">{m.name}</span>{" "}
													<span className="text-[#81949a]">({m.email})</span>
												</div>
												<div className="flex items-center gap-2">
													<span className="rounded bg-[#121c24] px-2 py-0.5 text-[10px] uppercase text-[#75e4c7]">
														{m.role}
													</span>
													<button
														type="button"
														onClick={() => void handleRemoveMember(m.id)}
														className="text-[#81949a] hover:text-red-400"
													>
														<Trash2 className="h-3.5 w-3.5" />
													</button>
												</div>
											</div>
										))
									)}
								</div>
							</div>
						</div>
					)}

					<div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#1c2a33] pt-3">
						{tab === "ai" ? (
							<Button variant="outline" onClick={handleTest} disabled={testing}>
								{testing ? "Testing..." : "Test Connection"}
							</Button>
						) : (
							<div />
						)}
						<Button onClick={handleSaveAndClose}>Save All Settings</Button>
					</div>
				</div>
			</div>
		</div>
	)
}
