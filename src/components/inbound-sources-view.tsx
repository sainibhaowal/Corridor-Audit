"use client"

import { Play, UploadCloud, Webhook } from "lucide-react"
import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

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
	onTriggerWebhook: () => Promise<void>
	onIngested: () => void
}

export function InboundSourcesView({ onTriggerWebhook, onIngested }: InboundSourcesViewProps) {
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
		<div className="space-y-4">
			<div>
				<div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#62e1c3]">
					AUTONOMOUS INGESTION <span className="text-[#50646b]">/ MULTI-FORMAT</span>
				</div>
				<h1 className="mt-1 text-xl font-semibold tracking-tight text-[#dce8e9]">
					Inbound Sources &amp; Webhook Channels
				</h1>
				<p className="mt-1 text-xs text-[#7e9298]">
					Every incoming file, webhook payload, or pasted SWIFT wire launches concurrent Mozaik agents automatically.
				</p>
			</div>

			{errorMsg && (
				<div className="rounded border border-[#f17678]/40 bg-[#f17678]/10 px-3.5 py-2.5 text-xs font-medium text-[#f17678]">
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
							"flex flex-col items-center justify-center rounded border border-dashed p-6 text-center transition-colors",
							dragging ? "border-[#62e1c3] bg-[#62e1c3]/5" : "border-[#29434c] bg-[#070b10]",
						)}
					>
						<UploadCloud className="mb-2 h-8 w-8 text-[#62e1c3]" />
						<div className="text-sm font-semibold text-[#dce8e9]">Drop Files Here or Choose File</div>
						<p className="mt-1 mb-4 text-xs text-[#7e9298]">
							Supports <span className="font-mono text-[#c5d4d6]">.csv</span> (Upwork/Stripe/Wise/Bank),{" "}
							<span className="font-mono text-[#c5d4d6]">.txt</span> (SWIFT MT103),{" "}
							<span className="font-mono text-[#c5d4d6]">.xml</span> (camt.053),{" "}
							<span className="font-mono text-[#c5d4d6]">.pdf</span>,{" "}
							<span className="font-mono text-[#c5d4d6]">.json</span>
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
						<div className="mt-3 font-mono text-[10.5px] text-[#7e9298]">
							HOT FOLDER WATCH: <span className="text-[#62e1c3]">./data/inbox/</span>
						</div>
					</div>
				</Card>

				<Card className="flex flex-col justify-between p-4">
					<div>
						<div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[#7e9298]">
							Quick Raw Paste (MT103 / Email Advice / CSV)
						</div>
						<textarea
							rows={8}
							value={rawText}
							onChange={(e) => setRawText(e.target.value)}
							placeholder="Paste SWIFT MT103 tags (:20:, :32A:, :33B:, :70:, :71A:, :71G:) or email/invoice text..."
							className="w-full rounded border border-[#29434c] bg-[#070b10] p-2.5 font-mono text-xs text-[#dce8e9] placeholder:text-[#50646b] focus:border-[#62e1c3] focus:outline-none"
						/>
					</div>
					<div className="mt-3 flex flex-wrap gap-2">
						<Button
							disabled={busy || !rawText.trim()}
							onClick={() => void uploadPayload({ content: rawText.trim(), format: "auto" })}
						>
							<Play className="h-3.5 w-3.5" />
							Parse &amp; Queue Case
						</Button>
						<Button
							variant="outline"
							onClick={() =>
								setRawText(
									`:20:TXN20261124CUSTOM\n:32A:261124USD5190,00\n:33B:EUR5000,00\n:36:1,0470\n:50K:NORDIC GEAR GMBH\n:70:/INV/INV-CUSTOM-01\n:71A:OUR\n:71G:USD45,00`,
								)
							}
						>
							Load Sample MT103
						</Button>
					</div>
				</Card>
			</div>

			<Card className="flex flex-wrap items-center justify-between gap-3 p-4">
				<div>
					<div className="text-xs font-semibold text-[#dce8e9]">Live Inbound Webhook Endpoint</div>
					<div className="mt-0.5 font-mono text-xs text-[#62e1c3]">POST /api/webhooks/inbound</div>
				</div>
				<Button disabled={busy} onClick={() => void onTriggerWebhook()}>
					<Webhook className="h-3.5 w-3.5" />
					Fire Realistic Test Webhook
				</Button>
			</Card>
		</div>
	)
}
