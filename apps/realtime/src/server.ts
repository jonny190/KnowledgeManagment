import { Server, Hocuspocus } from "@hocuspocus/server";
import { Database } from "@hocuspocus/extension-database";
import * as Y from "yjs";
import { prisma } from "./prisma.js";
import { verifyRealtimeToken, type RealtimeContext } from "./auth.js";
import { snapshotNote, setDocProvider } from "./snapshot.js";
import { handleAdminRequest, isAdminRequest } from "./admin-http.js";
import { setAdminDocProvider } from "./admin.js";

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

  // Bridge the live in-memory Y.Doc into the admin write path.
  // When a live Hocuspocus document exists, mutations are applied directly to
  // it so Hocuspocus broadcasts the CRDT update to all connected clients.
  // When no clients are connected we fall back to a transient doc + DB persist.
  setAdminDocProvider(async (noteId) => {
    const hDoc = hocuspocus.documents.get(noteId);
    if (hDoc) {
      const doc = hDoc as unknown as Y.Doc;
      return {
        doc,
        lastEditorUserId: lastEditorByDoc.get(noteId) ?? null,
        // Also write the updated state to the DB so the next cold-load
        // reflects the admin change even before any client reconnects.
        persist: async (state: Buffer) => {
          await prisma.noteDoc.upsert({
            where: { noteId },
            update: { state, clock: { increment: 1 } },
            create: { noteId, state, clock: 0 },
          });
        },
      };
    }
    const row = await prisma.noteDoc.findUnique({ where: { noteId } });
    const doc = new Y.Doc();
    if (row) Y.applyUpdate(doc, row.state);
    return {
      doc,
      lastEditorUserId: lastEditorByDoc.get(noteId) ?? null,
      persist: async (state: Buffer) => {
        await prisma.noteDoc.upsert({
          where: { noteId },
          update: { state, clock: { increment: 1 } },
          create: { noteId, state, clock: 0 },
        });
      },
    };
  });

  await hocuspocus.listen();

  // After listen(), Hocuspocus has created its HTTP server. Intercept the
  // request event so /internal/* is routed to the admin handler while all
  // other requests (and WS upgrades) continue through Hocuspocus unchanged.
  const httpServer = (hocuspocus as unknown as { server?: { httpServer?: import("node:http").Server } }).server?.httpServer;
  if (httpServer) {
    const existing = httpServer.listeners("request") as ((...args: unknown[]) => void)[];
    httpServer.removeAllListeners("request");
    httpServer.on("request", (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
      if (isAdminRequest(req.url)) {
        handleAdminRequest(req, res).catch((e) => {
          // eslint-disable-next-line no-console
          console.error("[admin-http] handler error:", e);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end();
          }
        });
        return;
      }
      for (const l of existing) {
        l(req, res);
      }
    });
  }

  return hocuspocus;
}
