import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@km/db";
import { noteShareCreateInput } from "@km/shared";
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

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const userId = await requireUserId();
  const g = await gateOwner(userId, ctx.params.id);
  if ("error" in g) return g.error;

  const [shares, links] = await Promise.all([
    prisma.noteShare.findMany({
      where: { noteId: ctx.params.id },
      select: {
        id: true,
        userId: true,
        role: true,
        createdAt: true,
        user: { select: { email: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.noteLink.findMany({
      where: { noteId: ctx.params.id, revokedAt: null },
      select: { id: true, slug: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return NextResponse.json({ shares, links }, { status: 200 });
}

export async function POST(req: Request, ctx: { params: { id: string } }) {
  const userId = await requireUserId();
  const g = await gateOwner(userId, ctx.params.id);
  if ("error" in g) return g.error;

  let input;
  try {
    input = noteShareCreateInput.parse(await req.json());
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: e.flatten() }, { status: 400 });
    throw e;
  }

  const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (!user) {
    return NextResponse.json({ reason: "user_not_found" }, { status: 404 });
  }
  if (user.id === userId) {
    return NextResponse.json({ reason: "self_share" }, { status: 400 });
  }

  const existing = await prisma.noteShare.findUnique({
    where: { noteId_userId: { noteId: ctx.params.id, userId: user.id } },
  });
  if (existing) {
    const updated = await prisma.noteShare.update({
      where: { noteId_userId: { noteId: ctx.params.id, userId: user.id } },
      data: { role: input.role },
    });
    return NextResponse.json({ share: updated }, { status: 200 });
  }

  const created = await prisma.noteShare.create({
    data: {
      noteId: ctx.params.id,
      userId: user.id,
      role: input.role,
      createdBy: userId,
    },
  });
  return NextResponse.json({ share: created }, { status: 201 });
}
