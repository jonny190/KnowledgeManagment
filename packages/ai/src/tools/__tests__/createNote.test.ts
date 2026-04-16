import { describe, it, expect, vi } from "vitest";
import { createNote } from "../createNote";

function prismaMock() {
  const noteFindFirst = vi.fn().mockResolvedValue(null);
  const noteCreate = vi.fn(async ({ data }: { data: { vaultId: string; title: string; slug: string; content: string } }) => ({
    id: "note_123",
    ...data,
  }));
  const linkDeleteMany = vi.fn(async () => ({ count: 0 }));
  const linkCreateMany = vi.fn(async () => ({ count: 0 }));
  const noteTagDeleteMany = vi.fn(async () => ({ count: 0 }));
  const tagUpsert = vi.fn(async () => ({ id: "tag_1" }));
  const tagFindMany = vi.fn(async () => []);
  const noteTagCreateMany = vi.fn(async () => ({ count: 0 }));
  const diagramFindMany = vi.fn(async () => []);
  const noteFindMany = vi.fn(async () => []);
  const tx = {
    note: { findFirst: noteFindFirst, create: noteCreate, findMany: noteFindMany },
    link: { deleteMany: linkDeleteMany, createMany: linkCreateMany },
    noteTag: { deleteMany: noteTagDeleteMany, createMany: noteTagCreateMany },
    tag: { upsert: tagUpsert, findMany: tagFindMany },
    diagram: { findMany: diagramFindMany },
  };
  const $transaction = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx));
  return {
    prisma: {
      note: { findFirst: noteFindFirst },
      $transaction,
    },
    tx,
    noteCreate,
  };
}

describe("createNote tool", () => {
  it("rejects titles outside 1..200 chars", () => {
    expect(() => createNote.parse({ vaultId: "clvault", title: "" })).toThrow();
    expect(() => createNote.parse({ vaultId: "clvault", title: "x".repeat(201) })).toThrow();
  });

  it("generates a slug, creates the note, and returns an undo token", async () => {
    const mock = prismaMock();
    const ctx = {
      userId: "u1",
      vaultId: "clvault0000000000000000000",
      prisma: mock.prisma as unknown as import("@km/db").PrismaClient,
    };
    const args = createNote.parse({
      vaultId: "clvault0000000000000000000",
      title: "Meeting Notes",
      content: "hello [[Other]]",
    });
    const result = await createNote.execute(args, ctx);
    expect(result).toMatchObject({
      noteId: "note_123",
      title: "Meeting Notes",
      slug: "meeting-notes",
      undo: { kind: "create_note", id: "note_123" },
    });
    expect(mock.noteCreate).toHaveBeenCalled();
  });

  it("suffixes the slug when it already exists", async () => {
    const mock = prismaMock();
    mock.prisma.note.findFirst
      .mockResolvedValueOnce({ id: "x" })
      .mockResolvedValueOnce(null);
    const ctx = {
      userId: "u1",
      vaultId: "clvault0000000000000000000",
      prisma: mock.prisma as unknown as import("@km/db").PrismaClient,
    };
    const args = createNote.parse({
      vaultId: "clvault0000000000000000000",
      title: "Meeting Notes",
    });
    const result = await createNote.execute(args, ctx);
    expect(result).toMatchObject({ slug: "meeting-notes-2" });
  });
});
