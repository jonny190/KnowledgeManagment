import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, createUser } from "../helpers/db";
import { prisma } from "@km/db";

vi.mock("../../src/lib/session", () => ({
  getCurrentUserId: vi.fn(),
  requireUserId: vi.fn(),
}));

import { requireUserId } from "../../src/lib/session";
import { GET as getBacklinks } from "../../src/app/api/notes/[id]/backlinks/route";

describe("GET /api/notes/:id/backlinks", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
  });

  it("returns resolved Link rows pointing to the note with source titles", async () => {
    const { user, vault } = await createUser();
    const target = await prisma.note.create({
      data: { vaultId: vault.id, title: "Target", slug: "target", content: "", contentUpdatedAt: new Date(), createdById: user.id, updatedById: user.id },
    });
    const source = await prisma.note.create({
      data: { vaultId: vault.id, title: "Source", slug: "source", content: "[[Target]]", contentUpdatedAt: new Date(), createdById: user.id, updatedById: user.id },
    });
    await prisma.link.create({
      data: { sourceNoteId: source.id, targetNoteId: target.id, targetTitle: "Target", resolved: true },
    });
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    const res = await getBacklinks(new Request(`http://t/api/notes/${target.id}/backlinks`), { params: { id: target.id } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.backlinks).toHaveLength(1);
    expect(body.backlinks[0].sourceNote.id).toBe(source.id);
    expect(body.backlinks[0].sourceNote.title).toBe("Source");
  });

  it("returns empty list when no links exist", async () => {
    const { user, vault } = await createUser();
    const n = await prisma.note.create({
      data: { vaultId: vault.id, title: "Lonely", slug: "lonely", content: "", contentUpdatedAt: new Date(), createdById: user.id, updatedById: user.id },
    });
    vi.mocked(requireUserId).mockResolvedValue(user.id);
    const res = await getBacklinks(new Request(`http://t/api/notes/${n.id}/backlinks`), { params: { id: n.id } });
    const body = await res.json();
    expect(body.backlinks).toEqual([]);
  });
});
