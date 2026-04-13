import { Server, Hocuspocus } from "@hocuspocus/server";
import { Database } from "@hocuspocus/extension-database";
import * as Y from "yjs";
import { prisma } from "./prisma.js";
import { verifyRealtimeToken, type RealtimeContext } from "./auth.js";
import { snapshotNote, setDocProvider } from "./snapshot.js";

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const lastEditorByDoc = new Map<string, string>();

function queueSnapshot(documentName: string): void {
  const existing = debounceTimers.get(documentName);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    debounceTimers.delete(documentName);
    snapshotNote(documentName).catch((e) => {
      // eslint-disable-next-line no-console
      console.error(`[realtime] snapshot error for ${documentName}:`, e);
    });
  }, 5000);
  debounceTimers.set(documentName, t);
}

export async function startServer(port: number): Promise<Hocuspocus> {
  const hocuspocus = Server.configure({
    port,
    quiet: true,
    extensions: [
      new Database({
        async fetch({ documentName }) {
          const row = await prisma.noteDoc.findUnique({ where: { noteId: documentName } });
          return row?.state ?? null;
        },
        async store({ documentName, state }) {
          await prisma.noteDoc.upsert({
            where: { noteId: documentName },
            update: { state, clock: { increment: 1 } },
            create: { noteId: documentName, state, clock: 0 },
          });
        },
      }),
    ],
    async onAuthenticate({ documentName, token }) {
      const ctx: RealtimeContext = await verifyRealtimeToken(token, documentName);
      return ctx;
    },
    async onChange({ documentName, context }) {
      const c = context as RealtimeContext;
      if (c?.userId) lastEditorByDoc.set(documentName, c.userId);
      queueSnapshot(documentName);
    },
    async onDisconnect({ documentName, clientsCount }) {
      if (clientsCount <= 0) {
        const t = debounceTimers.get(documentName);
        if (t) {
          clearTimeout(t);
          debounceTimers.delete(documentName);
        }
        try {
          await snapshotNote(documentName);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error(`[realtime] final snapshot failed for ${documentName}:`, e);
        }
      }
    },
  });

  // Bridge the live in-memory Y.Doc into the snapshot loader when available.
  setDocProvider(async (noteId) => {
    const hDoc = hocuspocus.documents.get(noteId);
    if (hDoc) {
      return {
        doc: hDoc as unknown as Y.Doc,
        lastEditorUserId: lastEditorByDoc.get(noteId) ?? null,
      };
    }
    const row = await prisma.noteDoc.findUnique({ where: { noteId } });
    const doc = new Y.Doc();
    if (row) Y.applyUpdate(doc, row.state);
    return { doc, lastEditorUserId: lastEditorByDoc.get(noteId) ?? null };
  });

  await hocuspocus.listen();
  return hocuspocus;
}
