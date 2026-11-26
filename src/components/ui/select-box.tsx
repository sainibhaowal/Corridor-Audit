"use client"

import { Check, ChevronDown } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

export interface SelectOption {
	value: string
	label: string
	description?: string
}

interface SelectBoxProps {
	value: string
	options: SelectOption[]
	onChange: (value: string) => void
	placeholder?: string
	title?: string
	className?: string
	buttonClassName?: string
	menuClassName?: string
}

export function SelectBox({
	value,
	options,
	onChange,
	placeholder = "Select...",
	title,
	className,
	buttonClassName,
	menuClassName,
}: SelectBoxProps) {
	const [open, setOpen] = useState(false)
	const containerRef = useRef<HTMLDivElement | null>(null)

	useEffect(() => {
		if (!open) return
		const onMouseDown = (e: MouseEvent) => {
			if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
				setOpen(false)
			}
		}
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false)
		}
		window.addEventListener("mousedown", onMouseDown)
		window.addEventListener("keydown", onKeyDown)
		return () => {
			window.removeEventListener("mousedown", onMouseDown)
			window.removeEventListener("keydown", onKeyDown)
		}
	}, [open])

	const active = options.find((o) => o.value === value)

	return (
		<div ref={containerRef} className={cn("relative", className)}>
			<button
				type="button"
				title={title}
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
				className={cn(
					"flex h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-[#32454d] bg-[#080d12] px-3 text-left text-xs font-semibold text-[#e3edef] transition-colors hover:border-[#4b646f] focus:border-emerald-600 focus:outline-none",
					buttonClassName,
				)}
			>
				<span className="truncate">{active ? active.label : placeholder}</span>
				<ChevronDown
					className={cn("h-3.5 w-3.5 shrink-0 text-[#81949a] transition-transform", open && "rotate-180")}
				/>
			</button>

			{open && (
				<div
					className={cn(
						"absolute left-0 z-50 mt-1.5 max-h-64 w-full min-w-[220px] overflow-y-auto rounded-xl border border-[#32454d] bg-[#0d141b] p-1.5 shadow-xl",
						menuClassName,
					)}
				>
					{options.map((opt) => {
						const selected = opt.value === value
						return (
							<button
								key={opt.value}
								type="button"
								onClick={() => {
									onChange(opt.value)
									setOpen(false)
								}}
								className={cn(
									"flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors",
									selected
										? "bg-[#0d2725] font-bold text-[#75e4c7]"
										: "text-[#c7d3d6] hover:bg-[#101820] hover:text-[#e3edef]",
								)}
							>
								<div className="min-w-0">
									<div className="truncate">{opt.label}</div>
									{opt.description && (
										<div className="truncate text-[10.5px] opacity-75">{opt.description}</div>
									)}
								</div>
								{selected && <Check className="h-3.5 w-3.5 shrink-0 text-[#62e1c3]" />}
							</button>
						)
					})}
				</div>
			)}
		</div>
	)
}
