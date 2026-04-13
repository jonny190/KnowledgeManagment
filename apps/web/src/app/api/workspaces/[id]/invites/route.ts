import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@km/db";
import { createInviteInput, roleAtLeast, Role } from "@km/shared";
import { requireUserId } from "@/lib/session";
import { generateInviteToken } from "@/lib/invite-token";
import { sendInviteEmail } from "@/lib/email";

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

  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { name: true },
  });
  const inviter = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });

  const invite = await prisma.invite.create({
    data: {
      workspaceId,
      email: parsed.email,
      tokenHash,
      role: parsed.role,
      expiresAt,
    },
  });

  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  await sendInviteEmail({
    to: parsed.email,
    workspaceName: workspace.name,
    acceptUrl: `${baseUrl}/invites/${token}`,
    inviterName: inviter?.name ?? null,
  });

  return NextResponse.json({ invite, token }, { status: 201 });
}
