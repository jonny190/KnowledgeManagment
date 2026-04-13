import { Mutex } from "async-mutex";
import * as Y from "yjs";
import { prisma } from "./prisma.js";
import { recomputeLinksTx } from "./links-tx.js";

export interface DocSnapshot {
  doc: Y.Doc;
  lastEditorUserId: string | null;
}

export type DocProvider = (noteId: string) => DocSnapshot | Promise<DocSnapshot>;

let docProvider: DocProvider | null = null;
const mutexes = new Map<string, Mutex>();

export function setDocProvider(p: DocProvider): void {
  docProvider = p;
}

// Test helpers.
export function __setDocProvider(p: DocProvider): void {
  docProvider = p;
}
export function __clearDocProvider(): void {
  docProvider = null;
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

async function loadDoc(noteId: string): Promise<DocSnapshot> {
  if (docProvider) return docProvider(noteId);
  const row = await prisma.noteDoc.findUnique({ where: { noteId } });
  const doc = new Y.Doc();
  if (row) Y.applyUpdate(doc, row.state);
  return { doc, lastEditorUserId: null };
}

export async function snapshotNote(noteId: string): Promise<void> {
  const m = mutexFor(noteId);
  await m.runExclusive(async () => {
    const { doc, lastEditorUserId } = await loadDoc(noteId);
    const markdown = doc.getText("content").toString();

    const note = await prisma.note.findUnique({
      where: { id: noteId },
      select: { id: true, vaultId: true, content: true, updatedById: true },
    });
    if (!note) return;
    if (note.content === markdown) return;

    const attempt = async () => {
      await prisma.$transaction(async (tx) => {
        await tx.note.update({
          where: { id: noteId },
          data: {
            content: markdown,
            contentUpdatedAt: new Date(),
            updatedById: lastEditorUserId ?? note.updatedById,
          },
        });
        await recomputeLinksTx(tx, noteId, note.vaultId, markdown);
      });
    };

    try {
      await attempt();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[snapshot] first attempt failed for ${noteId}:`, err);
      await new Promise((r) => setTimeout(r, 500));
      try {
        await attempt();
      } catch (err2) {
        // eslint-disable-next-line no-console
        console.error(`[snapshot] retry failed for ${noteId}:`, err2);
      }
    }
  });
}
