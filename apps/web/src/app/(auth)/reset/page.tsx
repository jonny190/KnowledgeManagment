import { Suspense } from "react";
import { ResetForm } from "./ResetForm";

export const dynamic = "force-dynamic";

export default function ResetPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-md p-8">Loading...</main>}>
      <ResetForm />
    </Suspense>
  );
}
