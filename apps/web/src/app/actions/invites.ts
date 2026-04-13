"use server";

import { prisma } from "@km/db";
import { hashInviteToken } from "@/lib/invite-token";

export type AcceptResult =
  | { ok: true; workspaceId: string }
  | { ok: false; reason: "not_found" | "expired" | "already_accepted" };

export async function acceptInvite(userId: string, token: string): Promise<AcceptResult> {
  const tokenHash = hashInviteToken(token);
  const invite = await prisma.invite.findUnique({ where: { tokenHash } });
  if (!invite) return { ok: false, reason: "not_found" };
  if (invite.acceptedAt) return { ok: false, reason: "already_accepted" };
  if (invite.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };

  await prisma.$transaction(async (tx) => {
    await tx.membership.upsert({
      where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId } },
      update: {},
      create: { workspaceId: invite.workspaceId, userId, role: invite.role },
    });
    await tx.invite.update({
      where: { tokenHash },
      data: { acceptedAt: new Date() },
    });
  });
  return { ok: true, workspaceId: invite.workspaceId };
}
