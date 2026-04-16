'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { NoteEditor, collabExtension, aiCommands } from '@km/editor';
import { BacklinksPanel } from '@/components/BacklinksPanel';
import { CreateNoteDialog } from '@/components/CreateNoteDialog';
import { useCollabSession } from '@/components/CollabSession';
import { ActiveUsers } from '@/components/ActiveUsers';
import { AiChatPanel } from '@/components/AiChatPanel';
import { NoteShareHeader } from '@/components/NoteShareHeader';
import { pluginRegistry } from '@/lib/plugins/registry';
import { Drawer } from '@/components/Drawer';
import { MobileTopBar } from '@/components/MobileTopBar';
import { FileTree } from '@/components/FileTree';

interface NotePageProps {
  params: { vaultId: string; noteId: string };
}

interface NoteDto {
  id: string;
  vaultId: string;
  title: string;
  content: string;
  visibility: "WORKSPACE" | "PRIVATE";
}

interface VaultDto {
  ownerType: "USER" | "WORKSPACE";
}

export default function NotePage({ params }: NotePageProps) {
  const router = useRouter();
  const { data: sessionData } = useSession();
  const [note, setNote] = useState<NoteDto | null>(null);
  const [vault, setVault] = useState<VaultDto | null>(null);
  const [titleMap, setTitleMap] = useState<Map<string, string>>(new Map());
  const [dialogTitle, setDialogTitle] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [mobileDrawer, setMobileDrawer] = useState<null | "files" | "backlinks" | "chat">(null);

  const commandRunnerRef = useRef<((cmd: { command: string; selection: string; language?: string }) => void) | null>(null);

  const onAiCommand = useCallback((cmd: { command: string; selection: string; language?: string }) => {
    commandRunnerRef.current?.(cmd);
  }, []);

  const onApplyAtCursor = useCallback((text: string) => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("ai:applyAtCursor", { detail: { text } }));
    }
  }, []);

  useEffect(() => {
    fetch(`/api/notes/${params.noteId}`)
      .then((r) => r.json())
      .then((body) => {
        setNote(body.note);
        // Fetch vault ownerType for share dialog
        if (body.note?.vaultId) {
          fetch(`/api/vaults`)
            .then((r) => r.json())
            .then((vaults: { vaults: Array<{ id: string; ownerType: "USER" | "WORKSPACE" }> }) => {
              const v = vaults.vaults.find((x) => x.id === body.note.vaultId);
              if (v) setVault({ ownerType: v.ownerType });
            })
            .catch(() => undefined);
        }
      });
  }, [params.noteId]);

  useEffect(() => {
    if (!note) return;
    type TreeItem = { kind: "note" | "drawio" | "bpmn"; id: string; title: string };
    fetch(`/api/vaults/${note.vaultId}/tree`)
      .then((r) => r.json())
      .then((body: { items?: TreeItem[]; notes?: { id: string; title: string }[] }) => {
        const items = body.items ?? body.notes?.map((n) => ({ kind: "note" as const, id: n.id, title: n.title })) ?? [];
        setTitleMap(new Map(items.map((n) => [n.title, n.id])));
      });
  }, [note]);

  const user = sessionData?.user as { id?: string; name?: string | null; email?: string | null } | undefined;
  const collabUser = user?.id
    ? { id: user.id, name: user.name || user.email || "User" }
    : null;

  const session = useCollabSession(note && collabUser ? params.noteId : "", collabUser ?? { id: "", name: "" });

  // Notify plugin registry when the note is opened and every time the Y.Text
  // changes. Plugins that subscribe to onNoteSave (e.g. the wordcount example)
  // react to client-side edits here since Phase 2 removed the server-side
  // autosave PATCH.
  useEffect(() => {
    if (!note || !session?.ytext) return;
    const ytext = session.ytext;
    pluginRegistry.emitNoteOpen({ id: note.id, title: note.title });
    const emit = () => {
      pluginRegistry.emitNoteSave({
        id: note.id,
        title: note.title,
        content: ytext.toString(),
      });
    };
    emit();
    ytext.observe(emit);
    return () => {
      ytext.unobserve(emit);
    };
  }, [note, session?.ytext]);

  const resolveTitle = useCallback(
    (title: string) => {
      const id = titleMap.get(title);
      return id ? { noteId: id } : null;
    },
    [titleMap],
  );

  const onAsyncLinkClick = useCallback(
    async (title: string) => {
      if (!note) return;
      const res = await fetch(
        `/api/links/resolve?vaultId=${encodeURIComponent(note.vaultId)}&title=${encodeURIComponent(title)}`,
      );
      if (!res.ok) return;
      const target: { kind: 'note' | 'diagram' | null; id: string | null } = await res.json();
      if (target.kind === 'note' && target.id) {
        router.push(`/vault/${params.vaultId}/note/${target.id}`);
      } else if (target.kind === 'diagram' && target.id) {
        router.push(`/vault/${params.vaultId}/diagram/${target.id}`);
      } else {
        setDialogTitle(title);
      }
    },
    [note, params.vaultId, router],
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
      onAsyncLinkClick={onAsyncLinkClick}
      searchTitles={searchTitles}
      collab={[
        collabExtension({ ytext: session.ytext, awareness: session.awareness }),
        aiCommands({ onCommand: onAiCommand }),
      ]}
    />
  ) : null;

  if (!note) return <div>Loading...</div>;

  return (
    <div className="flex h-screen flex-col md:flex-row">
      <MobileTopBar
        title={note.title}
        buttons={[
          { key: "files", label: "Files", onClick: () => setMobileDrawer("files") },
          { key: "backlinks", label: "Backlinks", onClick: () => setMobileDrawer("backlinks") },
          { key: "chat", label: "AI", onClick: () => setMobileDrawer("chat") },
        ]}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
          <h1 className="min-w-0 flex-1 truncate text-base md:text-lg">{note.title}</h1>
          <div className="flex flex-wrap items-center gap-2 md:gap-3">
            <ActiveUsers awareness={session?.awareness ?? null} />
            <span className="text-xs text-slate-500">
              {session?.status === 'connected' ? 'Live' : session?.status ?? 'Connecting'}
            </span>
            <NoteShareHeader
              noteId={note.id}
              visibility={note.visibility ?? "WORKSPACE"}
              vaultOwnerType={vault?.ownerType ?? "WORKSPACE"}
            />
          </div>
        </header>
        <div className="min-h-0 flex-1">{editor}</div>
      </div>

      <aside className="hidden md:block md:w-72 md:shrink-0 md:border-l">
        <BacklinksPanel noteId={note.id} vaultId={params.vaultId} reloadKey={reloadKey} />
      </aside>
      <aside className="hidden md:block md:w-80 md:shrink-0 md:border-l">
        <AiChatPanel
          vaultId={params.vaultId}
          noteId={params.noteId}
          active
          onApplyAtCursor={onApplyAtCursor}
          registerCommandRunner={(fn) => { commandRunnerRef.current = fn; }}
        />
      </aside>

      <Drawer open={mobileDrawer === "files"} onClose={() => setMobileDrawer(null)} side="left" title="Files">
        <FileTree vaultId={params.vaultId} />
      </Drawer>
      <Drawer
        open={mobileDrawer === "backlinks"}
        onClose={() => setMobileDrawer(null)}
        side="right"
        title="Backlinks"
      >
        <BacklinksPanel noteId={note.id} vaultId={params.vaultId} reloadKey={reloadKey} />
      </Drawer>
      <Drawer
        open={mobileDrawer === "chat"}
        onClose={() => setMobileDrawer(null)}
        side="right"
        title="AI chat"
      >
        <AiChatPanel
          vaultId={params.vaultId}
          noteId={params.noteId}
          active={mobileDrawer === "chat"}
          onApplyAtCursor={onApplyAtCursor}
          registerCommandRunner={(fn) => { commandRunnerRef.current = fn; }}
        />
      </Drawer>

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
