import { NextResponse, type NextRequest } from "next/server"
import { verifyCorridorSession } from "@/core/security/auth"

type Role = "owner" | "controller" | "analyst" | "viewer"
const roleRank: Record<Role, number> = { viewer: 0, analyst: 1, controller: 2, owner: 3 }

function requiredRole(path: string, method: string): Role {
	if (method === "GET" || method === "HEAD") return "viewer"
	if (/^\/api\/(audit\/upload|terminal)$/.test(path) || /\/sync$/.test(path) || /\/reprocess$/.test(path)) return "analyst"
	if (/^\/api\/settings\/(provider|models|test)/.test(path)) return "owner"
	if (path === "/api/settings/workspace") return "controller"
	if (path.startsWith("/api/breakpoints/") || path.startsWith("/api/integrations/")) return "controller"
	return "controller"
}

function isPublicPath(path: string): boolean {
	return (
		path === "/login" ||
		path.startsWith("/api/auth/") ||
		path === "/api/health" ||
		path.startsWith("/api/webhooks/") ||
		/^\/api\/integrations\/[^/]+\/callback$/.test(path)
	)
}

export async function middleware(request: NextRequest) {
	if (process.env.NODE_ENV !== "production" && process.env.CORRIDOR_AUTH_MODE !== "cognito") {
		return NextResponse.next()
	}

	const path = request.nextUrl.pathname
	if (isPublicPath(path)) return NextResponse.next()

	const token = request.cookies.get("ca_session")?.value
	if (!token) {
		return path.startsWith("/api/")
			? NextResponse.json({ error: "Authentication required." }, { status: 401 })
			: NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(`${path}${request.nextUrl.search}`)}`, request.url))
	}

	try {
		const session = await verifyCorridorSession(token)
		const method = request.method.toUpperCase()
		const origin = request.headers.get("origin")
		if (method !== "GET" && method !== "HEAD" && origin && origin !== request.nextUrl.origin) {
			return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 })
		}
		const minimum = requiredRole(path, method)
		if (roleRank[session.role] < roleRank[minimum]) {
			return path.startsWith("/api/")
				? NextResponse.json({ error: "This workspace role cannot perform that action." }, { status: 403 })
				: NextResponse.redirect(new URL("/login?error=Your%20workspace%20role%20cannot%20access%20this%20page.", request.url))
		}
		return NextResponse.next()
	} catch {
		const response = path.startsWith("/api/")
			? NextResponse.json({ error: "Session expired or invalid. Sign in again." }, { status: 401 })
			: NextResponse.redirect(new URL("/login", request.url))
		response.cookies.set("ca_session", "", {
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "lax",
			path: "/",
			maxAge: 0,
		})
		return response
	}
}

export const config = {
	matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
