import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@km/db";
import { requireUserId } from "@/lib/session";
import { assertCanAccessVault } from "@/lib/authz";

const body = z.object({
  vaultId: z.string().min(1),
  noteId: z.string().min(1),
});

export const runtime = "nodejs";

export async function POST(req: Request) {
  const userId = await requireUserId();
  const parsed = body.parse(await req.json());
  await assertCanAccessVault(userId, parsed.vaultId, "MEMBER");

  const existing = await prisma.aiConversation.findFirst({
    where: { vaultId: parsed.vaultId, noteId: parsed.noteId, createdById: userId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (existing) {
    return NextResponse.json(existing);
  }

  const created = await prisma.aiConversation.create({
    data: {
      vaultId: parsed.vaultId,
      noteId: parsed.noteId,
      createdById: userId,
    },
    include: { messages: true },
  });
  return NextResponse.json(created);
}
