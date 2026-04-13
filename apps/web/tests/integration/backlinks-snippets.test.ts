import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, createUser } from "../helpers/db";
import { prisma } from "@km/db";

vi.mock("../../src/lib/session", () => ({
  getCurrentUserId: vi.fn(),
  requireUserId: vi.fn(),
}));

import { requireUserId } from "../../src/lib/session";
import { PATCH } from "../../src/app/api/notes/[id]/route";
import { GET } from "../../src/app/api/notes/[id]/backlinks/route";

describe("GET /api/notes/:id/backlinks - snippets", () => {
  let userId: string;
  let vaultId: string;
  let targetId: string;
  let source1Id: string;
  let source2Id: string;

  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();

    const { user, vault } = await createUser();
    userId = user.id;
    vaultId = vault.id;

    vi.mocked(requireUserId).mockResolvedValue(userId);

    const target = await prisma.note.create({
      data: { vaultId, title: "Target", slug: "target", content: "", contentUpdatedAt: new Date(), createdById: userId, updatedById: userId },
    });
    const source1 = await prisma.note.create({
      data: { vaultId, title: "Src1", slug: "src1", content: "", contentUpdatedAt: new Date(), createdById: userId, updatedById: userId },
    });
    const source2 = await prisma.note.create({
      data: { vaultId, title: "Src2", slug: "src2", content: "", contentUpdatedAt: new Date(), createdById: userId, updatedById: userId },
    });

    targetId = target.id;
    source1Id = source1.id;
    source2Id = source2.id;

    async function patch(id: string, content: string) {
      return PATCH(
        new Request(`http://x/api/notes/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ content }),
          headers: { "Content-Type": "application/json" },
        }),
        { params: { id } },
      );
    }

    await patch(source1Id, `${"x".repeat(200)} see [[Target]] ${"y".repeat(200)}`);
    await patch(source2Id, `head before [[Target|alias]] rest`);
  });

  it("returns each source with a snippet", async () => {
    const res = await GET(new Request(`http://x/api/notes/${targetId}/backlinks`), { params: { id: targetId } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.backlinks).toHaveLength(2);
    const byTitle = Object.fromEntries(
      body.backlinks.map((b: { sourceTitle: string; snippet: string }) => [b.sourceTitle, b]),
    );
    expect(byTitle["Src1"].snippet).toContain("[[Target]]");
    expect(byTitle["Src1"].snippet.startsWith("...")).toBe(true);
    expect(byTitle["Src2"].snippet).toContain("[[Target|alias]]");
  });

  it("forbids callers without vault access", async () => {
    const { user: other } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(other.id);
    const res = await GET(new Request(`http://x/api/notes/${targetId}/backlinks`), { params: { id: targetId } });
    expect(res.status).toBe(403);
  });
});
