import { prisma } from "@km/db";
import { randomUUID } from "node:crypto";

export async function resetDb() {
  await prisma.$transaction([
    prisma.link.deleteMany(),
    prisma.attachment.deleteMany(),
    prisma.note.deleteMany(),
    prisma.folder.deleteMany(),
    prisma.vault.deleteMany(),
    prisma.invite.deleteMany(),
    prisma.membership.deleteMany(),
    prisma.workspace.deleteMany(),
    prisma.session.deleteMany(),
    prisma.account.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

export async function createUser(overrides: { email?: string; name?: string } = {}) {
  const email = overrides.email ?? `user-${randomUUID()}@test.local`;
  const user = await prisma.user.create({
    data: { email, name: overrides.name ?? "Test User" },
  });
  const vault = await prisma.vault.create({
    data: { ownerType: "USER", ownerId: user.id, name: "Personal" },
  });
  const root = await prisma.folder.create({
    data: { vaultId: vault.id, parentId: null, name: "", path: "" },
  });
  return { user, vault, rootFolder: root };
}

export async function createWorkspaceFixture(ownerId: string, name = "Acme") {
  const ws = await prisma.workspace.create({
    data: { name, slug: name.toLowerCase(), ownerId },
  });
  await prisma.membership.create({
    data: { workspaceId: ws.id, userId: ownerId, role: "OWNER" },
  });
  const vault = await prisma.vault.create({
    data: { ownerType: "WORKSPACE", ownerId: ws.id, name },
  });
  const root = await prisma.folder.create({
    data: { vaultId: vault.id, parentId: null, name: "", path: "" },
  });
  return { workspace: ws, vault, rootFolder: root };
}
