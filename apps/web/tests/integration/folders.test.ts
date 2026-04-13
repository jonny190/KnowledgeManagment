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

import { PATCH as patchFolder, DELETE as deleteFolder } from "../../src/app/api/folders/[id]/route";

describe("PATCH /api/folders/:id", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
  });

  it("rename updates own path and descendant paths", async () => {
    const { user, vault } = await createUser();
    const a = await prisma.folder.create({ data: { vaultId: vault.id, name: "A", path: "A" } });
    const b = await prisma.folder.create({ data: { vaultId: vault.id, parentId: a.id, name: "B", path: "A/B" } });
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    const res = await patchFolder(
      new Request(`http://t/api/folders/${a.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "AA" }),
      }),
      { params: { id: a.id } }
    );
    expect(res.status).toBe(200);
    const refreshedB = await prisma.folder.findUniqueOrThrow({ where: { id: b.id } });
    expect(refreshedB.path).toBe("AA/B");
  });

  it("move updates parentId and path", async () => {
    const { user, vault } = await createUser();
    const a = await prisma.folder.create({ data: { vaultId: vault.id, name: "A", path: "A" } });
    const b = await prisma.folder.create({ data: { vaultId: vault.id, name: "B", path: "B" } });
    const c = await prisma.folder.create({ data: { vaultId: vault.id, parentId: a.id, name: "C", path: "A/C" } });
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    const res = await patchFolder(
      new Request(`http://t/api/folders/${c.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parentId: b.id }),
      }),
      { params: { id: c.id } }
    );
    expect(res.status).toBe(200);
    const refreshed = await prisma.folder.findUniqueOrThrow({ where: { id: c.id } });
    expect(refreshed.parentId).toBe(b.id);
    expect(refreshed.path).toBe("B/C");
  });
});

describe("DELETE /api/folders/:id", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
  });

  it("deletes folder and cascades via Prisma", async () => {
    const { user, vault } = await createUser();
    const f = await prisma.folder.create({ data: { vaultId: vault.id, name: "X", path: "X" } });
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    const res = await deleteFolder(
      new Request(`http://t/api/folders/${f.id}`, { method: "DELETE" }),
      { params: { id: f.id } }
    );
    expect(res.status).toBe(204);
    expect(await prisma.folder.findUnique({ where: { id: f.id } })).toBeNull();
  });
});
