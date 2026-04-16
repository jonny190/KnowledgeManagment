import { NextResponse } from "next/server";
import { prisma } from "@km/db";
import { requireUserId } from "@/lib/session";
import { assertCanAccessVault, AuthzError } from "@/lib/authz";

interface TreeFolder {
  id: string;
  name: string;
  path: string;
  children: TreeFolder[];
  notes: Array<{ id: string; title: string; slug: string }>;
}

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const userId = await requireUserId();
  const vaultId = ctx.params.id;
  try {
    await assertCanAccessVault(userId, vaultId, "MEMBER");
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const [folders, notes, diagrams] = await Promise.all([
    prisma.folder.findMany({ where: { vaultId }, orderBy: { name: "asc" } }),
    prisma.note.findMany({
      where: {
        vaultId,
        OR: [
          { visibility: "WORKSPACE" },
          { createdById: userId },
          { shares: { some: { userId } } },
        ],
      },
      select: { id: true, title: true, slug: true, folderId: true, updatedAt: true, visibility: true },
      orderBy: { title: "asc" },
    }),
    prisma.diagram.findMany({
      where: { vaultId },
      select: { id: true, title: true, folderId: true, kind: true, updatedAt: true },
      orderBy: { title: "asc" },
    }),
  ]);

  const items = [
    ...notes.map((n) => ({ kind: "note" as const, id: n.id, title: n.title, folderId: n.folderId, updatedAt: n.updatedAt })),
    ...diagrams.map((d) => ({
      kind: (d.kind === "DRAWIO" ? "drawio" : "bpmn") as "drawio" | "bpmn",
      id: d.id,
      title: d.title,
      folderId: d.folderId,
      updatedAt: d.updatedAt,
    })),
  ];

  const byId = new Map<string, TreeFolder>();
  for (const f of folders) {
    byId.set(f.id, { id: f.id, name: f.name, path: f.path, children: [], notes: [] });
  }
  let rootId: string | null = null;
  for (const f of folders) {
    const node = byId.get(f.id)!;
    if (f.parentId) {
      const parent = byId.get(f.parentId);
      parent?.children.push(node);
    } else {
      rootId = f.id;
    }
  }
  for (const n of notes) {
    if (n.folderId && byId.has(n.folderId)) {
      byId.get(n.folderId)!.notes.push({ id: n.id, title: n.title, slug: n.slug });
    }
  }
  if (!rootId) return NextResponse.json({ error: "Vault missing root folder" }, { status: 500 });
  return NextResponse.json({ root: byId.get(rootId), items, notes }, { status: 200 });
}
