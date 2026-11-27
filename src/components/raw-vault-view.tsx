"use client"

import { Database, Download, FileCode2, RefreshCw, RotateCcw, Search } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface RawIngestionItem {
	id: string
	sourceChannel: "manual_upload" | "webhook" | "email" | "platform_sync" | "hot_folder"
	sourceProvider: string
	filename: string
	format: string
	sha256: string
	sizeBytes: number
	rawContent?: string
	isBase64: boolean
	metadata: Record<string, string>
	parseStatus: "received" | "parsed" | "failed"
	parseError?: string
	caseIds: string[]
	createdAt: string
}

const CHANNEL_LABELS: Record<string, string> = {
	all: "All Inputs",
	manual_upload: "Manual Upload",
	webhook: "Webhooks",
	email: "Inbound Email",
	platform_sync: "Platform Sync",
	hot_folder: "Hot Folder",
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function RawVaultView({ onOpenCase }: { onOpenCase: (caseId: string) => void }) {
	const [channel, setChannel] = useState("all")
	const [search, setSearch] = useState("")
	const [stats, setStats] = useState<Record<string, number>>({})
	const [items, setItems] = useState<RawIngestionItem[]>([])
	const [selected, setSelected] = useState<RawIngestionItem | null>(null)
	const [loadingDetail, setLoadingDetail] = useState(false)
	const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

	const loadList = useCallback(async () => {
		const res = await fetch(`/api/ingestions?channel=${encodeURIComponent(channel)}`, { cache: "no-store" })
		const data = (await res.json()) as {
			ok: boolean
			stats?: Record<string, number>
			ingestions?: RawIngestionItem[]
		}
		if (data.ok) {
			setStats(data.stats ?? {})
			setItems(data.ingestions ?? [])
			if (!selected && data.ingestions?.length) {
				void loadDetail(data.ingestions[0].id)
			}
		}
	}, [channel, selected])

	const loadDetail = async (id: string) => {
		setLoadingDetail(true)
		try {
			const res = await fetch(`/api/ingestions/${encodeURIComponent(id)}`, { cache: "no-store" })
			const data = (await res.json()) as { ok: boolean; ingestion?: RawIngestionItem }
			if (data.ok && data.ingestion) {
				setSelected(data.ingestion)
			}
		} finally {
			setLoadingDetail(false)
		}
	}

	useEffect(() => {
		void loadList()
	}, [loadList])

	const handleReprocess = async (id: string) => {
		setNotice(null)
		const res = await fetch(`/api/ingestions/${encodeURIComponent(id)}/reprocess`, { method: "POST" })
		const data = (await res.json()) as { ok: boolean; queuedCount?: number; error?: string }
		if (data.ok) {
			setNotice({ ok: true, text: `Re-parsed raw payload and queued ${data.queuedCount ?? 0} case(s) into Mozaik.` })
			await loadList()
			await loadDetail(id)
		} else {
			setNotice({ ok: false, text: data.error || "Re-parse failed." })
		}
	}

	const filtered = items.filter((item) => {
		if (!search.trim()) return true
		const q = search.trim().toLowerCase()
		return (
			item.filename.toLowerCase().includes(q) ||
			item.sourceProvider.toLowerCase().includes(q) ||
			item.sha256.toLowerCase().includes(q) ||
			item.caseIds.some((cid) => cid.toLowerCase().includes(q))
		)
	})

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div>
					<h1 className="text-xl font-extrabold tracking-tight text-[#e3edef]">
						Raw Data Vault &amp; Ingestion Ledger
					</h1>
					<p className="mt-0.5 text-xs text-[#81949a]">
						Every untouched file, webhook payload, inbound email, platform sync, and hot-folder drop is persisted here with its SHA-256 fingerprint before parsing.
					</p>
				</div>
				<Button variant="outline" size="sm" onClick={() => void loadList()}>
					<RefreshCw className="h-3.5 w-3.5" />
					Refresh Vault
				</Button>
			</div>

			{/* CHANNEL STATS STRIP */}
			<div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
				{[
					{ label: "Total Raw Inputs", val: stats.total ?? 0 },
					{ label: "Manual Uploads", val: stats.manual_upload ?? 0 },
					{ label: "Webhooks", val: stats.webhook ?? 0 },
					{ label: "Inbound Emails", val: stats.email ?? 0 },
					{ label: "Platform Syncs", val: stats.platform_sync ?? 0 },
					{ label: "Failed Parses", val: stats.failed ?? 0 },
				].map((kpi) => (
					<Card key={kpi.label} className="p-3">
						<div className="text-[10.5px] font-bold uppercase tracking-wider text-[#81949a]">
							{kpi.label}
						</div>
						<div className="mt-1 font-mono text-lg font-extrabold text-[#e3edef] tabular">
							{kpi.val}
						</div>
					</Card>
				))}
			</div>

			{/* FILTER BAR */}
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex flex-wrap gap-1.5">
					{Object.entries(CHANNEL_LABELS).map(([key, label]) => (
						<button
							key={key}
							type="button"
							onClick={() => {
								setChannel(key)
								setSelected(null)
							}}
							className={cn(
								"rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors",
								channel === key
									? "border-[#225b51] bg-[#0d2725] text-[#75e4c7]"
									: "border-[#1c2a33] bg-[#0d141b] text-[#81949a] hover:text-[#e3edef]",
							)}
						>
							{label}
						</button>
					))}
				</div>
				<div className="relative w-64">
					<Search className="pointer-events-none absolute top-2 left-2.5 h-3.5 w-3.5 text-[#71858c]" />
					<input
						type="text"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Search filename, SHA-256, caseId..."
						className="h-8 w-full rounded-lg border border-[#32454d] bg-[#0d141b] pr-3 pl-8 text-xs text-[#e3edef] focus:border-emerald-600 focus:outline-none"
					/>
				</div>
			</div>

			{notice && (
				<div
					className={cn(
						"rounded-lg border px-3 py-2 text-xs font-medium",
						notice.ok
							? "border-[#225b51] bg-[#0d2725] text-[#75e4c7]"
							: "border-red-300 bg-red-50 text-red-800",
					)}
				>
					{notice.text}
				</div>
			)}

			{/* MASTER-DETAIL RAW INSPECTOR */}
			<div className="grid min-h-[460px] gap-4 lg:grid-cols-[360px_1fr]">
				<Card className="flex flex-col gap-2 overflow-y-auto p-3">
					<div className="px-1 text-[10.5px] font-bold uppercase tracking-wider text-[#71858c]">
						Stored Raw Payloads ({filtered.length})
					</div>
					{filtered.length === 0 ? (
						<div className="flex flex-1 flex-col items-center justify-center p-6 text-center text-xs text-[#81949a]">
							<Database className="mb-2 h-7 w-7 opacity-60" />
							No raw inputs recorded for this filter yet. Upload a file, send a webhook, or sync a connected platform.
						</div>
					) : (
						filtered.map((item) => {
							const active = selected?.id === item.id
							return (
								<button
									key={item.id}
									type="button"
									onClick={() => void loadDetail(item.id)}
									className={cn(
										"w-full rounded-xl border p-3 text-left transition-colors",
										active
											? "border-[#225b51] bg-[#0d2725]"
											: "border-[#1c2a33] bg-[#080d12] hover:border-[#32454d]",
									)}
								>
									<div className="flex items-start justify-between gap-2">
										<div className="min-w-0 truncate text-xs font-bold text-[#e3edef]">
											{item.filename}
										</div>
										<Badge variant={item.parseStatus === "parsed" ? "ok" : item.parseStatus === "failed" ? "bad" : "warn"}>
											{item.parseStatus}
										</Badge>
									</div>
									<div className="mt-1.5 flex flex-wrap gap-1">
										<Badge variant="neutral">{CHANNEL_LABELS[item.sourceChannel] || item.sourceChannel}</Badge>
										<Badge variant="neutral">{item.format}</Badge>
										<Badge variant="neutral">{formatBytes(item.sizeBytes)}</Badge>
									</div>
									<div className="mt-1.5 flex items-center justify-between font-mono text-[10.5px] text-[#81949a]">
										<span>sha256:{item.sha256.slice(0, 12)}…</span>
										<span>{new Date(item.createdAt).toLocaleTimeString()}</span>
									</div>
								</button>
							)
						})
					)}
				</Card>

				<Card className="flex flex-col p-4">
					{!selected ? (
						<div className="flex flex-1 flex-col items-center justify-center text-center text-xs text-[#81949a]">
							<FileCode2 className="mb-2 h-8 w-8 opacity-60" />
							Select a stored raw ingestion on the left to inspect its untouched payload, SHA-256 checksum, and extracted cases.
						</div>
					) : loadingDetail ? (
						<div className="flex flex-1 items-center justify-center text-xs text-[#81949a]">
							Loading raw payload...
						</div>
					) : (
						<div className="flex flex-1 flex-col gap-3">
							<div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#1c2a33] pb-3">
								<div>
									<div className="text-sm font-extrabold text-[#e3edef]">{selected.filename}</div>
									<div className="mt-1 font-mono text-[11px] text-[#81949a]">
										ID: {selected.id} · SHA-256: {selected.sha256}
									</div>
								</div>
								<div className="flex flex-wrap gap-2">
									<a
										href={`/api/ingestions/${encodeURIComponent(selected.id)}?download=1`}
										className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#32454d] bg-[#080d12] px-3 text-xs font-semibold text-[#c7d3d6] hover:text-[#e3edef]"
									>
										<Download className="h-3.5 w-3.5" />
										Download Raw
									</a>
									<Button
										size="sm"
										variant="emerald"
										onClick={() => void handleReprocess(selected.id)}
									>
										<RotateCcw className="h-3.5 w-3.5" />
										Re-parse &amp; Queue
									</Button>
								</div>
							</div>

							{selected.parseError && (
								<div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
									<strong>Parse Error:</strong> {selected.parseError}
								</div>
							)}

							<div className="flex flex-wrap items-center gap-1.5 text-xs">
								<span className="font-semibold text-[#c7d3d6]">Extracted Cases:</span>
								{selected.caseIds.length === 0 ? (
									<span className="text-[#81949a]">None</span>
								) : (
									selected.caseIds.map((cid) => (
										<button
											key={cid}
											type="button"
											onClick={() => onOpenCase(cid)}
											className="rounded-lg border border-[#225b51] bg-[#0d2725] px-2.5 py-0.5 font-mono text-[11px] font-bold text-[#75e4c7] hover:underline"
										>
											{cid}
										</button>
									))
								)}
							</div>

							<div className="flex-1 overflow-hidden rounded-xl border border-[#1c2a33] bg-[#080d12]">
								<div className="border-b border-[#1c2a33] px-3 py-1.5 font-mono text-[10.5px] font-bold uppercase tracking-wider text-[#71858c]">
									Untouched Raw Payload ({selected.isBase64 ? "Base64 Binary" : "UTF-8 Text"})
								</div>
								<pre className="max-h-[340px] overflow-auto p-3 font-mono text-[11.5px] leading-relaxed text-[#c7d3d6] whitespace-pre-wrap break-all">
									{selected.isBase64
										? `[Binary PDF/Attachment · ${formatBytes(selected.sizeBytes)} · Click "Download Raw" to inspect original file]`
										: selected.rawContent || ""}
								</pre>
							</div>
						</div>
					)}
				</Card>
			</div>
		</div>
	)
}
