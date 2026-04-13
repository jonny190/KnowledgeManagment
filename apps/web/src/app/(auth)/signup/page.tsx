import Link from "next/link";
import { AuthForm } from "@/components/auth-form";

export default function SignupPage() {
  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Create an account</h1>
      <AuthForm mode="signup" />
      <p>
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </main>
  );
}
