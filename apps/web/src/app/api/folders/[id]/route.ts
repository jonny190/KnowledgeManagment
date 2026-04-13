import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@km/db";
import { updateFolderInput } from "@km/shared";
import { requireUserId } from "@/lib/session";
import { assertCanAccessVault, AuthzError } from "@/lib/authz";
import { computeChildPath, recomputeDescendantPaths } from "@/lib/folder-path";

export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  const userId = await requireUserId();
  const folderId = ctx.params.id;

  let input;
  try {
    input = updateFolderInput.parse(await req.json());
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: e.flatten() }, { status: 400 });
    throw e;
  }

  const current = await prisma.folder.findUnique({ where: { id: folderId } });
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    await assertCanAccessVault(userId, current.vaultId, "MEMBER");
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  let parentPath = "";
  let newParentId: string | null = current.parentId;
  if (input.parentId !== undefined) {
    newParentId = input.parentId ?? null;
    if (newParentId) {
      const parent = await prisma.folder.findUnique({
        where: { id: newParentId },
        select: { vaultId: true, path: true, id: true },
      });
      if (!parent || parent.vaultId !== current.vaultId) {
        return NextResponse.json({ error: "Bad parent" }, { status: 400 });
      }
      if (parent.id === current.id) {
        return NextResponse.json({ error: "Cannot parent to self" }, { status: 400 });
      }
      parentPath = parent.path;
    }
  } else if (current.parentId) {
    const parent = await prisma.folder.findUnique({
      where: { id: current.parentId },
      select: { path: true },
    });
    parentPath = parent?.path ?? "";
  }

  const newName = input.name ?? current.name;
  const newPath = computeChildPath(parentPath, newName);

  const folder = await prisma.$transaction(async (tx) => {
    const updated = await tx.folder.update({
      where: { id: folderId },
      data: { name: newName, parentId: newParentId, path: newPath },
    });
    await recomputeDescendantPaths(tx, folderId);
    return updated;
  });

  return NextResponse.json({ folder }, { status: 200 });
}

export async function DELETE(_req: Request, ctx: { params: { id: string } }) {
  const userId = await requireUserId();
  const folderId = ctx.params.id;
  const current = await prisma.folder.findUnique({ where: { id: folderId } });
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    await assertCanAccessVault(userId, current.vaultId, "MEMBER");
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  await prisma.folder.delete({ where: { id: folderId } });
  return new NextResponse(null, { status: 204 });
}
