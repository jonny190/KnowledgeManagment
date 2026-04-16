import { NextResponse } from "next/server";
import { prisma } from "@km/db";
import { requireUserId } from "@/lib/session";
import { AuthzError } from "@/lib/authz";
import { assertCanAccessNote } from "@/lib/note-authz";

export async function DELETE(
  _req: Request,
  ctx: { params: { id: string; linkId: string } },
) {
  const userId = await requireUserId();
  try {
    await assertCanAccessNote(userId, ctx.params.id, "OWNER");
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  await prisma.noteLink
    .update({ where: { id: ctx.params.linkId }, data: { revokedAt: new Date() } })
    .catch(() => undefined);
  return new NextResponse(null, { status: 204 });
}
