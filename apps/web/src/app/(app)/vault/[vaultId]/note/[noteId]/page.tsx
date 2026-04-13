'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NoteEditor } from '@km/editor';
import { useDebouncedAutosave } from '@/lib/autosave';
import { BacklinksPanel } from '@/components/BacklinksPanel';
import { CreateNoteDialog } from '@/components/CreateNoteDialog';

interface NotePageProps {
  params: { vaultId: string; noteId: string };
}

interface NoteDto {
  id: string;
  vaultId: string;
  title: string;
  content: string;
}

export default function NotePage({ params }: NotePageProps) {
  const router = useRouter();
  const [note, setNote] = useState<NoteDto | null>(null);
  const [content, setContent] = useState('');
  const [titleMap, setTitleMap] = useState<Map<string, string>>(new Map());
  const [dialogTitle, setDialogTitle] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    fetch(`/api/notes/${params.noteId}`)
      .then((r) => r.json())
      .then((body) => {
        setNote(body.note);
        setContent(body.note.content);
      });
  }, [params.noteId]);

  useEffect(() => {
    if (!note) return;
    fetch(`/api/vaults/${note.vaultId}/tree`)
      .then((r) => r.json())
      .then((body: { notes: { id: string; title: string }[] }) => {
        setTitleMap(new Map(body.notes.map((n) => [n.title, n.id])));
      });
  }, [note]);

  const save = useCallback(
    async (value: string) => {
      await fetch(`/api/notes/${params.noteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: value }),
      });
      setReloadKey((k) => k + 1);
    },
    [params.noteId],
  );

  const { saving } = useDebouncedAutosave(content, 1500, save);

  const resolveTitle = useCallback(
    (title: string) => {
      const id = titleMap.get(title);
      return id ? { noteId: id } : null;
    },
    [titleMap],
  );

  const searchTitles = useCallback(
    async (q: string) => {
      if (!note) return [];
      const res = await fetch(
        `/api/notes/search?q=${encodeURIComponent(q)}&vaultId=${note.vaultId}`,
      );
      if (!res.ok) return [];
      const body: { results: { id: string; title: string }[] } = await res.json();
      return body.results;
    },
    [note],
  );

  const onDropFiles = useCallback(
    async (files: File[], _pos: number): Promise<string | null> => {
      if (!note) return null;
      const parts: string[] = [];
      for (const f of files) {
        const form = new FormData();
        form.append('vaultId', note.vaultId);
        form.append('file', f);
        const res = await fetch('/api/attachments', { method: 'POST', body: form });
        if (!res.ok) continue;
        const body: { markdown: string } = await res.json();
        parts.push(body.markdown);
      }
      return parts.length ? parts.join('\n') : null;
    },
    [note],
  );

  const editor = useMemo(() => {
    if (!note) return null;
    return (
      <NoteEditor
        initialValue={note.content}
        onChange={setContent}
        onDropFiles={onDropFiles}
        resolveTitle={resolveTitle}
        onNavigate={(id) => router.push(`/vault/${params.vaultId}/note/${id}`)}
        onCreateRequest={(title) => setDialogTitle(title)}
        searchTitles={searchTitles}
      />
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id]);

  if (!note) return <div>Loading...</div>;

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <header
          style={{
            padding: '12px',
            borderBottom: '1px solid #d0d7de',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <h1 style={{ fontSize: '18px', margin: 0 }}>{note.title}</h1>
          <span style={{ color: '#57606a', fontSize: '12px' }}>{saving ? 'Saving...' : 'Saved'}</span>
        </header>
        <div style={{ flex: 1, minHeight: 0 }}>{editor}</div>
      </div>
      <BacklinksPanel noteId={note.id} vaultId={params.vaultId} reloadKey={reloadKey} />
      <CreateNoteDialog
        open={dialogTitle !== null}
        title={dialogTitle ?? ''}
        vaultId={note.vaultId}
        onCancel={() => setDialogTitle(null)}
        onCreated={(id) => {
          setDialogTitle(null);
          router.push(`/vault/${params.vaultId}/note/${id}`);
        }}
      />
    </div>
  );
}
