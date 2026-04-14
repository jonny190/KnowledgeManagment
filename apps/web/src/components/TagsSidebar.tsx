"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useActiveVault } from "@/hooks/useActiveVault";

interface TagItem {
  name: string;
  count: number;
}

export function TagsSidebar() {
  const vaultId = useActiveVault();
  const [tags, setTags] = useState<TagItem[]>([]);

  useEffect(() => {
    if (!vaultId) return;
    fetch(`/api/vaults/${vaultId}/tags`)
      .then((r) => r.json())
      .then((data) => setTags(data.tags ?? []))
      .catch(() => setTags([]));
  }, [vaultId]);

  if (!vaultId) return null;

  return (
    <section aria-label="Tags" className="mt-4">
      <h3 className="px-3 py-1 text-xs uppercase text-[var(--muted)]">Tags</h3>
      <ul>
        {tags.map((t) => (
          <li key={t.name}>
            <Link
              href={`/vault/${vaultId}/tags/${encodeURIComponent(t.name)}`}
              className="flex justify-between px-3 py-1 hover:bg-[var(--border)]"
            >
              <span>#{t.name}</span>
              <span className="text-[var(--muted)]">{t.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
