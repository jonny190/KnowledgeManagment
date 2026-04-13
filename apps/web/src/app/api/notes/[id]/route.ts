import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@km/db";
import { updateNoteInput, parseWikiLinks } from "@km/shared";
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

  const contentChanged = typeof input.content === "string" && input.content !== note!.content;

  const updated = await prisma.$transaction(async (tx) => {
    const updatedNote = await tx.note.update({
      where: { id: note!.id },
      data: {
        title: input!.title ?? note!.title,
        content: input!.content ?? note!.content,
        folderId: input!.folderId === undefined ? note!.folderId : input!.folderId,
        contentUpdatedAt: contentChanged ? new Date() : note!.contentUpdatedAt,
        updatedById: userId,
      },
    });

    if (typeof input!.content === "string") {
      const parsed = parseWikiLinks(input!.content);
      const uniqueTitles = Array.from(new Set(parsed.map((p) => p.title)));
      const targets = uniqueTitles.length
        ? await tx.note.findMany({
            where: { vaultId: note!.vaultId, title: { in: uniqueTitles } },
            select: { id: true, title: true },
          })
        : [];
      const titleToId = new Map(targets.map((t) => [t.title, t.id]));

      await tx.link.deleteMany({ where: { sourceNoteId: updatedNote.id } });
      if (parsed.length > 0) {
        await tx.link.createMany({
          data: parsed.map((p) => ({
            sourceNoteId: updatedNote.id,
            targetNoteId: titleToId.get(p.title) ?? null,
            targetTitle: p.title,
            resolved: titleToId.has(p.title),
          })),
        });
      }
    }

    return updatedNote;
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
