import type { Metadata } from "next"
import { Inter, JetBrains_Mono } from "next/font/google"
import type { ReactNode } from "react"
import "./globals.css"

const inter = Inter({
	subsets: ["latin"],
	variable: "--font-sans",
	display: "swap",
})

const jetbrainsMono = JetBrains_Mono({
	subsets: ["latin"],
	variable: "--font-mono",
	display: "swap",
})

export const metadata: Metadata = {
	title: "CorridorAudit — Concurrent Mozaik Settlement Forensics",
	description:
		"Cross-border settlement, FX spread & hidden-fee forensics powered by concurrent Mozaik agents.",
	icons: {
		icon: "/favicon.svg",
	},
}

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
			<body className="font-sans bg-slate-50 text-slate-900">{children}</body>
		</html>
	)
}
