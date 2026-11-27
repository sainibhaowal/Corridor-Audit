import * as React from "react"
import { cn } from "@/lib/utils"

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
	({ className, ...props }, ref) => (
		<div
			ref={ref}
			className={cn(
				"corridor-card rounded-xl border border-[#1c2a33] bg-[#0d141b] text-[#e3edef] shadow-[0_10px_28px_-8px_rgba(0,0,0,0.45),0_2px_6px_-1px_rgba(0,0,0,0.28)]",
				className,
			)}
			{...props}
		/>
	),
)
Card.displayName = "Card"
