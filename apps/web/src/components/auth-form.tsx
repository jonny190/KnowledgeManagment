"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";

type Mode = "login" | "signup";

export function AuthForm({ mode }: { mode: Mode }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        const res = await fetch("/api/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, name: name || undefined }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "Signup failed");
        }
      }

      // Fetch the current CSRF token immediately before posting credentials so
      // that the token and cookie are guaranteed to be in sync — no concurrent
      // fetch can slip in between these two sequential awaits.
      const csrfRes = await fetch("/api/auth/csrf");
      const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

      const body = new URLSearchParams({
        email,
        password,
        csrfToken,
        json: "true",
        redirect: "false",
        callbackUrl: "/",
      });

      const res = await fetch("/api/auth/callback/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      if (!res.ok) {
        throw new Error("Sign in failed");
      }

      const data = (await res.json()) as { url?: string };

      // NextAuth returns the signIn page URL when credentials are rejected.
      if (!data.url || new URL(data.url).pathname !== "/") {
        throw new Error("Invalid email or password");
      }

      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12, maxWidth: 360 }}>
      {mode === "signup" && (
        <label>
          Name
          <input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
          />
        </label>
      )}
      <label>
        Email
        <input
          name="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          required
          minLength={mode === "signup" ? 8 : 1}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
        />
      </label>
      {error && (
        <p role="alert" style={{ color: "crimson" }}>
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        {busy ? "Working..." : mode === "signup" ? "Sign up" : "Log in"}
      </button>
      <hr />
      <button type="button" onClick={() => signIn("google", { callbackUrl: "/" })}>
        Continue with Google
      </button>
      <button type="button" onClick={() => signIn("github", { callbackUrl: "/" })}>
        Continue with GitHub
      </button>
    </form>
  );
}
