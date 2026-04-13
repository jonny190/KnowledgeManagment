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
    <aside
      data-testid="backlinks-panel"
      style={{ padding: '12px', borderLeft: '1px solid #d0d7de', width: '280px', overflowY: 'auto' }}
    >
      <h3 style={{ fontSize: '13px', textTransform: 'uppercase', color: '#57606a' }}>Backlinks</h3>
      {error && <p style={{ color: '#cf222e' }}>{error}</p>}
      {items === null && !error && <p>Loading...</p>}
      {items && items.length === 0 && <p style={{ color: '#57606a' }}>No backlinks.</p>}
      {items && items.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {items.map((b) => (
            <li key={b.sourceNoteId} style={{ padding: '8px 0', borderBottom: '1px solid #eaeef2' }}>
              <Link
                href={`/vault/${vaultId}/note/${b.sourceNoteId}`}
                style={{ fontWeight: 600 }}
              >
                {b.sourceTitle}
              </Link>
              <div style={{ fontSize: '12px', color: '#57606a', marginTop: '4px' }}>{b.snippet}</div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
