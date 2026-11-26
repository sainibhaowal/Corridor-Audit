import type { Metadata } from "next"
import { Inter, JetBrains_Mono } from "next/font/google"
import Script from "next/script"
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
		<html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
			<Script id="corridor-theme-init" strategy="beforeInteractive">
				{`try { document.documentElement.dataset.theme = localStorage.getItem("corridor-theme") === "light" ? "light" : "dark" } catch { document.documentElement.dataset.theme = "dark" }`}
			</Script>
			<body className="font-sans bg-[#080d12] text-[#e3edef]">{children}</body>
		</html>
	)
}
