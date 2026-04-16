'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Backlink {
  sourceNoteId: string;
  sourceTitle: string;
  snippet: string;
}

export function BacklinksPanel({
  noteId,
  vaultId,
  reloadKey,
}: {
  noteId: string;
  vaultId: string;
  reloadKey: number;
}) {
  const [items, setItems] = useState<Backlink[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    fetch(`/api/notes/${noteId}/backlinks`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`http ${r.status}`);
        return r.json();
      })
      .then((body) => {
        if (!cancelled) setItems(body.backlinks);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [noteId, reloadKey]);

  return (
    <div
      data-testid="backlinks-panel"
      className="h-full overflow-auto p-3 text-sm"
    >
      <h3 className="text-xs font-semibold uppercase text-slate-500">Backlinks</h3>
      {error && <p className="text-red-700">{error}</p>}
      {items === null && !error && <p>Loading...</p>}
      {items && items.length === 0 && <p className="text-slate-500">No backlinks.</p>}
      {items && items.length > 0 && (
        <ul className="mt-2 space-y-2">
          {items.map((b) => (
            <li key={b.sourceNoteId} className="border-b pb-2">
              <Link
                href={`/vault/${vaultId}/note/${b.sourceNoteId}`}
                className="font-semibold"
              >
                {b.sourceTitle}
              </Link>
              <div className="mt-1 text-xs text-slate-500">{b.snippet}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
