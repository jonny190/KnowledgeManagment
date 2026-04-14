import type { Prisma } from "@prisma/client";
import { parseWikiLinks, parseTags } from "@km/shared";
import { prisma as defaultPrisma } from "@km/db";

export type ResolvedTarget =
  | { title: string; kind: "note"; id: string }
  | { title: string; kind: "diagram"; id: string }
  | { title: string; kind: null; id: null };

export async function resolveLinkTargets(
  tx: typeof defaultPrisma,
  vaultId: string,
  titles: string[],
): Promise<ResolvedTarget[]> {
  if (titles.length === 0) return [];
  const [notes, diagrams] = await Promise.all([
    tx.note.findMany({
      where: { vaultId, title: { in: titles } },
      select: { id: true, title: true },
    }),
    tx.diagram.findMany({
      where: { vaultId, title: { in: titles } },
      select: { id: true, title: true },
    }),
  ]);
  const noteByTitle = new Map(notes.map((n) => [n.title, n.id]));
  const diagramByTitle = new Map(diagrams.map((d) => [d.title, d.id]));
  return titles.map((t) => {
    if (noteByTitle.has(t)) return { title: t, kind: "note", id: noteByTitle.get(t)! };
    if (diagramByTitle.has(t))
      return { title: t, kind: "diagram", id: diagramByTitle.get(t)! };
    return { title: t, kind: null, id: null };
  });
}

export async function recomputeLinksAndTags(
  tx: Prisma.TransactionClient,
  noteId: string,
  vaultId: string,
  markdown: string,
): Promise<void> {
  const parsed = parseWikiLinks(markdown);
  const uniqueTitles = Array.from(new Set(parsed.map((p) => p.title)));

  const [noteTargets, diagramTargets] = uniqueTitles.length
    ? await Promise.all([
        tx.note.findMany({
          where: { vaultId, title: { in: uniqueTitles } },
          select: { id: true, title: true },
        }),
        tx.diagram.findMany({
          where: { vaultId, title: { in: uniqueTitles } },
          select: { id: true, title: true },
        }),
      ])
    : [[], []];

  const titleToNoteId = new Map(noteTargets.map((t) => [t.title, t.id]));
  const titleToDiagramId = new Map(diagramTargets.map((d) => [d.title, d.id]));

  await tx.link.deleteMany({ where: { sourceNoteId: noteId } });
  if (parsed.length > 0) {
    await tx.link.createMany({
      data: parsed.map((p) => {
        const noteId_ = titleToNoteId.get(p.title) ?? null;
        const diagramId = !noteId_ ? (titleToDiagramId.get(p.title) ?? null) : null;
        return {
          sourceNoteId: noteId,
          targetNoteId: noteId_,
          targetDiagramId: diagramId,
          targetTitle: p.title,
          resolved: titleToNoteId.has(p.title) || titleToDiagramId.has(p.title),
        };
      }),
    });
  }

  // Tags
  const tags = parseTags(markdown);
  const tagNames = Array.from(new Set(tags.map((t) => t.name)));
  await tx.noteTag.deleteMany({ where: { noteId } });
  if (tagNames.length === 0) return;

  for (const name of tagNames) {
    await tx.tag.upsert({
      where: { vaultId_name: { vaultId, name } },
      create: { vaultId, name },
      update: {},
    });
  }
  const tagRows = await tx.tag.findMany({
    where: { vaultId, name: { in: tagNames } },
    select: { id: true },
  });
  await tx.noteTag.createMany({
    data: tagRows.map((r) => ({ noteId, tagId: r.id })),
    skipDuplicates: true,
  });
}

export const recomputeLinks = recomputeLinksAndTags;
