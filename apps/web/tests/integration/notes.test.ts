import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, createUser, createWorkspaceFixture } from "../helpers/db";
import { prisma } from "@km/db";

vi.mock("../../src/lib/session", () => ({
  getCurrentUserId: vi.fn(),
  requireUserId: vi.fn(),
}));

import { requireUserId } from "../../src/lib/session";
import { POST as createNote } from "../../src/app/api/notes/route";

describe("POST /api/notes", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
  });

  it("creates a note in the personal vault with slug derived from title", async () => {
    const { user, vault, rootFolder } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(user.id);
    const res = await createNote(
      new Request("http://t/api/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vaultId: vault.id, folderId: rootFolder.id, title: "My First" }),
      })
    );
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.note.slug).toBe("my-first");
    expect(body.note.vaultId).toBe(vault.id);
    expect(body.note.createdById).toBe(user.id);
  });

  it("rejects non-member on workspace vault", async () => {
    const { user: owner } = await createUser();
    const { vault } = await createWorkspaceFixture(owner.id);
    const { user: stranger } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(stranger.id);
    const res = await createNote(
      new Request("http://t/api/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vaultId: vault.id, folderId: null, title: "X" }),
      })
    );
    expect(res.status).toBe(403);
  });
});

import { GET as getNote, PATCH as patchNote, DELETE as deleteNote } from "../../src/app/api/notes/[id]/route";

describe("/api/notes/:id", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
  });

  it("GET returns note for authorized user", async () => {
    const { user, vault } = await createUser();
    const n = await prisma.note.create({
      data: { vaultId: vault.id, title: "T", slug: "t", content: "hello", contentUpdatedAt: new Date(), createdById: user.id, updatedById: user.id },
    });
    vi.mocked(requireUserId).mockResolvedValue(user.id);
    const res = await getNote(new Request(`http://t/api/notes/${n.id}`), { params: { id: n.id } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.note.content).toBe("hello");
  });

  it("PATCH updates title and stamps updatedById; ignores content (owned by realtime)", async () => {
    const { user, vault } = await createUser();
    const n = await prisma.note.create({
      data: { vaultId: vault.id, title: "T", slug: "t", content: "a", contentUpdatedAt: new Date(), createdById: user.id, updatedById: user.id },
    });
    vi.mocked(requireUserId).mockResolvedValue(user.id);
    const res = await patchNote(
      new Request(`http://t/api/notes/${n.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "New Title", content: "b" }),
      }),
      { params: { id: n.id } }
    );
    expect(res.status).toBe(200);
    const refreshed = await prisma.note.findUniqueOrThrow({ where: { id: n.id } });
    expect(refreshed.title).toBe("New Title");
    expect(refreshed.content).toBe("a");
    expect(refreshed.updatedById).toBe(user.id);
  });

  it("DELETE removes note", async () => {
    const { user, vault } = await createUser();
    const n = await prisma.note.create({
      data: { vaultId: vault.id, title: "T", slug: "t", content: "", contentUpdatedAt: new Date(), createdById: user.id, updatedById: user.id },
    });
    vi.mocked(requireUserId).mockResolvedValue(user.id);
    const res = await deleteNote(new Request(`http://t/api/notes/${n.id}`, { method: "DELETE" }), { params: { id: n.id } });
    expect(res.status).toBe(204);
    expect(await prisma.note.findUnique({ where: { id: n.id } })).toBeNull();
  });

  it("GET returns 403 for unrelated user on workspace note", async () => {
    const { user: owner } = await createUser();
    const { vault } = await createWorkspaceFixture(owner.id);
    const n = await prisma.note.create({
      data: { vaultId: vault.id, title: "T", slug: "t", content: "", contentUpdatedAt: new Date(), createdById: owner.id, updatedById: owner.id },
    });
    const { user: stranger } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(stranger.id);
    const res = await getNote(new Request(`http://t/api/notes/${n.id}`), { params: { id: n.id } });
    expect(res.status).toBe(403);
  });
});
