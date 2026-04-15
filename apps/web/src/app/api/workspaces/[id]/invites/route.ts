import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@km/db";
import { createInviteInput, roleAtLeast, Role } from "@km/shared";
import { requireUserId } from "@/lib/session";
import { generateInviteToken } from "@/lib/invite-token";
import { enqueueSendEmail } from "@/lib/email-jobs";

export async function POST(req: Request, ctx: { params: { id: string } }) {
  const userId = await requireUserId();
  const workspaceId = ctx.params.id;

  const membership = await prisma.membership.findFirst({
    where: { workspaceId, userId },
    select: { role: true },
  });
  if (!membership || !roleAtLeast(membership.role as Role, "ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let parsed;
  try {
    parsed = createInviteInput.parse(await req.json());
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: e.flatten() }, { status: 400 });
    throw e;
  }

  const { token, tokenHash } = generateInviteToken();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days

  const invite = await prisma.invite.create({
    data: {
      workspaceId,
      email: parsed.email,
      token,
      tokenHash,
      role: parsed.role,
      expiresAt,
    },
  });

  try {
    await enqueueSendEmail({ kind: "INVITE", inviteId: invite.id });
  } catch (err) {
    console.error("[invite] enqueue failed", err);
  }

  return NextResponse.json({ invite, token }, { status: 201 });
}
