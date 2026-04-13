import { NextResponse } from "next/server";
import { prisma } from "@km/db";
import { requireUserId } from "@/lib/session";
import { assertCanAccessVault, AuthzError } from "@/lib/authz";

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const userId = await requireUserId();
  const note = await prisma.note.findUnique({ where: { id: ctx.params.id }, select: { vaultId: true } });
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    await assertCanAccessVault(userId, note.vaultId, "MEMBER");
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const links = await prisma.link.findMany({
    where: { targetNoteId: ctx.params.id, resolved: true },
    select: {
      id: true,
      targetTitle: true,
      sourceNote: { select: { id: true, title: true, slug: true } },
    },
  });
  return NextResponse.json({ backlinks: links }, { status: 200 });
}
