import { Mutex } from "async-mutex";
import * as Y from "yjs";
import { prisma } from "./prisma.js";
import { snapshotNote } from "./snapshot.js";

export interface AdminDocHandle {
  doc: Y.Doc;
  lastEditorUserId: string | null;
  /** Persist the updated state if the doc is transient (no live Hocuspocus clients). */
  persist: (state: Uint8Array) => Promise<void>;
}

export type AdminDocProvider = (noteId: string) => Promise<AdminDocHandle>;

const mutexes = new Map<string, Mutex>();
let provider: AdminDocProvider = async (noteId: string) => {
  const row = await prisma.noteDoc.findUnique({ where: { noteId } });
  const doc = new Y.Doc();
  if (row) Y.applyUpdate(doc, row.state);
  return {
    doc,
    lastEditorUserId: null,
    persist: async (state: Uint8Array) => {
      await prisma.noteDoc.upsert({
        where: { noteId },
        update: { state, clock: { increment: 1 } },
        create: { noteId, state, clock: 0 },
      });
    },
  };
};

export function setAdminDocProvider(p: AdminDocProvider): void {
  provider = p;
}
export function __setAdminDocProvider(p: AdminDocProvider): void {
  provider = p;
}
export function __resetAdminState(): void {
  mutexes.clear();
}

function mutexFor(noteId: string): Mutex {
  let m = mutexes.get(noteId);
  if (!m) {
    m = new Mutex();
    mutexes.set(noteId, m);
  }
  return m;
}

export interface AdminUpdateInput {
  noteId: string;
  op: "append" | "replace";
  text: string;
}

export interface AdminUpdateResult {
  applied: boolean;
  revision: number;
}

let revisionCounter = 0;

export async function applyAdminUpdate(
  input: AdminUpdateInput,
): Promise<AdminUpdateResult> {
  return mutexFor(input.noteId).runExclusive(async () => {
    const handle = await provider(input.noteId);
    const ytext = handle.doc.getText("content");
    if (input.op === "append") {
      ytext.insert(ytext.length, input.text);
    } else {
      ytext.delete(0, ytext.length);
      ytext.insert(0, input.text);
    }
    const state = Y.encodeStateAsUpdate(handle.doc);
    await handle.persist(state);
    // Best effort snapshot of Note.content; errors are logged inside snapshotNote.
    snapshotNote(input.noteId).catch((e) => {
      // eslint-disable-next-line no-console
      console.error(`[admin] snapshot enqueue failed for ${input.noteId}:`, e);
    });
    revisionCounter += 1;
    return { applied: true, revision: revisionCounter };
  });
}
