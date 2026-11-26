import * as React from "react"
import { cn } from "@/lib/utils"

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
	({ className, ...props }, ref) => (
		<div
			ref={ref}
			className={cn("rounded border border-[#1b2a34] bg-[#0b1118] text-[#dce8e9]", className)}
			{...props}
		/>
	),
)
Card.displayName = "Card"
