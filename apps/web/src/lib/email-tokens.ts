import { prisma } from "@km/db";
import type { EmailTokenKind } from "@prisma/client";
import { hashToken } from "@km/email/tokens";

export type ConsumeResult =
  | { ok: true; userId: string; email: string }
  | { ok: false; reason: "not_found" | "expired" | "already_consumed" };

export async function consumeEmailToken(
  rawToken: string,
  kind: EmailTokenKind,
): Promise<ConsumeResult> {
  const tokenHash = hashToken(rawToken);
  return prisma.$transaction(async (tx) => {
    const row = await tx.emailToken.findUnique({ where: { tokenHash } });
    if (!row || row.kind !== kind) return { ok: false, reason: "not_found" as const };
    if (row.consumedAt) return { ok: false, reason: "already_consumed" as const };
    if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" as const };

    await tx.emailToken.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    });

    if (kind === "VERIFY_EMAIL") {
      await tx.user.update({
        where: { id: row.userId },
        data: { emailVerified: new Date() },
      });
    }

    return { ok: true, userId: row.userId, email: row.email };
  });
}
