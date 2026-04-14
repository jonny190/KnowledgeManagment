"use client";
import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useActiveVault } from "@/hooks/useActiveVault";

interface SearchHit {
  id: string;
  title: string;
  snippet: string;
}

export default function SearchPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const vaultId = useActiveVault();
  const [q, setQ] = useState(sp?.get("q") ?? "");
  const debouncedQ = useDebouncedValue(q, 200);
  const [results, setResults] = useState<SearchHit[]>([]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (debouncedQ) url.searchParams.set("q", debouncedQ);
    else url.searchParams.delete("q");
    window.history.replaceState(null, "", url);
  }, [debouncedQ]);

  useEffect(() => {
    if (!vaultId || debouncedQ.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/search?vaultId=${vaultId}&q=${encodeURIComponent(debouncedQ)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setResults(data.results ?? []);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      });
    return () => {
      cancelled = true;
    };
  }, [vaultId, debouncedQ]);

  return (
    <div className="p-6 max-w-3xl">
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search notes..."
        className="w-full rounded border px-3 py-2 bg-[var(--bg)] text-[var(--fg)]"
      />
      <ul className="mt-4 space-y-2">
        {results.map((hit) => (
          <li
            key={hit.id}
            className="rounded border p-3 cursor-pointer hover:bg-[var(--border)]"
            onClick={() => router.push(`/vault/${vaultId}/note/${hit.id}`)}
          >
            <div className="font-medium">{hit.title}</div>
            <div
              className="text-sm text-[var(--muted)]"
              dangerouslySetInnerHTML={{ __html: hit.snippet }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
