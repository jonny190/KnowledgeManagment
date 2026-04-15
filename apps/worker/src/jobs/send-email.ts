import type { Job } from "pg-boss";
import { prisma } from "@km/db";
import { sendEmail, generateRawToken, hashToken } from "@km/email";

export type SendEmailJobData =
  | { kind: "VERIFY_EMAIL"; userId: string }
  | { kind: "PASSWORD_RESET"; userId: string }
  | { kind: "INVITE"; inviteId: string };

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 3;

function appUrl(): string {
  const u = process.env.APP_URL ?? process.env.NEXTAUTH_URL;
  if (!u) throw new Error("APP_URL or NEXTAUTH_URL not set");
  return u.replace(/\/$/, "");
}

export async function handleSendEmail(job: Job<SendEmailJobData>): Promise<void> {
  const data = job.data;
  if (data.kind === "INVITE") {
    await handleInvite(data.inviteId);
    return;
  }
  await handleVerifyOrReset(data.kind, data.userId);
}

async function handleVerifyOrReset(
  kind: "VERIFY_EMAIL" | "PASSWORD_RESET",
  userId: string,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    console.warn("[email:user-missing]", { userId, kind });
    return;
  }

  const since = new Date(Date.now() - RATE_WINDOW_MS);
  const recent = await prisma.emailToken.count({
    where: { email: user.email, kind, createdAt: { gte: since } },
  });
  if (recent >= RATE_MAX) {
    console.log("[email:rate-limited]", { email: user.email, kind, recent });
    return;
  }

  const rawToken = generateRawToken();
  const ttlMs = kind === "VERIFY_EMAIL" ? VERIFY_TTL_MS : RESET_TTL_MS;
  await prisma.emailToken.create({
    data: {
      userId: user.id,
      email: user.email,
      kind,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });

  const base = appUrl();
  if (kind === "VERIFY_EMAIL") {
    await sendEmail({
      to: user.email,
      kind: "VERIFY_EMAIL",
      data: {
        verifyUrl: `${base}/verify-email?token=${rawToken}`,
        userDisplayName: user.name,
      },
    });
  } else {
    await sendEmail({
      to: user.email,
      kind: "PASSWORD_RESET",
      data: {
        resetUrl: `${base}/reset?token=${rawToken}`,
        userDisplayName: user.name,
      },
    });
  }
}

async function handleInvite(inviteId: string): Promise<void> {
  const invite = await prisma.invite.findUnique({
    where: { id: inviteId },
    include: { workspace: true },
  });
  if (!invite) {
    console.warn("[email:invite-missing]", { inviteId });
    return;
  }

  // Rate-limit: count invites to this email created in the last 10 minutes.
  const since = new Date(Date.now() - RATE_WINDOW_MS);
  const recent = await prisma.invite.count({
    where: { email: invite.email, createdAt: { gte: since } },
  });
  if (recent > RATE_MAX) {
    console.warn("[email:rate-limited]", { email: invite.email, kind: "INVITE", recent });
    return;
  }

  // Prefer the plain token column (added in v02a_invite_token_plain migration).
  // If not present (legacy rows), we cannot reconstruct the raw token from the
  // hash, so the accept link falls back to the tokenHash. The accept route uses
  // hashInviteToken(token) to look up by tokenHash, so a legacy link will fail.
  // Task 18 will address full E2E coverage for the invite email flow.
  const urlToken = (invite as { token?: string | null }).token ?? invite.tokenHash;

  await sendEmail({
    to: invite.email,
    kind: "INVITE",
    data: {
      acceptUrl: `${appUrl()}/invites/${urlToken}/accept`,
      workspaceName: invite.workspace.name,
      inviterName: invite.workspace.name,
    },
  });
}
