"use client"

import { Check, Copy, Eye, EyeOff, Link2, Mail, RefreshCw, Unlink, X } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface IntegrationFieldSpec {
	key: string
	label: string
	type: "text" | "password" | "url"
	placeholder: string
	required: boolean
	secret?: boolean
}

interface IntegrationItem {
	provider: string
	name: string
	category: "payouts" | "accounting" | "banking" | "email"
	audiences: Array<"b2c" | "b2b">
	authModes: string[]
	defaultAuthMode: string
	description: string
	dataReceived: string
	oauthConfigured: boolean
	fields: IntegrationFieldSpec[]
	connection: {
		id: string | null
		status: "connected" | "disconnected" | "syncing" | "error"
		authMode: string
		accountLabel?: string
		lastSyncedAt?: string
		lastSyncStatus?: "success" | "failed"
		lastError?: string
	}
}

interface SyncRunItem {
	id: string
	provider: string
	trigger: string
	status: "running" | "success" | "failed"
	auditStatus?: "not_queued" | "queued" | "running" | "completed" | "failed" | "partial" | "unknown"
	recordsFetched: number
	casesQueued: number
	error?: string
	startedAt: string
}

interface WorkspaceSummary {
	id: string
	name: string
	accountMode: "b2c" | "b2b"
	inboundEmailAddress: string
}

