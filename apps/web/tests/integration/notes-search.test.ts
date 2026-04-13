import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, createUser } from "../helpers/db";
import { prisma } from "@km/db";

vi.mock("../../src/lib/session", () => ({
  getCurrentUserId: vi.fn(),
  requireUserId: vi.fn(),
}));

import { requireUserId } from "../../src/lib/session";
import { GET as searchNotes } from "../../src/app/api/notes/search/route";

describe("GET /api/notes/search", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
  });

  it("returns notes whose titles match prefix (case-insensitive)", async () => {
    const { user, vault } = await createUser();
    await prisma.note.createMany({
      data: [
        { vaultId: vault.id, title: "Project Alpha", slug: "project-alpha", content: "", contentUpdatedAt: new Date(), createdById: user.id, updatedById: user.id },
        { vaultId: vault.id, title: "Project Beta", slug: "project-beta", content: "", contentUpdatedAt: new Date(), createdById: user.id, updatedById: user.id },
        { vaultId: vault.id, title: "Diary", slug: "diary", content: "", contentUpdatedAt: new Date(), createdById: user.id, updatedById: user.id },
      ],
    });
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    const res = await searchNotes(
      new Request(`http://t/api/notes/search?vaultId=${vault.id}&q=proj`)
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    const titles = body.results.map((r: any) => r.title).sort();
    expect(titles).toEqual(["Project Alpha", "Project Beta"]);
  });

  it("rejects caller without vault access", async () => {
    const { user, vault } = await createUser();
    const { user: stranger } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(stranger.id);
    const res = await searchNotes(
      new Request(`http://t/api/notes/search?vaultId=${vault.id}&q=a`)
    );
    expect(res.status).toBe(403);
  });
});
