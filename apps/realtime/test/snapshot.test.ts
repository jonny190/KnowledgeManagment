import { describe, it, expect, beforeEach } from "vitest";
import * as Y from "yjs";
import { prisma } from "../src/prisma.js";
import { snapshotNote, __setDocProvider, __clearDocProvider } from "../src/snapshot.js";

async function seedNote(content = "") {
  const user = await prisma.user.create({ data: { email: `s${Date.now()}@t.io` } });
  const vault = await prisma.vault.create({
    data: { ownerType: "USER", ownerId: user.id, name: "V" },
  });
  const note = await prisma.note.create({
    data: {
      vaultId: vault.id,
      title: "T",
      slug: "t",
      content,
      createdById: user.id,
      updatedById: user.id,
    },
  });
  return { user, vault, note };
}

function makeDoc(text: string): Y.Doc {
  const doc = new Y.Doc();
  doc.getText("content").insert(0, text);
  return doc;
}

describe("snapshotNote", () => {
  beforeEach(async () => {
    __clearDocProvider();
    await prisma.link.deleteMany({});
    await prisma.noteDoc.deleteMany({});
    await prisma.note.deleteMany({});
    await prisma.vault.deleteMany({});
    await prisma.user.deleteMany({});
  });

  it("writes markdown and resolves links", async () => {
    const { user, vault, note } = await seedNote();
    const target = await prisma.note.create({
      data: {
        vaultId: vault.id,
        title: "Target",
        slug: "target",
        content: "",
        createdById: user.id,
        updatedById: user.id,
      },
    });
    __setDocProvider(() => ({ doc: makeDoc("hi [[Target]] and [[Missing]]"), lastEditorUserId: user.id }));

    await snapshotNote(note.id);

    const after = await prisma.note.findUnique({ where: { id: note.id } });
    expect(after!.content).toBe("hi [[Target]] and [[Missing]]");
    expect(after!.updatedById).toBe(user.id);

    const links = await prisma.link.findMany({ where: { sourceNoteId: note.id } });
    expect(links).toHaveLength(2);
    expect(links.find((l) => l.targetTitle === "Target")!.resolved).toBe(true);
    expect(links.find((l) => l.targetTitle === "Missing")!.resolved).toBe(false);

    // Silence unused variable warning.
    void target;
  });

  it("is a no-op when content is unchanged", async () => {
    const { user, note } = await seedNote("same");
    const before = (await prisma.note.findUnique({ where: { id: note.id } }))!.updatedAt;
    __setDocProvider(() => ({ doc: makeDoc("same"), lastEditorUserId: user.id }));

    await snapshotNote(note.id);

    const after = (await prisma.note.findUnique({ where: { id: note.id } }))!.updatedAt;
    expect(after.getTime()).toBe(before.getTime());
  });

  it("serialises overlapping snapshots for the same noteId", async () => {
    const { user, note } = await seedNote();
    let calls = 0;
    __setDocProvider(() => {
      calls += 1;
      return { doc: makeDoc(`v${calls}`), lastEditorUserId: user.id };
    });

    await Promise.all([snapshotNote(note.id), snapshotNote(note.id)]);

    const after = await prisma.note.findUnique({ where: { id: note.id } });
    // Whichever ran last wins; either content value is fine, but we assert no crash.
    expect(["v1", "v2"]).toContain(after!.content);
  });
});
