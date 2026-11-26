import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
	"inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap",
	{
		variants: {
			variant: {
				neutral: "border-[#1b2a34] bg-[#0e1720] text-[#7e9298]",
				ok: "border-[#31544c] bg-[#62e1c3]/10 text-[#62e1c3]",
				warn: "border-[#e7b56a]/40 bg-[#e7b56a]/10 text-[#e7b56a]",
				bad: "border-[#f17678]/40 bg-[#f17678]/10 text-[#f17678]",
				violet: "border-violet-400/35 bg-violet-400/10 text-violet-300",
				dark: "border-[#29434c] bg-[#090e14] text-[#dce8e9]",
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
