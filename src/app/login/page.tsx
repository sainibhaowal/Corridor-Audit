import { LoginShell } from "@/components/login-shell"

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
	const { error } = await searchParams
	const cognitoMode = process.env.CORRIDOR_AUTH_MODE === "cognito"

	return <LoginShell cognitoMode={cognitoMode} error={error} />
}
