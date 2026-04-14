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

  const notes = [];
  for (const title of titles) {
    const slug = title.toLowerCase().replace(/\s+/g, "-");
    const note = await prisma.note.create({
      data: {
        vaultId: vault.id,
        title,
        slug,
        content: title,
        createdById: user.id,
        updatedById: user.id,
      },
    });
    notes.push(note);
  }

  return { vault, user, notes };
}

/**
 * Create a resolved Link between two notes.
 */
export async function linkNotes(sourceNoteId: string, targetNoteId: string) {
  const target = await prisma.note.findUniqueOrThrow({
    where: { id: targetNoteId },
    select: { title: true },
  });
  return prisma.link.create({
    data: {
      sourceNoteId,
      targetNoteId,
      targetTitle: target.title,
      resolved: true,
    },
  });
}

/**
 * Tag a note by name, creating the Tag row if needed.
 */
export async function tagNote(noteId: string, vaultId: string, tagName: string) {
  const tag = await prisma.tag.upsert({
    where: { vaultId_name: { vaultId, name: tagName } },
    create: { vaultId, name: tagName },
    update: {},
  });
  return prisma.noteTag.upsert({
    where: { noteId_tagId: { noteId, tagId: tag.id } },
    create: { noteId, tagId: tag.id },
    update: {},
  });
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
