'use client';

import { useState } from 'react';

export interface CreateNoteDialogProps {
  open: boolean;
  title: string;
  vaultId: string;
  onCancel: () => void;
  onCreated: (noteId: string) => void;
}

export function CreateNoteDialog(props: CreateNoteDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!props.open) return null;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vaultId: props.vaultId, title: props.title, content: '' }),
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const body = await res.json();
      props.onCreated(body.note.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Create note"
      data-testid="create-note-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.3)',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <div style={{ background: 'white', padding: '20px', borderRadius: '6px', minWidth: '320px' }}>
        <h2>Create note &ldquo;{props.title}&rdquo;?</h2>
        {error && <p style={{ color: '#cf222e' }}>{error}</p>}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' }}>
          <button onClick={props.onCancel} disabled={busy}>
            Cancel
          </button>
          <button onClick={submit} disabled={busy} data-testid="confirm-create-note">
            {busy ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
