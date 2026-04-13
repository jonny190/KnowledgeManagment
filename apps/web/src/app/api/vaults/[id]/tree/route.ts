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

  const [folders, notes] = await Promise.all([
    prisma.folder.findMany({ where: { vaultId }, orderBy: { name: "asc" } }),
    prisma.note.findMany({
      where: { vaultId },
      select: { id: true, title: true, slug: true, folderId: true },
      orderBy: { title: "asc" },
    }),
  ]);

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
  return NextResponse.json({ root: byId.get(rootId) }, { status: 200 });
}
