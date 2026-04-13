import type { Prisma } from "@km/db";
import { parseWikiLinks } from "@km/shared";

export async function recomputeLinksTx(
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
}
