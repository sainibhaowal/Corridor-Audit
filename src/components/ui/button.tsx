import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
	"inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
	{
		variants: {
			variant: {
				default: "bg-slate-900 text-white hover:bg-slate-800 shadow-sm",
				emerald: "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm",
				outline: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900",
				secondary: "bg-slate-100 text-slate-800 hover:bg-slate-200",
				destructive: "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
				ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
			},
			size: {
				default: "h-9 px-3.5 py-2",
				sm: "h-7 rounded px-2.5 text-[11.5px]",
				lg: "h-10 rounded-md px-5 text-sm",
				icon: "h-8 w-8",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
)

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, variant, size, ...props }, ref) => (
		<button ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
	),
)
Button.displayName = "Button"
