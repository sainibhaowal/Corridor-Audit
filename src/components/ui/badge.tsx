import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
	"inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-bold tracking-tight whitespace-nowrap",
	{
		variants: {
			variant: {
				neutral: "border-slate-200 bg-slate-100 text-slate-700",
				ok: "border-emerald-200 bg-emerald-50 text-emerald-700",
				warn: "border-amber-200 bg-amber-50 text-amber-800",
				bad: "border-red-200 bg-red-50 text-red-700",
				violet: "border-violet-200 bg-violet-50 text-violet-700",
				dark: "border-slate-900 bg-slate-900 text-white",
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
