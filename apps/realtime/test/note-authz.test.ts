import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/prisma.js";
import { assertCanAccessNoteForRealtime } from "../src/note-authz.js";

async function cleanDb() {
  await prisma.noteShare.deleteMany();
  await prisma.note.deleteMany();
  await prisma.folder.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.vault.deleteMany();
  await prisma.user.deleteMany();
}

describe("assertCanAccessNoteForRealtime", () => {
  beforeEach(cleanDb);

  it("grants EDIT to a workspace MEMBER on a WORKSPACE note", async () => {
    const owner = await prisma.user.create({ data: { email: "o@t" } });
    const member = await prisma.user.create({ data: { email: "m@t" } });
    const ws = await prisma.workspace.create({
      data: { name: "w", slug: "w", ownerId: owner.id },
    });
    await prisma.membership.create({ data: { workspaceId: ws.id, userId: owner.id, role: "OWNER" } });
    await prisma.membership.create({ data: { workspaceId: ws.id, userId: member.id, role: "MEMBER" } });
    const vault = await prisma.vault.create({
      data: { ownerType: "WORKSPACE", ownerId: ws.id, name: "w" },
    });
    const note = await prisma.note.create({
      data: {
        vaultId: vault.id,
        title: "t",
        slug: "t",
        content: "",
        visibility: "WORKSPACE",
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    const res = await assertCanAccessNoteForRealtime(member.id, note.id, "EDIT");
    expect(res.effectiveRole).toBe("EDIT");
  });

  it("rejects VIEW-only share when EDIT is required", async () => {
    const owner = await prisma.user.create({ data: { email: "o2@t" } });
    const member = await prisma.user.create({ data: { email: "m2@t" } });
    const ws = await prisma.workspace.create({
      data: { name: "w2", slug: "w2", ownerId: owner.id },
    });
    await prisma.membership.create({ data: { workspaceId: ws.id, userId: owner.id, role: "OWNER" } });
    await prisma.membership.create({ data: { workspaceId: ws.id, userId: member.id, role: "MEMBER" } });
    const vault = await prisma.vault.create({
      data: { ownerType: "WORKSPACE", ownerId: ws.id, name: "w2" },
    });
    const note = await prisma.note.create({
      data: {
        vaultId: vault.id,
        title: "priv",
        slug: "priv",
        content: "",
        visibility: "PRIVATE",
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    await prisma.noteShare.create({
      data: { noteId: note.id, userId: member.id, role: "VIEW", createdBy: owner.id },
    });
    await expect(assertCanAccessNoteForRealtime(member.id, note.id, "EDIT")).rejects.toThrow();
  });
});
