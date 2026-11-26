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
	title: "CorridorAudit — Settlement Forensics & Mozaik 6.0 Telemetry",
	description:
		"Cross-border settlement, FX spread & hidden-fee forensics powered by concurrent Mozaik agents.",
	icons: {
		icon: "/favicon.svg",
	},
}

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" className={`dark ${inter.variable} ${jetbrainsMono.variable}`}>
			<body className="font-sans bg-[#070b10] text-[#dce8e9]">{children}</body>
		</html>
	)
}