export function IntegrationsPanel({ onCasesQueued }: { onCasesQueued: () => void }) {
	const [integrations, setIntegrations] = useState<IntegrationItem[]>([])
	const [syncRuns, setSyncRuns] = useState<SyncRunItem[]>([])
	const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null)
	const [filter, setFilter] = useState<"all" | "b2c" | "b2b" | "accounting" | "banking">("all")
	const [activeProvider, setActiveProvider] = useState<IntegrationItem | null>(null)
	const [formValues, setFormValues] = useState<Record<string, string>>({})
	const [revealedFields, setRevealedFields] = useState<Record<string, boolean>>({})
	const [busyProvider, setBusyProvider] = useState<string | null>(null)
	const [copied, setCopied] = useState<string | null>(null)
	const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null)

	const loadIntegrations = useCallback(async () => {
		try {
			const res = await fetch("/api/integrations")
			const data = (await res.json()) as {
				ok: boolean
				workspace?: WorkspaceSummary
				integrations?: IntegrationItem[]
				syncRuns?: SyncRunItem[]
			}
			if (data.ok) {
				setWorkspace(data.workspace ?? null)
				setIntegrations(data.integrations ?? [])
				setSyncRuns(data.syncRuns ?? [])
			} else {
				setBanner({ ok: false, text: "Failed to load integrations from server." })
			}
		} catch (err) {
			setBanner({
				ok: false,
				text: err instanceof Error ? err.message : "Could not reach /api/integrations.",
			})
		}
	}, [])

	useEffect(() => {
		void loadIntegrations()
	}, [loadIntegrations])

	const copyText = (key: string, value: string) => {
		void navigator.clipboard?.writeText(value)
		setCopied(key)
		setTimeout(() => setCopied(null), 1800)
	}

	const startOAuth = async (provider: string) => {
		setBusyProvider(provider)
		setBanner(null)
		try {
			const res = await fetch(`/api/integrations/${provider}/connect`)
			const data = (await res.json()) as { ok: boolean; authorizationUrl?: string; error?: string }
			if (!res.ok || !data.authorizationUrl) {
				setBanner({ ok: false, text: data.error || "OAuth2 is not configured for this provider." })
				return
			}
			window.location.href = data.authorizationUrl
		} catch (err) {
			setBanner({ ok: false, text: err instanceof Error ? err.message : String(err) })
		} finally {
			setBusyProvider(null)
		}
	}

	const submitConnectForm = async () => {
		if (!activeProvider) return
		setBusyProvider(activeProvider.provider)
		setBanner(null)
		try {
			const { apiKey, webhookSecret, accountLabel, ...config } = formValues
			const res = await fetch(`/api/integrations/${activeProvider.provider}/connect`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					authMode: activeProvider.defaultAuthMode === "oauth2" ? "api_token" : activeProvider.defaultAuthMode,
					accountLabel: accountLabel || activeProvider.name,
					apiKey,
					webhookSecret,
					config,
				}),
			})
			const data = (await res.json()) as { ok: boolean; error?: string }
			if (!res.ok || !data.ok) {
				setBanner({ ok: false, text: data.error || "Failed to connect integration." })
				return
			}
			setBanner({ ok: true, text: `${activeProvider.name} connected with AES-256 encrypted credentials.` })
			setActiveProvider(null)
			setFormValues({})
			await loadIntegrations()
		} catch (err) {
			setBanner({ ok: false, text: err instanceof Error ? err.message : String(err) })
		} finally {
			setBusyProvider(null)
		}
	}

	const handleSyncNow = async (provider: string) => {
		setBusyProvider(provider)
		setBanner(null)
		try {
			const res = await fetch(`/api/integrations/${provider}/sync`, { method: "POST" })
			const data = (await res.json()) as {
				ok: boolean
				syncRun?: SyncRunItem
				error?: string
			}
			if (!res.ok || !data.ok) {
				setBanner({ ok: false, text: data.syncRun?.error || data.error || `Sync failed for ${provider}` })
			} else {
				const queued = data.syncRun?.casesQueued ?? 0
				setBanner({
					ok: true,
					text: `${provider}: fetched ${data.syncRun?.recordsFetched ?? 0} record(s), queued ${queued} new case(s).`,
				})
				if (queued > 0) onCasesQueued()
			}
			await loadIntegrations()
		} catch (err) {
			setBanner({ ok: false, text: err instanceof Error ? err.message : String(err) })
		} finally {
			setBusyProvider(null)
		}
	}

	const handleDisconnect = async (provider: string) => {
		setBusyProvider(provider)
		try {
			await fetch(`/api/integrations/${provider}/disconnect`, { method: "POST" })
			setBanner({ ok: true, text: `Disconnected ${provider} and wiped stored credentials.` })
			await loadIntegrations()
		} finally {
			setBusyProvider(null)
		}
	}

	const filtered = integrations.filter((item) => {
		if (filter === "all") return true
		if (filter === "b2c") return item.audiences.includes("b2c")
		if (filter === "b2b") return item.audiences.includes("b2b")
		if (filter === "accounting") return item.category === "accounting"
		if (filter === "banking") return item.category === "banking"
		return true
	})

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div>
					<h3 className="text-sm font-bold text-[#e3edef]">Connected Platforms &amp; Live Data Feeds</h3>
					<p className="text-xs text-[#81949a]">
						Connect B2C payout apps, B2B accounting ERPs, Open Banking, or email forwarding. Credentials are encrypted with AES-256-GCM.
					</p>
				</div>
				<div className="flex flex-wrap gap-1.5">
					{(
						[
							{ id: "all", label: "All Platforms" },
							{ id: "b2c", label: "B2C Freelancer" },
							{ id: "b2b", label: "B2B Finance & Ops" },
							{ id: "accounting", label: "Accounting / ERP" },
							{ id: "banking", label: "Banking / SFTP" },
						] as const
					).map((tab) => (
						<button
							key={tab.id}
							type="button"
							onClick={() => setFilter(tab.id)}
							className={cn(
								"rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors",
								filter === tab.id
									? "border-[#225b51] bg-[#0d2725] text-[#75e4c7]"
									: "border-[#1c2a33] bg-[#0d141b] text-[#81949a] hover:text-[#e3edef]",
							)}
						>
							{tab.label}
						</button>
					))}
				</div>
			</div>

			{banner && (
				<div
					className={cn(
						"rounded-lg border px-3 py-2 text-xs font-medium",
						banner.ok
							? "border-[#225b51] bg-[#0d2725] text-[#75e4c7]"
							: "border-red-300 bg-red-50 text-red-800",
					)}
				>
					{banner.text}
				</div>
			)}

			{/* INBOUND EMAIL & WEBHOOK ENDPOINTS */}
			<div className="grid gap-3 lg:grid-cols-2">
				<Card className="flex items-center justify-between gap-3 p-3.5">
					<div className="min-w-0">
						<div className="flex items-center gap-1.5 text-xs font-bold text-[#e3edef]">
							<Mail className="h-3.5 w-3.5 text-[#62e1c3]" />
							Unique Audit Forwarding Inbox
						</div>
						<div className="mt-1 truncate font-mono text-[11.5px] text-[#75e4c7]">
							{workspace?.inboundEmailAddress || "inbox+ws-default@inbound.corridoraudit.com"}
						</div>
						<div className="mt-0.5 text-[11px] text-[#81949a]">
							Forward PDF invoices, Upwork receipts, or SWIFT advices here (Postmark/Resend/Mailgun → POST /api/webhooks/email).
						</div>
					</div>
					<Button
						size="sm"
						variant="outline"
						onClick={() =>
							copyText("email", workspace?.inboundEmailAddress || "inbox+ws-default@inbound.corridoraudit.com")
						}
					>
						{copied === "email" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
						{copied === "email" ? "Copied" : "Copy"}
					</Button>
				</Card>

				<Card className="flex items-center justify-between gap-3 p-3.5">
					<div className="min-w-0">
						<div className="flex items-center gap-1.5 text-xs font-bold text-[#e3edef]">
							<Link2 className="h-3.5 w-3.5 text-[#62e1c3]" />
							Signed Webhook Receiver
						</div>
						<div className="mt-1 truncate font-mono text-[11.5px] text-[#c7d3d6]">
							POST /api/webhooks/inbound
						</div>
						<div className="mt-0.5 text-[11px] text-[#81949a]">
							Verifies Stripe-Signature, Wise X-Signature-SHA256, and X-Corridor-Signature. Accepts JSON, MT103, XML, or CSV.
						</div>
					</div>
					<Button size="sm" variant="outline" onClick={() => copyText("webhook", "/api/webhooks/inbound")}>
						{copied === "webhook" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
						{copied === "webhook" ? "Copied" : "Copy"}
					</Button>
				</Card>
			</div>

			{/* CONNECTION CARDS GRID */}
			<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
				{filtered.map((item) => {
					const isConnected = item.connection.status === "connected"
					const isError = item.connection.status === "error"
					const isBusy = busyProvider === item.provider
					return (
						<Card key={item.provider} className="flex flex-col justify-between gap-3 p-4">
							<div>
								<div className="flex items-start justify-between gap-2">
									<div>
										<div className="text-sm font-bold text-[#e3edef]">{item.name}</div>
										<div className="mt-1 flex flex-wrap gap-1">
											{item.audiences.map((aud) => (
												<Badge key={aud} variant="neutral" className="uppercase">
													{aud}
												</Badge>
											))}
											<Badge variant="neutral">{item.category}</Badge>
										</div>
									</div>
									<Badge variant={isConnected ? "ok" : isError ? "bad" : "neutral"}>
										{item.connection.status}
									</Badge>
								</div>

								<p className="mt-2.5 text-xs leading-relaxed text-[#a4b4b8]">{item.description}</p>
								<div className="mt-2 rounded bg-[#080d12] px-2.5 py-1.5 text-[11px] text-[#81949a]">
									<strong className="text-[#c7d3d6]">Data:</strong> {item.dataReceived}
								</div>
								{item.connection.lastSyncedAt && (
									<div className="mt-1.5 text-[11px] text-[#75e4c7]">
										Last synced: {new Date(item.connection.lastSyncedAt).toLocaleString()}
									</div>
								)}
								{item.connection.lastError && (
									<div className="mt-1.5 text-[11px] text-red-400">{item.connection.lastError}</div>
								)}
							</div>

							<div className="flex flex-wrap items-center gap-2 border-t border-[#1c2a33] pt-2.5">
								{isConnected || isError ? (
									<>
										{item.provider !== "email_inbound" && (
											<Button
												size="sm"
												variant="emerald"
												disabled={isBusy}
												onClick={() => void handleSyncNow(item.provider)}
											>
												<RefreshCw className={cn("h-3.5 w-3.5", isBusy && "animate-spin")} />
												Sync Now
											</Button>
										)}
										<Button
											size="sm"
											variant="outline"
											disabled={isBusy}
											onClick={() => {
												setActiveProvider(item)
												setFormValues({})
											}}
										>
											Configure
										</Button>
										<Button
											size="sm"
											variant="outline"
											disabled={isBusy}
											onClick={() => void handleDisconnect(item.provider)}
										>
											<Unlink className="h-3.5 w-3.5" />
											Disconnect
										</Button>
									</>
								) : (
									<>
										{item.oauthConfigured && (
											<Button
												size="sm"
												variant="emerald"
												disabled={isBusy}
												onClick={() => void startOAuth(item.provider)}
											>
												OAuth Connect
											</Button>
										)}
										<Button
											size="sm"
											variant={item.oauthConfigured ? "outline" : "emerald"}
											disabled={isBusy}
											onClick={() => {
												setActiveProvider(item)
												setFormValues({})
											}}
										>
											{item.oauthConfigured ? "API Token" : "Connect"}
										</Button>
									</>
								)}
							</div>
						</Card>
					)
				})}
			</div>

			{/* RECENT SYNC RUNS */}
			{syncRuns.length > 0 && (
				<Card className="p-4">
					<div className="mb-2 text-xs font-bold text-[#e3edef]">Background &amp; Manual Sync Activity</div>
					<div className="space-y-1.5 font-mono text-[11px]">
						{syncRuns.slice(0, 6).map((run) => (
							<div
								key={run.id}
								className="flex flex-wrap items-center justify-between gap-2 rounded bg-[#080d12] px-2.5 py-1.5 text-[#c7d3d6]"
							>
								<span>
									{run.provider} · {run.trigger}
								</span>
								<span>
									fetched {run.recordsFetched} · queued {run.casesQueued}
								</span>
								<span className={run.status === "success" ? "text-[#75e4c7]" : run.status === "running" ? "text-amber-300" : "text-red-400"}>
									{run.status === "success" ? "Fetch complete" : run.status === "running" ? "Fetching" : "Fetch failed"}
								</span>
								<span className={run.auditStatus === "completed" ? "text-[#75e4c7]" : run.auditStatus === "failed" || run.auditStatus === "partial" ? "text-amber-300" : "text-[#91a5ad]"}>
									Audit {run.auditStatus === "not_queued" ? "no new cases" : run.auditStatus ?? "status unavailable"}
								</span>
							</div>
						))}
					</div>
				</Card>
			)}

			{/* CONNECT MODAL */}
			{activeProvider && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-[#080d12]/70 p-4 backdrop-blur-[1px]"
					onClick={(e) => {
						if (e.target === e.currentTarget) setActiveProvider(null)
					}}
				>
					<div className="w-full max-w-md rounded-xl border border-[#32454d] bg-[#0d141b] p-5 shadow-2xl">
						<div className="flex items-center justify-between border-b border-[#1c2a33] pb-3">
							<h4 className="text-sm font-bold text-[#e3edef]">Connect {activeProvider.name}</h4>
							<Button size="sm" variant="outline" onClick={() => setActiveProvider(null)}>
								<X className="h-3.5 w-3.5" />
							</Button>
						</div>
						<div className="mt-4 space-y-3">
							{activeProvider.fields.map((field) => {
								const isSecret = field.type === "password"
								const isShown = Boolean(revealedFields[field.key])
								return (
									<div key={field.key}>
										<label className="mb-1 block text-xs font-semibold text-[#c7d3d6]">
											{field.label} {field.required && <span className="text-red-400">*</span>}
										</label>
										<div className="relative">
											<input
												type={isSecret && isShown ? "text" : field.type}
												value={formValues[field.key] ?? ""}
												onChange={(e) => setFormValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
												placeholder={field.placeholder}
												className={cn(
													"h-9 w-full rounded-lg border border-[#32454d] bg-[#080d12] pl-3 font-mono text-xs text-[#e3edef] focus:border-emerald-600 focus:outline-none",
													isSecret ? "pr-9" : "pr-3",
												)}
											/>
											{isSecret && (
												<button
													type="button"
													onClick={() =>
														setRevealedFields((prev) => ({ ...prev, [field.key]: !prev[field.key] }))
													}
													aria-label={isShown ? `Hide ${field.label}` : `Show ${field.label}`}
													className="absolute top-1.5 right-1.5 rounded-lg p-1 text-[#81949a] hover:bg-[#101820] hover:text-[#e3edef]"
												>
													{isShown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
												</button>
											)}
										</div>
									</div>
								)
							})}
						</div>
						<div className="mt-5 flex justify-end gap-2">
							<Button variant="outline" onClick={() => setActiveProvider(null)}>
								Cancel
							</Button>
							<Button
								variant="emerald"
								disabled={busyProvider === activeProvider.provider}
								onClick={() => void submitConnectForm()}
							>
								Save Encrypted Connection
							</Button>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}
