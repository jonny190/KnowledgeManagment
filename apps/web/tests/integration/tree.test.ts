import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, createUser } from "../helpers/db";
import { prisma } from "@km/db";

vi.mock("../../src/lib/session", () => ({
  getCurrentUserId: vi.fn(),
  requireUserId: vi.fn(),
}));

import { requireUserId } from "../../src/lib/session";
import { GET as getTree } from "../../src/app/api/vaults/[id]/tree/route";

describe("GET /api/vaults/:id/tree", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
  });

  it("returns nested folder + note structure", async () => {
    const { user, vault, rootFolder } = await createUser();
    const projects = await prisma.folder.create({
      data: { vaultId: vault.id, parentId: rootFolder.id, name: "Projects", path: "Projects" },
    });
    await prisma.note.create({
      data: { vaultId: vault.id, folderId: projects.id, title: "Alpha", slug: "alpha", content: "", contentUpdatedAt: new Date(), createdById: user.id, updatedById: user.id },
    });
    await prisma.note.create({
      data: { vaultId: vault.id, folderId: rootFolder.id, title: "Inbox", slug: "inbox", content: "", contentUpdatedAt: new Date(), createdById: user.id, updatedById: user.id },
    });

    vi.mocked(requireUserId).mockResolvedValue(user.id);
    const res = await getTree(new Request(`http://t/api/vaults/${vault.id}/tree`), { params: { id: vault.id } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.root.id).toBe(rootFolder.id);
    expect(body.root.children.map((c: any) => c.name)).toEqual(["Projects"]);
    expect(body.root.notes.map((n: any) => n.title)).toEqual(["Inbox"]);
    expect(body.root.children[0].notes.map((n: any) => n.title)).toEqual(["Alpha"]);
  });

  it("returns 403 for non-members on workspace vault", async () => {
    const { user: other } = await createUser();
    const { user, vault } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(other.id);
    const res = await getTree(new Request(`http://t/api/vaults/${vault.id}/tree`), { params: { id: vault.id } });
    expect(res.status).toBe(403);
  });
});
