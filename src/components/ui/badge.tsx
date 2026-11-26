import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
	"inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-bold tracking-tight whitespace-nowrap",
	{
		variants: {
			variant: {
				neutral: "border-[#1c2a33] bg-[#101820] text-[#c7d3d6]",
				ok: "border-[#225b51] bg-[#0d2725] text-[#75e4c7]",
				warn: "border-[#674b23] bg-[#2c2111] text-[#f0c77f]",
				bad: "border-red-200 bg-red-50 text-red-700",
				violet: "border-violet-200 bg-violet-50 text-violet-700",
				dark: "border-[#29434c] bg-[#121c24] text-white",
			},
		},
		defaultVariants: {
			variant: "neutral",
		},
	},
)

export interface BadgeProps
	extends React.HTMLAttributes<HTMLSpanElement>,
		VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
	return <span className={cn(badgeVariants({ variant, className }))} {...props} />
}
