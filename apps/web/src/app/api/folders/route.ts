import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@km/db";
import { createFolderInput } from "@km/shared";
import { requireUserId } from "@/lib/session";
import { assertCanAccessVault, AuthzError } from "@/lib/authz";
import { computeChildPath } from "@/lib/folder-path";

export async function POST(req: Request) {
  const userId = await requireUserId();
  let input;
  try {
    input = createFolderInput.parse(await req.json());
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: e.flatten() }, { status: 400 });
    throw e;
  }

  try {
    await assertCanAccessVault(userId, input.vaultId, "MEMBER");
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  let parentPath = "";
  if (input.parentId) {
    const parent = await prisma.folder.findUnique({
      where: { id: input.parentId },
      select: { vaultId: true, path: true },
    });
    if (!parent || parent.vaultId !== input.vaultId) {
      return NextResponse.json({ error: "Bad parent" }, { status: 400 });
    }
    parentPath = parent.path;
  }

  const folder = await prisma.folder.create({
    data: {
      vaultId: input.vaultId,
      parentId: input.parentId ?? null,
      name: input.name,
      path: computeChildPath(parentPath, input.name),
    },
  });
  return NextResponse.json({ folder }, { status: 201 });
}
