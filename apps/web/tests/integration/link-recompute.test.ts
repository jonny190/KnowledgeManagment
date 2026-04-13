import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, createUser } from "../helpers/db";
import { prisma } from "@km/db";

vi.mock("../../src/lib/session", () => ({
  getCurrentUserId: vi.fn(),
  requireUserId: vi.fn(),
}));

import { requireUserId } from "../../src/lib/session";
import { PATCH } from "../../src/app/api/notes/[id]/route";

describe("PATCH /api/notes/:id link recomputation", () => {
  let userId: string;
  let vaultId: string;
  let noteAId: string;
  let noteBId: string;
  let noteCId: string;

  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();

    const { user, vault } = await createUser();
    userId = user.id;
    vaultId = vault.id;

    vi.mocked(requireUserId).mockResolvedValue(userId);

    const noteA = await prisma.note.create({
      data: { vaultId, title: "Alpha", slug: "alpha", content: "", contentUpdatedAt: new Date(), createdById: userId, updatedById: userId },
    });
    const noteB = await prisma.note.create({
      data: { vaultId, title: "Beta", slug: "beta", content: "", contentUpdatedAt: new Date(), createdById: userId, updatedById: userId },
    });
    const noteC = await prisma.note.create({
      data: { vaultId, title: "Source", slug: "source", content: "", contentUpdatedAt: new Date(), createdById: userId, updatedById: userId },
    });

    noteAId = noteA.id;
    noteBId = noteB.id;
    noteCId = noteC.id;
  });

  async function patch(id: string, body: unknown) {
    return PATCH(
      new Request(`http://x/api/notes/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      }),
      { params: { id } },
    );
  }

  it("creates resolved link rows for known targets", async () => {
    const res = await patch(noteCId, { content: "see [[Alpha]] and [[Beta]]" });
    expect(res.status).toBe(200);
    const links = await prisma.link.findMany({ where: { sourceNoteId: noteCId } });
    expect(links).toHaveLength(2);
    const titles = links.map((l) => l.targetTitle).sort();
    expect(titles).toEqual(["Alpha", "Beta"]);
    for (const l of links) {
      expect(l.resolved).toBe(true);
      expect(l.targetNoteId).not.toBeNull();
    }
  });

  it("marks unknown targets as unresolved", async () => {
    await patch(noteCId, { content: "see [[Ghost]]" });
    const links = await prisma.link.findMany({ where: { sourceNoteId: noteCId } });
    expect(links).toHaveLength(1);
    expect(links[0].resolved).toBe(false);
    expect(links[0].targetNoteId).toBeNull();
  });

  it("replaces the link set atomically across saves", async () => {
    await patch(noteCId, { content: "[[Alpha]]" });
    const first = await prisma.link.findMany({ where: { sourceNoteId: noteCId } });
    expect(first.map((l) => l.targetTitle)).toEqual(["Alpha"]);
    await patch(noteCId, { content: "[[Beta]]" });
    const second = await prisma.link.findMany({ where: { sourceNoteId: noteCId } });
    expect(second.map((l) => l.targetTitle)).toEqual(["Beta"]);
  });

  it("leaves no link rows when content has no wiki-links", async () => {
    await patch(noteCId, { content: "plain text only" });
    const rows = await prisma.link.findMany({ where: { sourceNoteId: noteCId } });
    expect(rows).toEqual([]);
  });

  it("never writes content without writing links in the same transaction", async () => {
    await prisma.link.deleteMany({ where: { sourceNoteId: noteCId } });
    await patch(noteCId, { content: "[[Alpha]] body" });
    const note = await prisma.note.findUnique({ where: { id: noteCId } });
    const links = await prisma.link.findMany({ where: { sourceNoteId: noteCId } });
    expect(note?.content).toBe("[[Alpha]] body");
    expect(links.map((l) => l.targetTitle)).toEqual(["Alpha"]);
  });
});
