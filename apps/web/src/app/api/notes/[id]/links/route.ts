import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { nanoid } from "nanoid";
import { prisma } from "@km/db";
import { noteLinkCreateInput } from "@km/shared";
import { requireUserId } from "@/lib/session";
import { AuthzError } from "@/lib/authz";
import { assertCanAccessNote } from "@/lib/note-authz";

export async function POST(req: Request, ctx: { params: { id: string } }) {
  const userId = await requireUserId();
  try {
    await assertCanAccessNote(userId, ctx.params.id, "OWNER");
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  let input;
  try {
    input = noteLinkCreateInput.parse(await req.json().catch(() => ({})));
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: e.flatten() }, { status: 400 });
    throw e;
  }

  const link = await prisma.noteLink.create({
    data: {
      noteId: ctx.params.id,
      slug: nanoid(21),
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      createdBy: userId,
    },
  });
  return NextResponse.json({ link }, { status: 201 });
}
