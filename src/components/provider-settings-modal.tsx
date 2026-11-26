"use client"

import { CheckCircle2, ShieldCheck, X, XCircle } from "lucide-react"
import { useEffect, useState } from "react"
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
	{ id: "demo", label: "Demo Mock" },
]

interface ProviderSettingsModalProps {
	open: boolean
	current: ProviderStatus
	onSaved: (next: ProviderStatus) => void
	onClose: () => void
}

export function ProviderSettingsModal({
	open,
	current,
	onSaved,
	onClose,
}: ProviderSettingsModalProps) {
	const [selected, setSelected] = useState<ProviderId>(current.provider)
	const [modelName, setModelName] = useState(current.modelName)
	const [apiKey, setApiKey] = useState("")
	const [testing, setTesting] = useState(false)
	const [testStatus, setTestStatus] = useState<{ ok: boolean; text: string } | null>(null)

	useEffect(() => {
		if (open) {
			setSelected(current.provider)
			setModelName(current.modelName)
			setApiKey("")
			setTestStatus(null)
		}
	}, [open, current])

	if (!open) return null

	const saveConfig = async () => {
		const res = await fetch("/api/settings/provider", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				provider: selected,
				modelName: modelName.trim(),
				apiKey: apiKey.trim() || undefined,
			}),
		})
		const data = (await res.json()) as { provider: ProviderStatus }
		onSaved(data.provider)
		return data.provider
	}

	const handleTest = async () => {
		setTesting(true)
		setTestStatus(null)
		try {
			await saveConfig()
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
		await saveConfig()
		onClose()
	}

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-[#03060a]/80 p-4 backdrop-blur-sm"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose()
			}}
		>
			<div
				role="dialog"
				aria-modal="true"
				className="w-full max-w-2xl overflow-hidden rounded border border-[#29434c] bg-[#090e14] text-[#dce8e9] shadow-2xl"
			>
				<div className="flex items-center justify-between border-b border-[#1b2a34] px-5 py-3.5">
					<h2 className="text-sm font-bold text-[#dce8e9]">
						AI Model, API Key &amp; Mozaik Harness Settings
					</h2>
					<Button variant="outline" size="sm" onClick={onClose}>
						<X className="h-3.5 w-3.5" />
					</Button>
				</div>

				<div className="space-y-4 p-5">
					<div className="flex items-start gap-2.5 rounded border border-[#1b2a34] border-l-2 border-l-[#62e1c3] bg-[#0b1118] p-3 text-xs text-[#c5d4d6]">
						<ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#62e1c3]" />
						<div>
							<strong className="text-[#dce8e9]">In-Memory Security:</strong> Keys entered here remain
							strictly in server RAM for this session — never written to disk, `.env`, or Git.
						</div>
					</div>

					<div>
						<div className="mb-2 font-mono text-[10px] font-bold uppercase tracking-wider text-[#7e9298]">
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
										"h-9 rounded border px-2 text-xs font-semibold transition-colors",
										selected === p.id
											? "border-[#62e1c3] bg-[#62e1c3]/15 text-[#62e1c3]"
											: "border-[#1b2a34] bg-[#0b1118] text-[#7e9298] hover:border-[#29434c] hover:text-[#dce8e9]",
									)}
								>
									{p.label}
								</button>
							))}
						</div>
					</div>

					<div className="space-y-3">
						<div>
							<label className="mb-1 block text-xs font-semibold text-[#c5d4d6]">Model ID</label>
							<input
								type="text"
								value={modelName}
								onChange={(e) => setModelName(e.target.value)}
								className="h-9 w-full rounded border border-[#29434c] bg-[#070b10] px-3 font-mono text-xs text-[#dce8e9] focus:border-[#62e1c3] focus:outline-none"
							/>
						</div>
						<div>
							<label className="mb-1 block text-xs font-semibold text-[#c5d4d6]">
								API Key (optional if already configured in .env)
							</label>
							<input
								type="password"
								value={apiKey}
								onChange={(e) => setApiKey(e.target.value)}
								placeholder="Leave blank to keep existing .env / RAM key"
								className="h-9 w-full rounded border border-[#29434c] bg-[#070b10] px-3 font-mono text-xs text-[#dce8e9] placeholder:text-[#50646b] focus:border-[#62e1c3] focus:outline-none"
							/>
						</div>
					</div>

					{testStatus && (
						<div
							className={cn(
								"flex items-center gap-2 rounded border px-3 py-2 text-xs font-medium",
								testStatus.ok
									? "border-[#31544c] bg-[#62e1c3]/10 text-[#62e1c3]"
									: "border-[#f17678]/40 bg-[#f17678]/10 text-[#f17678]",
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

					<div className="flex flex-wrap items-center justify-between gap-2 pt-1">
						<Button variant="outline" onClick={handleTest} disabled={testing}>
							{testing ? "Testing..." : "Test Connection"}
						</Button>
						<Button onClick={handleSaveAndClose}>Save &amp; Switch Model</Button>
					</div>
				</div>
			</div>
		</div>
	)
}
