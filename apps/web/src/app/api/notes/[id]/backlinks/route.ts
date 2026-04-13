import { NextResponse } from "next/server";
import { prisma } from "@km/db";
import { computeSnippet } from "@km/shared";
import { requireUserId } from "@/lib/session";
import { assertCanAccessVault, AuthzError } from "@/lib/authz";

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const userId = await requireUserId();
  const target = await prisma.note.findUnique({ where: { id: ctx.params.id } });
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    await assertCanAccessVault(userId, target.vaultId, "MEMBER");
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const links = await prisma.link.findMany({
    where: { targetNoteId: target.id },
    include: {
      sourceNote: { select: { id: true, title: true, content: true } },
    },
  });

  const backlinks = links.map((l) => ({
    sourceNoteId: l.sourceNote.id,
    sourceTitle: l.sourceNote.title,
    snippet: computeSnippet(l.sourceNote.content, target.title),
  }));

  return NextResponse.json({ backlinks }, { status: 200 });
}
