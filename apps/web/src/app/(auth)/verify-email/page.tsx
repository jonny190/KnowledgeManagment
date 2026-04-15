import { redirect } from "next/navigation";
import { consumeEmailToken } from "@/lib/email-tokens";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = params.token;
  if (!token) {
    return (
      <main className="mx-auto max-w-md p-8">
        <h1 className="text-xl font-semibold">Verify your email</h1>
        <p className="mt-4">Missing token. Open the link from your email.</p>
      </main>
    );
  }
  const result = await consumeEmailToken(token, "VERIFY_EMAIL");
  if (result.ok) {
    redirect("/?verified=1");
  }
  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-xl font-semibold">Verify your email</h1>
      <p className="mt-4">
        {result.reason === "expired"
          ? "This link has expired. Request a new one from the banner after signing in."
          : result.reason === "already_consumed"
            ? "This link has already been used."
            : "This link is not valid."}
      </p>
    </main>
  );
}
