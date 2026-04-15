"use client";
import { useState } from "react";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await fetch("/api/auth/forgot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setBusy(false);
    setSent(true);
  }

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-xl font-semibold">Forgot password</h1>
      {sent ? (
        <p className="mt-4">If an account exists for {email}, a reset link is on its way.</p>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <input
            type="email"
            required
            className="w-full rounded border px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
          <button disabled={busy} className="rounded bg-black px-4 py-2 text-white">
            {busy ? "Sending..." : "Send reset link"}
          </button>
        </form>
      )}
    </main>
  );
}
