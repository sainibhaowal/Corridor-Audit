"use client"

import {
	Building2,
	CheckCircle2,
	Cpu,
	Eye,
	EyeOff,
	GitBranch,
	KeyRound,
	Loader2,
	RefreshCw,
	Search,
	ShieldAlert,
	ShieldCheck,
	Trash2,
	Users,
	XCircle,
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { SelectBox } from "@/components/ui/select-box"
import { cn } from "@/lib/utils"
import {
	formatModelDisplayName,
	PROVIDER_DEFAULT_MODELS,
	PROVIDER_DEFAULT_URLS,
	type ProviderId,
	type ProviderStatus,
} from "./corridor-types"

const PROVIDERS: Array<{ id: ProviderId; label: string; subtitle: string }> = [
	{ id: "nvidia", label: "NVIDIA NIM", subtitle: "$0 Free Credits · OpenAI-compatible" },
	{ id: "gemini", label: "Google Gemini", subtitle: "AI Studio · Gemini 2.5" },
	{ id: "groq", label: "Groq", subtitle: "Ultra-low latency LPU inference" },
	{ id: "openrouter", label: "OpenRouter", subtitle: "Multi-model router" },
	{ id: "openai", label: "OpenAI", subtitle: "GPT-5.4 / o-series" },
	{ id: "anthropic", label: "Anthropic Claude", subtitle: "Claude 4.5 Haiku / Sonnet" },
	{ id: "ollama", label: "Ollama (Local)", subtitle: "Local self-hosted models" },
]

type SettingsSection = "providers" | "gate" | "workspace" | "team"

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

interface SettingsViewProps {
	currentProvider: ProviderStatus
	breakpointMode: "risk_only" | "step_tool"
	onBreakpointModeChange: (mode: "risk_only" | "step_tool") => void
	onProviderSaved: (next: ProviderStatus) => void
}

export function SettingsView({
	currentProvider,
	breakpointMode,
	onBreakpointModeChange,
	onProviderSaved,
}: SettingsViewProps) {
	const [section, setSection] = useState<SettingsSection>("providers")
	const [selectedProvider, setSelectedProvider] = useState<ProviderId>(currentProvider.provider)

	const [baseURL, setBaseURL] = useState(
		currentProvider.baseURL || PROVIDER_DEFAULT_URLS[currentProvider.provider],
	)
	const [modelName, setModelName] = useState(currentProvider.modelName)
	const [modelDisplayName, setModelDisplayName] = useState(
		currentProvider.modelDisplayName || formatModelDisplayName(currentProvider.modelName),
	)
	const [modelAliases, setModelAliases] = useState<Record<string, string>>(
		currentProvider.modelAliases ?? {},
	)
	const [apiKey, setApiKey] = useState("")
	const [showApiKey, setShowApiKey] = useState(false)
	const [discoveredModels, setDiscoveredModels] = useState<string[]>(
		currentProvider.discoveredModels ?? [],
	)
	const [modelSearch, setModelSearch] = useState("")
	const [discovering, setDiscovering] = useState(false)
	const [discoverNotice, setDiscoverNotice] = useState<{ ok: boolean; text: string } | null>(null)
	const [testing, setTesting] = useState(false)
	const [testStatus, setTestStatus] = useState<{ ok: boolean; text: string } | null>(null)
	const [savingProvider, setSavingProvider] = useState(false)

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
	const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null)

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
		setGateMode(breakpointMode)
		void loadWorkspace()
	}, [breakpointMode, loadWorkspace])

	const selectProvider = (providerId: ProviderId) => {
		setSelectedProvider(providerId)
		setBaseURL(
			providerId === currentProvider.provider && currentProvider.baseURL
				? currentProvider.baseURL
				: PROVIDER_DEFAULT_URLS[providerId],
		)
		const nextModel =
			providerId === currentProvider.provider
				? currentProvider.modelName
				: PROVIDER_DEFAULT_MODELS[providerId]
		setModelName(nextModel)
		setModelDisplayName(modelAliases[nextModel] || formatModelDisplayName(nextModel))
		setDiscoveredModels(
			providerId === currentProvider.provider && currentProvider.discoveredModels?.length
				? currentProvider.discoveredModels
				: [],
		)
		setApiKey("")
		setModelSearch("")
		setDiscoverNotice(null)
		setTestStatus(null)
	}

	const discoverModels = async (overrideKey?: string) => {
		setDiscovering(true)
		setDiscoverNotice(null)
		try {
			const res = await fetch("/api/settings/models", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					provider: selectedProvider,
					apiKey: (overrideKey ?? apiKey).trim() || undefined,
					baseURL: baseURL.trim() || undefined,
				}),
			})
			const data = (await res.json()) as { ok: boolean; models?: string[]; error?: string }
			if (!res.ok || !data.ok || !data.models?.length) {
				setDiscoverNotice({
					ok: false,
					text:
						data.error ||
						(data.ok
							? "The provider responded, but returned no models available to this API key. Check model access and the base URL."
							: "Could not discover models from this provider."),
				})
				return
			}
			setDiscoveredModels(data.models)
			if (!data.models.includes(modelName)) {
				const first = data.models[0]
				setModelName(first)
				setModelDisplayName(modelAliases[first] || formatModelDisplayName(first))
			}
			setDiscoverNotice({
				ok: true,
				text: `Auto-discovered ${data.models.length} live model(s) from ${selectedProvider.toUpperCase()}.`,
			})
		} catch (err) {
			setDiscoverNotice({
				ok: false,
				text:
					err instanceof TypeError && /fetch/i.test(err.message)
						? "Cannot reach the app server. Make sure CorridorAudit is running at http://127.0.0.1:3000, then retry."
						: err instanceof Error
							? err.message
							: "Model discovery failed before a response was received.",
			})
		} finally {
			setDiscovering(false)
		}
	}

	const saveProvider = async () => {
		setSavingProvider(true)
		try {
			const res = await fetch("/api/settings/provider", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					provider: selectedProvider,
					modelName: modelName.trim(),
					modelDisplayName: modelDisplayName.trim() || undefined,
					baseURL: baseURL.trim() || undefined,
					apiKey: apiKey.trim() || undefined,
					breakpointMode: gateMode,
				}),
			})
			const data = (await res.json()) as { ok?: boolean; provider?: ProviderStatus }
			if (data.provider) {
				const enriched: ProviderStatus = {
					...data.provider,
					discoveredModels: discoveredModels.length ? discoveredModels : data.provider.discoveredModels,
				}
				onProviderSaved(enriched)
				onBreakpointModeChange(gateMode)
				setTestStatus((prev) =>
					prev ?? { ok: true, text: `Connected ${enriched.provider.toUpperCase()} · ${enriched.modelName}` },
				)
			}
		} finally {
			setSavingProvider(false)
		}
	}

	const handleTestConnection = async () => {
		setTesting(true)
		setTestStatus(null)
		try {
			await saveProvider()
			const res = await fetch("/api/settings/test", { method: "POST" })
			const data = (await res.json()) as { ok: boolean; message: string; latencyMs: number }
			setTestStatus({ ok: data.ok, text: `${data.message} (${data.latencyMs}ms)` })
		} catch (err) {
			setTestStatus({ ok: false, text: err instanceof Error ? err.message : String(err) })
		} finally {
			setTesting(false)
		}
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
			setWorkspaceNotice("Workspace & security settings saved to encrypted SQLite vault.")
		}
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

	const filteredModels = discoveredModels.filter((m) => {
		const q = modelSearch.trim().toLowerCase()
		if (!q) return true
		const display = (modelAliases[m] || formatModelDisplayName(m)).toLowerCase()
		return m.toLowerCase().includes(q) || display.includes(q)
	})

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div>
					<h1 className="text-xl font-extrabold tracking-tight text-[#e3edef]">
						System &amp; Model Settings
					</h1>
					<p className="mt-0.5 text-xs text-[#81949a]">
						Choose a provider on the left, enter your API key to auto-discover live models, test connection, and configure workspace rules.
					</p>
				</div>
				<Badge variant={currentProvider.mode === "live" ? "ok" : "warn"}>
					{currentProvider.mode === "live"
						? `Active: ${currentProvider.provider.toUpperCase()} · ${currentProvider.modelName}`
						: "No LLM Key Configured"}
				</Badge>
			</div>

			{/* STABLE TWO-COLUMN SETTINGS WORKSPACE */}
			<div className="grid min-h-[480px] gap-4 lg:grid-cols-[230px_1fr]">
				{/* LEFT SETTINGS SIDEBAR — CLEAN SECTIONS ONLY */}
				<Card className="relative flex flex-col gap-1 p-3">
					<div className="absolute right-2 bottom-2 flex gap-1">
						<a
							href="https://github.com/sainibhaowal/Corridor-Audit"
							target="_blank"
							rel="noopener noreferrer"
							aria-label="View on GitHub"
							title="View on GitHub"
							className="rounded-lg p-1 text-[#71858c] hover:bg-[#101820] hover:text-[#62e1c3] transition-colors"
						>
							<svg
								width="16"
								height="16"
								viewBox="0 0 16 16"
								fill="currentColor"
								className="h-3 w-3"
							>
								<path
									fillRule="evenodd"
									d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.04.57 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8"
								/>
							</svg>
						</a>
						<a
							href="https://github.com/sainibhaowal/Corridor-Audit/issues"
							target="_blank"
							rel="noopener noreferrer"
							aria-label="Open issues"
							title="Open issues"
							className="rounded-lg p-1 text-[#71858c] hover:bg-[#101820] hover:text-[#62e1c3] transition-colors"
						>
							<svg
								width="16"
								height="16"
								viewBox="0 0 16 16"
								fill="currentColor"
								className="h-3 w-3"
							>
								<path
									fillRule="evenodd"
									d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.04.57 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8"
								/>
							</svg>
						</a>
					</div>
					<div className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#71858c]">
						Settings
					</div>
					{(
						[
							{ id: "providers", label: "AI Providers & Models", icon: Cpu },
							{ id: "gate", label: "Review Gate & Thresholds", icon: ShieldAlert },
							{ id: "workspace", label: "Workspace & Tax Profile", icon: Building2 },
							{ id: "team", label: "Team & Webhook Security", icon: Users },
						] as const
					).map((item) => {
						const isSelected = section === item.id
						return (
							<button
								key={item.id}
								type="button"
								onClick={() => {
									setSection(item.id)
									setWorkspaceNotice(null)
								}}
								className={cn(
									"flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left text-xs font-semibold transition-colors",
									isSelected
										? "border-[#225b51] bg-[#0d2725] text-[#e3edef]"
										: "border-transparent text-[#c7d3d6] hover:bg-[#101820]",
								)}
							>
								<item.icon className="h-3.5 w-3.5 shrink-0 text-[#62e1c3]" />
								<span className="truncate">{item.label}</span>
							</button>
						)
					})}
				</Card>

				{/* RIGHT DETAIL PANE */}
				<Card className="flex flex-col justify-between p-5">
					{section === "providers" && (
						<div className="space-y-4">
							<div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1c2a33] pb-3.5">
								<div className="min-w-0 flex-1">
									<label className="mb-1 block text-[10.5px] font-bold uppercase tracking-wider text-[#81949a]">
										Select Provider
									</label>
									<SelectBox
										value={selectedProvider}
										onChange={(val) => selectProvider(val as ProviderId)}
										className="max-w-sm"
										options={PROVIDERS.map((p) => ({
											value: p.id,
											label: `${p.label} — ${p.subtitle}`,
										}))}
									/>
								</div>
								<Badge
									variant={
										currentProvider.provider === selectedProvider && currentProvider.mode === "live"
											? "ok"
											: "neutral"
									}
								>
									{currentProvider.provider === selectedProvider && currentProvider.mode === "live"
										? "Connected"
										: "Ready to Configure"}
								</Badge>
							</div>

							<div className="flex items-start gap-2.5 rounded-lg border border-[#1c2a33] border-l-4 border-l-emerald-600 bg-[#080d12] p-3 text-xs text-[#c7d3d6]">
								<ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#62e1c3]" />
								<div>
									<strong>In-Memory Security:</strong> API keys remain strictly in server RAM for this session — never written to disk or Git.
								</div>
							</div>

							<div className="grid gap-4 sm:grid-cols-2">
								<div className="sm:col-span-2">
									<label className="mb-1 block text-xs font-semibold text-[#c7d3d6]">
										Provider Base URL (Pre-filled)
									</label>
									<input
										type="url"
										value={baseURL}
										onChange={(e) => setBaseURL(e.target.value)}
										className="h-9 w-full rounded-lg border border-[#32454d] bg-[#080d12] px-3 font-mono text-xs text-[#e3edef] focus:border-emerald-600 focus:outline-none"
									/>
								</div>

								<div className="sm:col-span-2">
									<label className="mb-1 block text-xs font-semibold text-[#c7d3d6]">
										API Key {selectedProvider === "ollama" ? "(not required for local Ollama)" : "(auto-discovers models)"}
									</label>
									<div className="flex gap-2">
										<div className="relative flex-1">
											<input
												type={showApiKey ? "text" : "password"}
												value={apiKey}
												onChange={(e) => setApiKey(e.target.value)}
												placeholder="Paste API key — click Discover Models to fetch live model list"
												className="h-9 w-full rounded-lg border border-[#32454d] bg-[#080d12] pr-9 pl-3 font-mono text-xs text-[#e3edef] focus:border-emerald-600 focus:outline-none"
											/>
											<button
												type="button"
												onClick={() => setShowApiKey((v) => !v)}
												aria-label={showApiKey ? "Hide API key" : "Show API key"}
												title={showApiKey ? "Hide API key" : "Show API key"}
												className="absolute top-1.5 right-1.5 rounded-lg p-1 text-[#81949a] hover:bg-[#101820] hover:text-[#e3edef]"
											>
												{showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
											</button>
										</div>
										<Button
											variant="outline"
											disabled={discovering}
											onClick={() => void discoverModels()}
										>
											{discovering ? (
												<Loader2 className="h-3.5 w-3.5 animate-spin" />
											) : (
												<RefreshCw className="h-3.5 w-3.5" />
											)}
											Discover Models
										</Button>
									</div>
								</div>
							</div>

							{discoverNotice && (
								<div
									className={cn(
										"rounded-md border px-3 py-2 text-xs font-medium",
										discoverNotice.ok
											? "border-[#225b51] bg-[#0d2725] text-[#75e4c7]"
											: "border-red-300 bg-red-50 text-red-800",
									)}
								>
									{discoverNotice.text}
								</div>
							)}

							<div className="space-y-2 rounded-lg border border-[#1c2a33] bg-[#080d12] p-3.5">
								{discoveredModels.length > 0 ? (
									<>
										<div className="flex flex-wrap items-center justify-between gap-2">
											<label className="text-xs font-bold text-[#e3edef]">
												Discovered Models ({filteredModels.length} fetched from API)
											</label>
											<div className="relative w-56">
												<Search className="pointer-events-none absolute top-2 left-2.5 h-3.5 w-3.5 text-[#71858c]" />
												<input
													type="text"
													value={modelSearch}
													onChange={(e) => setModelSearch(e.target.value)}
													placeholder="Filter discovered models..."
													className="h-7 w-full rounded-lg border border-[#32454d] bg-[#0d141b] pr-2 pl-8 text-[11px] text-[#e3edef] focus:border-emerald-600 focus:outline-none"
												/>
											</div>
										</div>

										<SelectBox
											value={modelName}
											onChange={(val) => {
												setModelName(val)
												setModelDisplayName(modelAliases[val] || formatModelDisplayName(val))
											}}
											buttonClassName="bg-[#0d141b]"
											options={[
												...(!filteredModels.includes(modelName) && modelName
													? [
															{
																value: modelName,
																label: modelAliases[modelName] || formatModelDisplayName(modelName),
																description: `${modelName} (manual)`,
															},
														]
													: []),
												...filteredModels.map((m) => ({
													value: m,
													label: modelAliases[m] || formatModelDisplayName(m),
													description: m,
												})),
											]}
										/>
									</>
								) : (
									<>
										<div className="text-xs text-[#81949a]">
											No live models fetched yet. Enter your API key above and click <strong>Discover Models</strong> to load available models from this provider, or type a Model ID below.
										</div>
										<div>
											<label className="mb-1 block text-[11px] font-semibold text-[#81949a]">
												Model ID
											</label>
											<input
												type="text"
												value={modelName}
												onChange={(e) => {
													const nextId = e.target.value
													setModelName(nextId)
													setModelDisplayName(modelAliases[nextId] || formatModelDisplayName(nextId))
												}}
												placeholder="Enter Model ID or discover from API"
												className="h-8 w-full rounded-lg border border-[#32454d] bg-[#0d141b] px-3 font-mono text-xs text-[#e3edef] focus:border-emerald-600 focus:outline-none"
											/>
										</div>
									</>
								)}
							</div>

							{testStatus && (
								<div
									className={cn(
										"flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium",
										testStatus.ok
											? "border-[#225b51] bg-[#0d2725] text-[#75e4c7]"
											: "border-red-300 bg-red-50 text-red-800",
									)}
								>
									{testStatus.ok ? (
										<CheckCircle2 className="h-4 w-4 shrink-0" />
									) : (
										<XCircle className="h-4 w-4 shrink-0" />
									)}
									<span>{testStatus.text}</span>
								</div>
							)}

							<div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#1c2a33] pt-4">
								<Button variant="outline" onClick={() => void handleTestConnection()} disabled={testing}>
									{testing ? "Testing Model..." : "Test Connection"}
								</Button>
								<Button variant="emerald" onClick={() => void saveProvider()} disabled={savingProvider}>
									{savingProvider ? "Connecting..." : "Connect & Set Active Model"}
								</Button>
							</div>
						</div>
					)}

					{section === "gate" && (
						<div className="space-y-4">
							<h2 className="border-b border-[#1c2a33] pb-3 text-base font-extrabold text-[#e3edef]">
								Review Gate &amp; Variance Thresholds
							</h2>
							<div className="grid gap-3 sm:grid-cols-2">
								{(
									[
										{
											id: "risk_only",
											title: "Auto-Risk Gate",
											desc: "Pause only on recoverable OUR violations, duplicates, BEC bank changes, or unexplained variance.",
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
											"rounded-lg border p-3.5 text-left transition-colors",
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
									className="h-9 w-full rounded-md border border-[#32454d] bg-[#080d12] px-3 font-mono text-xs text-[#e3edef]"
								/>
							</div>
							{workspaceNotice && (
								<div className="rounded-md border border-[#225b51] bg-[#0d2725] px-3 py-2 text-xs text-[#75e4c7]">
									{workspaceNotice}
								</div>
							)}
							<div className="flex justify-end border-t border-[#1c2a33] pt-4">
								<Button
									variant="emerald"
									onClick={async () => {
										await saveProvider()
										await saveWorkspaceConfig()
									}}
								>
									Save Review Gate Settings
								</Button>
							</div>
						</div>
					)}

					{section === "workspace" && (
						<div className="space-y-4">
							<h2 className="border-b border-[#1c2a33] pb-3 text-base font-extrabold text-[#e3edef]">
								Workspace &amp; Tax Profile
							</h2>
							<div className="grid gap-3 sm:grid-cols-2">
								<div className="sm:col-span-2">
									<label className="mb-1 block text-xs font-semibold text-[#c7d3d6]">Workspace / Entity Name</label>
									<input
										type="text"
										value={workspace.name}
										onChange={(e) => setWorkspace((w) => ({ ...w, name: e.target.value }))}
										className="h-9 w-full rounded-lg border border-[#32454d] bg-[#080d12] px-3 text-xs text-[#e3edef]"
									/>
								</div>
								<div>
									<label className="mb-1 block text-xs font-semibold text-[#c7d3d6]">Account Profile</label>
									<SelectBox
										value={workspace.accountMode}
										onChange={(val) =>
											setWorkspace((w) => ({ ...w, accountMode: val as "b2c" | "b2b" }))
										}
										options={[
											{ value: "b2b", label: "B2B Finance / Treasury Team" },
											{ value: "b2c", label: "B2C Freelancer / Solo Operator" },
										]}
									/>
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
							{workspaceNotice && (
								<div className="rounded-md border border-[#225b51] bg-[#0d2725] px-3 py-2 text-xs text-[#75e4c7]">
									{workspaceNotice}
								</div>
							)}
							<div className="flex justify-end border-t border-[#1c2a33] pt-4">
								<Button variant="emerald" onClick={() => void saveWorkspaceConfig()}>
									Save Workspace Profile
								</Button>
							</div>
						</div>
					)}

					{section === "team" && (
						<div className="space-y-4">
							<h2 className="border-b border-[#1c2a33] pb-3 text-base font-extrabold text-[#e3edef]">
								Team Members &amp; Webhook Security
							</h2>
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
										className="h-8 rounded-lg border border-[#32454d] bg-[#080d12] px-2.5 text-xs text-[#e3edef]"
									/>
									<SelectBox
										value={memberRole}
										onChange={(val) =>
											setMemberRole(val as "controller" | "analyst" | "viewer")
										}
										buttonClassName="h-8 rounded-lg"
										options={[
											{ value: "controller", label: "Controller" },
											{ value: "analyst", label: "Analyst" },
											{ value: "viewer", label: "Viewer" },
										]}
									/>
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

							{workspaceNotice && (
								<div className="rounded-md border border-[#225b51] bg-[#0d2725] px-3 py-2 text-xs text-[#75e4c7]">
									{workspaceNotice}
								</div>
							)}
							<div className="flex justify-end border-t border-[#1c2a33] pt-4">
								<Button variant="emerald" onClick={() => void saveWorkspaceConfig()}>
									Save Security Settings
								</Button>
							</div>
						</div>
					)}
				</Card>
			</div>
		</div>
	)
}
