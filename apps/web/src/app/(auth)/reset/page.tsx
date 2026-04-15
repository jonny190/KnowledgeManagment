"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function ResetPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const token = sp.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    setBusy(false);
    if (res.ok) {
      router.push("/login?reset=ok");
    } else if (res.status === 410) {
      setError("This link has expired or was already used. Request a new one.");
    } else {
      setError("Reset failed. Check your password and try again.");
    }
  }

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <input
          type="password"
          required
          minLength={8}
          className="w-full rounded border px-3 py-2"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button disabled={busy || !token} className="rounded bg-black px-4 py-2 text-white">
          {busy ? "Saving..." : "Set new password"}
        </button>
      </form>
    </main>
  );
}
