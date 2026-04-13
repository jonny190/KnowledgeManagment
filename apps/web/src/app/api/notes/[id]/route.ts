import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@km/db";
import { updateNoteInput } from "@km/shared";
import { requireUserId } from "@/lib/session";
import { assertCanAccessVault, AuthzError } from "@/lib/authz";

async function loadNoteAndAuthz(userId: string, noteId: string) {
  const note = await prisma.note.findUnique({ where: { id: noteId } });
  if (!note) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  try {
    await assertCanAccessVault(userId, note.vaultId, "MEMBER");
  } catch (e) {
    if (e instanceof AuthzError) return { error: NextResponse.json({ error: e.message }, { status: e.status }) };
    throw e;
  }
  return { note };
}

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const userId = await requireUserId();
  const { error, note } = await loadNoteAndAuthz(userId, ctx.params.id);
  if (error) return error;
  return NextResponse.json({ note }, { status: 200 });
}

export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  const userId = await requireUserId();
  const { error, note } = await loadNoteAndAuthz(userId, ctx.params.id);
  if (error) return error;

  let input;
  try {
    input = updateNoteInput.parse(await req.json());
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: e.flatten() }, { status: 400 });
    throw e;
  }

  if (input.folderId !== undefined && input.folderId !== null) {
    const folder = await prisma.folder.findUnique({
      where: { id: input.folderId },
      select: { vaultId: true },
    });
    if (!folder || folder.vaultId !== note!.vaultId) {
      return NextResponse.json({ error: "Bad folder" }, { status: 400 });
    }
  }

  // Phase 2: `content` is owned by the realtime snapshot pipeline.
  // PATCH ignores `content` even if sent for backwards compatibility.
  const updated = await prisma.note.update({
    where: { id: note!.id },
    data: {
      title: input.title ?? note!.title,
      folderId: input.folderId === undefined ? note!.folderId : input.folderId,
      updatedById: userId,
    },
  });

  return NextResponse.json({ note: updated }, { status: 200 });
}

export async function DELETE(_req: Request, ctx: { params: { id: string } }) {
  const userId = await requireUserId();
  const { error } = await loadNoteAndAuthz(userId, ctx.params.id);
  if (error) return error;
  await prisma.note.delete({ where: { id: ctx.params.id } });
  return new NextResponse(null, { status: 204 });
}
