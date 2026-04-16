import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@km/db";
import { noteVisibilityInput } from "@km/shared";
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
    input = noteVisibilityInput.parse(await req.json());
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: e.flatten() }, { status: 400 });
    throw e;
  }

  const note = await prisma.note.findUnique({
    where: { id: ctx.params.id },
    include: { vault: { select: { ownerType: true } } },
  });
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (note.vault.ownerType === "USER") {
    return NextResponse.json({ reason: "personal_vault_is_always_private" }, { status: 400 });
  }

  const updated = await prisma.note.update({
    where: { id: note.id },
    data: { visibility: input.visibility },
  });
  return NextResponse.json({ note: updated }, { status: 200 });
}
