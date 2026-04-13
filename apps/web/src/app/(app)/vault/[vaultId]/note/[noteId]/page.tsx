'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { NoteEditor, collabExtension } from '@km/editor';
import { BacklinksPanel } from '@/components/BacklinksPanel';
import { CreateNoteDialog } from '@/components/CreateNoteDialog';
import { useCollabSession } from '@/components/CollabSession';
import { ActiveUsers } from '@/components/ActiveUsers';

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
  const { data: sessionData } = useSession();
  const [note, setNote] = useState<NoteDto | null>(null);
  const [titleMap, setTitleMap] = useState<Map<string, string>>(new Map());
  const [dialogTitle, setDialogTitle] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    fetch(`/api/notes/${params.noteId}`)
      .then((r) => r.json())
      .then((body) => setNote(body.note));
  }, [params.noteId]);

  useEffect(() => {
    if (!note) return;
    type TreeNode = { id: string; name: string; children: TreeNode[]; notes: { id: string; title: string }[] };
    function collectNotes(node: TreeNode): { id: string; title: string }[] {
      return [
        ...node.notes,
        ...node.children.flatMap(collectNotes),
      ];
    }
    fetch(`/api/vaults/${note.vaultId}/tree`)
      .then((r) => r.json())
      .then((body: { root: TreeNode }) => {
        const allNotes = collectNotes(body.root);
        setTitleMap(new Map(allNotes.map((n) => [n.title, n.id])));
      });
  }, [note]);

  const user = sessionData?.user as { id?: string; name?: string | null; email?: string | null } | undefined;
  const collabUser = user?.id
    ? { id: user.id, name: user.name || user.email || "User" }
    : null;

  const session = useCollabSession(note && collabUser ? params.noteId : "", collabUser ?? { id: "", name: "" });

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

  // Reload backlinks when remote changes land via the shared Yjs document.
  useEffect(() => {
    if (!session) return;
    const handler = () => setReloadKey((k) => k + 1);
    session.ytext.observe(handler);
    return () => session.ytext.unobserve(handler);
  }, [session]);

  const editor = note && session ? (
    <NoteEditor
      key={note.id}
      initialValue=""
      onChange={() => {}}
      onDropFiles={onDropFiles}
      resolveTitle={resolveTitle}
      onNavigate={(id) => router.push(`/vault/${params.vaultId}/note/${id}`)}
      onCreateRequest={(title) => setDialogTitle(title)}
      searchTitles={searchTitles}
      collab={collabExtension({ ytext: session.ytext, awareness: session.awareness })}
    />
  ) : null;

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
            alignItems: 'center',
          }}
        >
          <h1 style={{ fontSize: '18px', margin: 0 }}>{note.title}</h1>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <ActiveUsers awareness={session?.awareness ?? null} />
            <span style={{ color: '#57606a', fontSize: '12px' }}>
              {session?.status === 'connected' ? 'Live' : session?.status ?? 'Connecting'}
            </span>
          </div>
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
