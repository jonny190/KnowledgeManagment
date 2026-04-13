import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, createUser, createWorkspaceFixture } from "../helpers/db";
import { prisma } from "@km/db";

vi.mock("../../src/lib/session", () => ({
  getCurrentUserId: vi.fn(),
  requireUserId: vi.fn(),
}));

import { requireUserId } from "../../src/lib/session";
import { POST as createFolder } from "../../src/app/api/folders/route";

describe("POST /api/folders", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
  });

  it("creates top-level folder with path equal to name", async () => {
    const { user, vault, rootFolder } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    const res = await createFolder(
      new Request("http://t/api/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vaultId: vault.id, parentId: rootFolder.id, name: "Projects" }),
      })
    );
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.folder.path).toBe("Projects");
    expect(body.folder.parentId).toBe(rootFolder.id);
  });

  it("creates nested folder with composed path", async () => {
    const { user, vault, rootFolder } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    const projects = await prisma.folder.create({
      data: { vaultId: vault.id, parentId: rootFolder.id, name: "Projects", path: "Projects" },
    });
    const res = await createFolder(
      new Request("http://t/api/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vaultId: vault.id, parentId: projects.id, name: "Acme" }),
      })
    );
    const body = await res.json();
    expect(body.folder.path).toBe("Projects/Acme");
  });

  it("rejects non-members with 403", async () => {
    const { user: owner } = await createUser();
    const { vault } = await createWorkspaceFixture(owner.id);
    const { user: stranger } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(stranger.id);

    const res = await createFolder(
      new Request("http://t/api/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vaultId: vault.id, parentId: null, name: "X" }),
      })
    );
    expect(res.status).toBe(403);
  });
});
