import type { Prisma } from "@km/db";
import { parseWikiLinks, parseTags } from "@km/shared";

export async function recomputeLinksAndTagsTx(
  tx: Prisma.TransactionClient,
  noteId: string,
  vaultId: string,
  markdown: string,
): Promise<void> {
  const parsed = parseWikiLinks(markdown);
  const uniqueTitles = Array.from(new Set(parsed.map((p) => p.title)));
  const targets = uniqueTitles.length
    ? await tx.note.findMany({
        where: { vaultId, title: { in: uniqueTitles } },
        select: { id: true, title: true },
      })
    : [];
  const titleToId = new Map(targets.map((t) => [t.title, t.id]));

  await tx.link.deleteMany({ where: { sourceNoteId: noteId } });
  if (parsed.length > 0) {
    await tx.link.createMany({
      data: parsed.map((p) => ({
        sourceNoteId: noteId,
        targetNoteId: titleToId.get(p.title) ?? null,
        targetTitle: p.title,
        resolved: titleToId.has(p.title),
      })),
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

export const recomputeLinksTx = recomputeLinksAndTagsTx;
