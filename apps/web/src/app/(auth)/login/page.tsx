import Link from "next/link";
import { AuthForm } from "@/components/auth-form";

export default function LoginPage() {
  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Log in</h1>
      <AuthForm mode="login" />
      <p>
        No account yet? <Link href="/signup">Sign up</Link>
      </p>
      <p>
        <a href="/forgot" className="text-sm text-blue-600 underline">
          Forgot password?
        </a>
      </p>
    </main>
  );
}
