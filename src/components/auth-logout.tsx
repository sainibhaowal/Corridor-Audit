import { LogOut } from "lucide-react"

export function AuthLogout() {
	if (process.env.NEXT_PUBLIC_CORRIDOR_AUTH_MODE !== "cognito") return null
	return (
		<form action="/api/auth/logout" method="post">
			<button
				type="submit"
				aria-label="Sign out"
				data-tooltip="Sign out"
				className="rounded-md p-1.5 text-[#81949a] transition-colors hover:bg-[#101820] hover:text-[#e3edef]"
			>
				<LogOut className="h-4 w-4" />
			</button>
		</form>
	)
}
