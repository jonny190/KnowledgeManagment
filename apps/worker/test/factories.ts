import { prisma } from "@km/db";
import { randomUUID, randomBytes, createHash } from "node:crypto";

export async function createUser(overrides: { email?: string; name?: string } = {}) {
  const email = overrides.email ?? `user-${randomUUID()}@test.local`;
  return prisma.user.create({
    data: { email, name: overrides.name ?? "Test User" },
  });
}

export async function createWorkspace(ownerId: string, name = "Test Workspace") {
  const slug = `ws-${randomUUID()}`;
  return prisma.workspace.create({
    data: { name, slug, ownerId },
  });
}

export async function createInvite(opts: { email: string; workspaceId: string }) {
  const token = randomBytes(24).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return prisma.invite.create({
    data: {
      workspaceId: opts.workspaceId,
      email: opts.email,
      token,
      tokenHash,
      role: "MEMBER",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
}
