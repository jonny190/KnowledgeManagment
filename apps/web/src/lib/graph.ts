import { prisma } from "@km/db";

export interface GraphNode {
  id: string;
  label: string;
  backlinkCount: number;
  tags: string[];
}
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
}
export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export async function buildGraph(vaultId: string): Promise<Graph> {
  const notes = await prisma.note.findMany({
    where: { vaultId },
    select: { id: true, title: true },
  });
  const ids = notes.map((n) => n.id);
  if (ids.length === 0) return { nodes: [], edges: [] };

  const links = await prisma.link.findMany({
    where: { sourceNoteId: { in: ids }, resolved: true, targetNoteId: { not: null } },
    select: { id: true, sourceNoteId: true, targetNoteId: true },
  });

  const tagRows = await prisma.noteTag.findMany({
    where: { noteId: { in: ids } },
    select: { noteId: true, tag: { select: { name: true } } },
  });

  const backlinks = new Map<string, number>();
  for (const l of links) {
    if (!l.targetNoteId) continue;
    backlinks.set(l.targetNoteId, (backlinks.get(l.targetNoteId) ?? 0) + 1);
  }

  const tagsByNote = new Map<string, string[]>();
  for (const row of tagRows) {
    const arr = tagsByNote.get(row.noteId) ?? [];
    arr.push(row.tag.name);
    tagsByNote.set(row.noteId, arr);
  }

  return {
    nodes: notes.map((n) => ({
      id: n.id,
      label: n.title,
      backlinkCount: backlinks.get(n.id) ?? 0,
      tags: tagsByNote.get(n.id) ?? [],
    })),
    edges: links.map((l) => ({
      id: l.id,
      source: l.sourceNoteId,
      target: l.targetNoteId!,
    })),
  };
}
