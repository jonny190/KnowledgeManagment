"use client";
import { useState } from "react";
import { useSession } from "next-auth/react";

export function VerifyEmailBanner() {
  const { data } = useSession();
  const [dismissed, setDismissed] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const emailVerified = (data?.user as { emailVerified?: string | null } | undefined)?.emailVerified;
  if (!data?.user || emailVerified || dismissed) return null;

  async function resend() {
    setBusy(true);
    await fetch("/api/me/verify-email/resend", { method: "POST" });
    setBusy(false);
    setSent(true);
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <span>
        {sent ? "Verification email sent. Check your inbox." : "Please verify your email to unlock all features."}
      </span>
      <div className="flex items-center gap-2">
        {!sent && (
          <button disabled={busy} onClick={resend} className="rounded border border-amber-500 px-2 py-1">
            {busy ? "Sending..." : "Resend email"}
          </button>
        )}
        <button onClick={() => setDismissed(true)} className="rounded px-2 py-1">
          Dismiss
        </button>
      </div>
    </div>
  );
}
