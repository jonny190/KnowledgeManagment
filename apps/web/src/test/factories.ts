import { vi } from "vitest";
import { prisma } from "@km/db";
import { randomUUID } from "node:crypto";

/**
 * Create a vault owned by a new user, optionally seeding notes with the
 * given titles. The searchVector column is a GENERATED ALWAYS column so it
 * is populated automatically by Postgres when the row is inserted.
 */
export async function makeVaultWithNotes(titles: string[]) {
  const email = `user-${randomUUID()}@test.local`;
  const user = await prisma.user.create({ data: { email, name: "Test User" } });
  const vault = await prisma.vault.create({
    data: { ownerType: "USER", ownerId: user.id, name: "Personal" },
  });
  await prisma.folder.create({
    data: { vaultId: vault.id, parentId: null, name: "", path: "" },
  });

  for (const title of titles) {
    const slug = title.toLowerCase().replace(/\s+/g, "-");
    await prisma.note.create({
      data: {
        vaultId: vault.id,
        title,
        slug,
        content: title,
        createdById: user.id,
        updatedById: user.id,
      },
    });
  }

  return { vault, user };
}

/**
 * Mock the next-auth session so requireUserId() returns the given userId.
 * Pass null to simulate an unauthenticated request.
 */
export function mockSession(userId: string | null) {
  vi.doMock("next-auth", async () => {
    const actual = await vi.importActual<typeof import("next-auth")>("next-auth");
    return {
      ...actual,
      getServerSession: async () =>
        userId ? { user: { id: userId } } : null,
    };
  });
}
