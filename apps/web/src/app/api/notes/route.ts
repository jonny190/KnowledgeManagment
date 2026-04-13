import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@km/db";
import { createNoteInput, slugify } from "@km/shared";
import { requireUserId } from "@/lib/session";
import { assertCanAccessVault, AuthzError } from "@/lib/authz";

export async function POST(req: Request) {
  const userId = await requireUserId();
  let input;
  try {
    input = createNoteInput.parse(await req.json());
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

  if (input.folderId) {
    const folder = await prisma.folder.findUnique({
      where: { id: input.folderId },
      select: { vaultId: true },
    });
    if (!folder || folder.vaultId !== input.vaultId) {
      return NextResponse.json({ error: "Bad folder" }, { status: 400 });
    }
  }

  const baseSlug = slugify(input.title);
  let slug = baseSlug;
  let suffix = 1;
  while (await prisma.note.findFirst({ where: { vaultId: input.vaultId, slug } })) {
    suffix += 1;
    slug = `${baseSlug}-${suffix}`;
  }

  const now = new Date();
  const note = await prisma.note.create({
    data: {
      vaultId: input.vaultId,
      folderId: input.folderId ?? null,
      title: input.title,
      slug,
      content: input.content ?? "",
      contentUpdatedAt: now,
      createdById: userId,
      updatedById: userId,
    },
  });
  return NextResponse.json({ note }, { status: 201 });
}
