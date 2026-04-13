import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, createUser } from "../helpers/db";
import { prisma } from "@km/db";

vi.mock("../../src/lib/session", () => ({
  getCurrentUserId: vi.fn(),
  requireUserId: vi.fn(),
}));

import { requireUserId } from "../../src/lib/session";
import { PATCH } from "../../src/app/api/notes/[id]/route";

describe("PATCH /api/notes/:id (Phase 2: content owned by realtime)", () => {
  let userId: string;
  let vaultId: string;
  let noteCId: string;

  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();

    const { user, vault } = await createUser();
    userId = user.id;
    vaultId = vault.id;

    vi.mocked(requireUserId).mockResolvedValue(userId);

    const noteC = await prisma.note.create({
      data: { vaultId, title: "Source", slug: "source", content: "original", contentUpdatedAt: new Date(), createdById: userId, updatedById: userId },
    });

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

  it("ignores content in the body and keeps the existing content", async () => {
    const res = await patch(noteCId, { title: "New Title", content: "SHOULD BE IGNORED" });
    expect(res.status).toBe(200);
    const after = await prisma.note.findUnique({ where: { id: noteCId } });
    expect(after!.title).toBe("New Title");
    expect(after!.content).toBe("original");
  });

  it("updates title without touching content or links", async () => {
    await patch(noteCId, { title: "Updated" });
    const after = await prisma.note.findUnique({ where: { id: noteCId } });
    expect(after!.title).toBe("Updated");
    expect(after!.content).toBe("original");
    const links = await prisma.link.findMany({ where: { sourceNoteId: noteCId } });
    expect(links).toHaveLength(0);
  });

  it("does not create link rows even when content with wiki-links is sent", async () => {
    await patch(noteCId, { content: "see [[Alpha]] and [[Beta]]" });
    const links = await prisma.link.findMany({ where: { sourceNoteId: noteCId } });
    expect(links).toHaveLength(0);
  });
});
