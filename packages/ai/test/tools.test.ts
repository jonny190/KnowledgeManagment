import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@km/db";
import { readNote, searchNotes, listBacklinks } from "../src/tools";

async function seed() {
  const user = await prisma.user.create({ data: { email: `u${Date.now()}@t.io` } });
  const vault = await prisma.vault.create({
    data: { ownerType: "USER", ownerId: user.id, name: "V" },
  });
  const otherVault = await prisma.vault.create({
    data: { ownerType: "USER", ownerId: user.id, name: "Other" },
  });
  const target = await prisma.note.create({
    data: {
      vaultId: vault.id,
      title: "Target",
      slug: "target",
      content: "body of target",
      createdById: user.id,
      updatedById: user.id,
    },
  });
  const source = await prisma.note.create({
    data: {
      vaultId: vault.id,
      title: "Source",
      slug: "source",
      content: "see [[Target]]",
      createdById: user.id,
      updatedById: user.id,
    },
  });
  await prisma.link.create({
    data: {
      sourceNoteId: source.id,
      targetNoteId: target.id,
      targetTitle: "Target",
      resolved: true,
    },
  });
  return { user, vault, otherVault, source, target };
}

describe("ai tools", () => {
  beforeEach(async () => {
    await prisma.link.deleteMany({});
    await prisma.note.deleteMany({});
    await prisma.aiConversation.deleteMany({});
    await prisma.aiUsage.deleteMany({});
    await prisma.vault.deleteMany({});
    await prisma.user.deleteMany({});
  });

  it("readNote returns the note body inside the vault", async () => {
    const { user, vault } = await seed();
    const result = await readNote.execute(
      readNote.parse({ title: "Target" }),
      { userId: user.id, vaultId: vault.id, prisma },
    );
    expect(result).toMatchObject({ title: "Target", content: "body of target" });
  });

  it("readNote returns not_found for unknown titles", async () => {
    const { user, vault } = await seed();
    const result = await readNote.execute(
      readNote.parse({ title: "Missing" }),
      { userId: user.id, vaultId: vault.id, prisma },
    );
    expect(result).toEqual({ error: "not_found" });
  });

  it("searchNotes returns a vault-scoped prefix match list", async () => {
    const { user, vault } = await seed();
    const result = await searchNotes.execute(
      searchNotes.parse({ query: "tar" }),
      { userId: user.id, vaultId: vault.id, prisma },
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ title: "Target" });
  });

  it("listBacklinks returns sources pointing at the note", async () => {
    const { user, vault, target } = await seed();
    const result = await listBacklinks.execute(
      listBacklinks.parse({ noteId: target.id }),
      { userId: user.id, vaultId: vault.id, prisma },
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ sourceTitle: "Source" });
  });

  it("listBacklinks rejects a noteId in a different vault", async () => {
    const { user, otherVault, target } = await seed();
    await expect(
      listBacklinks.execute(
        listBacklinks.parse({ noteId: target.id }),
        { userId: user.id, vaultId: otherVault.id, prisma },
      ),
    ).rejects.toThrow();
  });
});
