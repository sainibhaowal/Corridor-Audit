"use client"

import { Play, UploadCloud } from "lucide-react"
import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { IntegrationsPanel } from "./integrations-panel"

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer)
	let binary = ""
	const chunkSize = 0x8000
	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
	}
	return btoa(binary)
}

interface InboundSourcesViewProps {
	onIngested: () => void
}

export function InboundSourcesView({ onIngested }: InboundSourcesViewProps) {
	const fileInputRef = useRef<HTMLInputElement | null>(null)
	const [rawText, setRawText] = useState("")
	const [dragging, setDragging] = useState(false)
	const [busy, setBusy] = useState(false)
	const [errorMsg, setErrorMsg] = useState<string | null>(null)

	const uploadPayload = async (body: Record<string, unknown>) => {
		setBusy(true)
		setErrorMsg(null)
		try {
			const res = await fetch("/api/audit/upload", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			})
			if (!res.ok) {
				const json = (await res.json().catch(() => ({}))) as { error?: string }
				throw new Error(json.error || `Upload failed (HTTP ${res.status})`)
			}
			onIngested()
		} catch (err) {
			setErrorMsg(err instanceof Error ? err.message : String(err))
		} finally {
			setBusy(false)
		}
	}

	const handleFile = async (file: File) => {
		if (file.name.toLowerCase().endsWith(".pdf")) {
			const buf = await file.arrayBuffer()
			await uploadPayload({ filename: file.name, base64: arrayBufferToBase64(buf), format: "pdf" })
		} else {
			const content = await file.text()
			await uploadPayload({ filename: file.name, content, format: "auto" })
		}
	}

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-xl font-extrabold tracking-tight text-[#e3edef]">
					Data Sources &amp; Live Integrations
				</h1>
				<p className="mt-1 text-xs text-[#81949a]">
					Connect B2C payout platforms, B2B accounting ERPs, Open Banking, or email forwarding. You can also upload SWIFT MT103, ISO 20022 camt.053 XML, CSV, PDF, or JSON files below.
				</p>
			</div>

			<IntegrationsPanel onCasesQueued={onIngested} />

			{errorMsg && (
				<div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700">
					{errorMsg}
				</div>
			)}

			<div className="grid gap-4 lg:grid-cols-2">
				<Card className="p-4">
					<div
						onDragOver={(e) => {
							e.preventDefault()
							setDragging(true)
						}}
						onDragLeave={() => setDragging(false)}
						onDrop={(e) => {
							e.preventDefault()
							setDragging(false)
							const file = e.dataTransfer.files?.[0]
							if (file) void handleFile(file)
						}}
						className={cn(
							"flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-colors",
							dragging ? "border-emerald-500 bg-[#0d2725]/40" : "border-[#32454d] bg-[#080d12]",
						)}
					>
						<UploadCloud className="mb-2 h-8 w-8 text-[#71858c]" />
						<div className="text-sm font-bold text-[#e3edef]">Drop Files Here or Choose File</div>
						<p className="mt-1 mb-4 text-xs text-[#81949a]">
							Supports <span className="font-mono">.csv</span> (Upwork/Stripe/Wise/Bank),{" "}
							<span className="font-mono">.txt</span> (SWIFT MT103), <span className="font-mono">.xml</span>{" "}
							(camt.053), <span className="font-mono">.pdf</span>, <span className="font-mono">.json</span>
						</p>
						<input
							ref={fileInputRef}
							type="file"
							accept=".csv,.txt,.xml,.json,.pdf"
							className="hidden"
							onChange={(e) => {
								const file = e.target.files?.[0]
								e.target.value = ""
								if (file) void handleFile(file)
							}}
						/>
						<Button disabled={busy} onClick={() => fileInputRef.current?.click()}>
							Select File &amp; Run Autonomous Audit
						</Button>
						<div className="mt-3 text-[11px] text-[#81949a]">
							Hot Folder Watch active: <span className="font-mono text-[#c7d3d6]">./data/inbox/</span>
						</div>
					</div>
				</Card>

				<Card className="flex flex-col justify-between p-4">
					<div>
						<div className="mb-2 text-xs font-bold text-[#c7d3d6]">
							Quick Raw Paste (MT103 / Email Advice / CSV)
						</div>
						<textarea
							rows={8}
							value={rawText}
							onChange={(e) => setRawText(e.target.value)}
							placeholder="Paste SWIFT MT103 tags (:20:, :32A:, :33B:, :70:, :71A:, :71G:) or email/invoice text..."
							className="w-full rounded-md border border-[#32454d] bg-[#0d141b] p-2.5 font-mono text-xs text-[#e3edef] focus:border-emerald-600 focus:outline-none"
						/>
					</div>
					<div className="mt-3 flex flex-wrap gap-2">
						<Button
							variant="emerald"
							disabled={busy || !rawText.trim()}
							onClick={() => void uploadPayload({ content: rawText.trim(), format: "auto" })}
						>
							<Play className="h-3.5 w-3.5" />
							Parse &amp; Queue Case
						</Button>
					</div>
				</Card>
			</div>
		</div>
	)
}
