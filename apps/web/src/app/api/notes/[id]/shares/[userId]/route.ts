import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@km/db";
import { noteSharePatchInput } from "@km/shared";
import { requireUserId } from "@/lib/session";
import { AuthzError } from "@/lib/authz";
import { assertCanAccessNote } from "@/lib/note-authz";

async function gateOwner(userId: string, noteId: string) {
  try {
    await assertCanAccessNote(userId, noteId, "OWNER");
    return { ok: true as const };
  } catch (e) {
    if (e instanceof AuthzError) return { error: NextResponse.json({ error: e.message }, { status: e.status }) };
    throw e;
  }
}

export async function PATCH(
  req: Request,
  ctx: { params: { id: string; userId: string } },
) {
  const actor = await requireUserId();
  const g = await gateOwner(actor, ctx.params.id);
  if ("error" in g) return g.error;

  let input;
  try {
    input = noteSharePatchInput.parse(await req.json());
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: e.flatten() }, { status: 400 });
    throw e;
  }

  const row = await prisma.noteShare.findUnique({
    where: { noteId_userId: { noteId: ctx.params.id, userId: ctx.params.userId } },
  });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await prisma.noteShare.update({
    where: { noteId_userId: { noteId: ctx.params.id, userId: ctx.params.userId } },
    data: { role: input.role },
  });
  return NextResponse.json({ share: updated }, { status: 200 });
}

export async function DELETE(
  _req: Request,
  ctx: { params: { id: string; userId: string } },
) {
  const actor = await requireUserId();
  const g = await gateOwner(actor, ctx.params.id);
  if ("error" in g) return g.error;

  await prisma.noteShare
    .delete({
      where: { noteId_userId: { noteId: ctx.params.id, userId: ctx.params.userId } },
    })
    .catch(() => undefined);
  return new NextResponse(null, { status: 204 });
}
