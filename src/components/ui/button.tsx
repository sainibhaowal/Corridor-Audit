import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
	"inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded border text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#62e1c3] disabled:pointer-events-none disabled:opacity-45 cursor-pointer",
	{
		variants: {
			variant: {
				default: "border-[#62e1c3] bg-[#62e1c3] text-[#070b10] hover:bg-[#7ae8ce]",
				emerald: "border-[#62e1c3] bg-[#62e1c3] text-[#070b10] hover:bg-[#7ae8ce]",
				outline: "border-[#29434c] bg-[#0b1118] text-[#c5d4d6] hover:border-[#62e1c3]/60 hover:text-[#dce8e9]",
				secondary: "border-[#1b2a34] bg-[#0e1720] text-[#dce8e9] hover:border-[#29434c]",
				destructive: "border-[#f17678]/40 bg-[#f17678]/10 text-[#f17678] hover:bg-[#f17678]/20",
				ghost: "border-transparent bg-transparent text-[#7e9298] hover:text-[#62e1c3]",
			},
			size: {
				default: "h-8 px-3 py-1.5",
				sm: "h-7 px-2.5 text-[11px]",
				lg: "h-9 px-4 text-xs",
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
