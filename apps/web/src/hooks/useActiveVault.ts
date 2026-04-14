"use client";
import { useSearchParams, useParams } from "next/navigation";

/**
 * Returns the active vault ID by checking URL params then search params.
 * Components inside /vault/[vaultId]/... will pick it up from route params.
 * The search page passes it as ?vaultId=... in the query string.
 */
export function useActiveVault(): string | null {
  const params = useParams();
  const searchParams = useSearchParams();

  const fromRoute = params?.vaultId;
  if (typeof fromRoute === "string" && fromRoute) return fromRoute;

  return searchParams?.get("vaultId") ?? null;
}
