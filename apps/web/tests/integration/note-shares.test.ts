import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@km/db";
import { resetDb, createUser, createWorkspaceFixture } from "../helpers/db";

vi.mock("../../src/lib/session", () => ({
  getCurrentUserId: vi.fn(),
  requireUserId: vi.fn(),
}));

import { requireUserId } from "../../src/lib/session";
import { GET as listShares, POST as createShare } from "../../src/app/api/notes/[id]/shares/route";

async function mkNote(vaultId: string, createdById: string) {
  return prisma.note.create({
    data: {
      vaultId,
      title: "t",
      slug: `t-${Math.random().toString(36).slice(2, 8)}`,
      content: "",
      visibility: "PRIVATE",
      createdById,
      updatedById: createdById,
    },
  });
}

describe("/api/notes/[id]/shares", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
  });

  it("owner lists empty shares", async () => {
    const { user: owner } = await createUser();
    const { vault } = await createWorkspaceFixture(owner.id);
    const n = await mkNote(vault.id, owner.id);
    vi.mocked(requireUserId).mockResolvedValue(owner.id);
    const res = await listShares(new Request("http://t"), { params: { id: n.id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.shares).toEqual([]);
    expect(body.links).toEqual([]);
  });

  it("owner shares with existing user by email", async () => {
    const { user: owner } = await createUser();
    const { vault } = await createWorkspaceFixture(owner.id);
    const { user: invitee } = await createUser({ email: "x@t.local" });
    const n = await mkNote(vault.id, owner.id);
    vi.mocked(requireUserId).mockResolvedValue(owner.id);
    const res = await createShare(
      new Request("http://t", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "x@t.local", role: "EDIT" }),
      }),
      { params: { id: n.id } }
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.share.userId).toBe(invitee.id);
    expect(body.share.role).toBe("EDIT");
  });

  it("returns 404 user_not_found for unknown email", async () => {
    const { user: owner } = await createUser();
    const { vault } = await createWorkspaceFixture(owner.id);
    const n = await mkNote(vault.id, owner.id);
    vi.mocked(requireUserId).mockResolvedValue(owner.id);
    const res = await createShare(
      new Request("http://t", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "ghost@t.local", role: "VIEW" }),
      }),
      { params: { id: n.id } }
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.reason).toBe("user_not_found");
  });

  it("non-owner cannot list or share", async () => {
    const { user: owner } = await createUser();
    const { workspace, vault } = await createWorkspaceFixture(owner.id);
    const { user: member } = await createUser();
    await prisma.membership.create({
      data: { workspaceId: workspace.id, userId: member.id, role: "MEMBER" },
    });
    const n = await mkNote(vault.id, owner.id);
    vi.mocked(requireUserId).mockResolvedValue(member.id);
    const res = await listShares(new Request("http://t"), { params: { id: n.id } });
    expect(res.status).toBe(403);
  });

  it("re-sharing upserts the role", async () => {
    const { user: owner } = await createUser();
    const { vault } = await createWorkspaceFixture(owner.id);
    const { user: invitee } = await createUser({ email: "u@t.local" });
    const n = await mkNote(vault.id, owner.id);
    vi.mocked(requireUserId).mockResolvedValue(owner.id);
    await createShare(
      new Request("http://t", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "u@t.local", role: "VIEW" }),
      }),
      { params: { id: n.id } }
    );
    const res = await createShare(
      new Request("http://t", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "u@t.local", role: "EDIT" }),
      }),
      { params: { id: n.id } }
    );
    expect(res.status).toBe(200);
    const rows = await prisma.noteShare.findMany({ where: { noteId: n.id, userId: invitee.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("EDIT");
  });

  it("PATCH flips role, DELETE removes share", async () => {
    const { user: owner } = await createUser();
    const { vault } = await createWorkspaceFixture(owner.id);
    const { user: invitee } = await createUser({ email: "y@t.local" });
    const n = await mkNote(vault.id, owner.id);
    await prisma.noteShare.create({
      data: { noteId: n.id, userId: invitee.id, role: "VIEW", createdBy: owner.id },
    });
    vi.mocked(requireUserId).mockResolvedValue(owner.id);

    const { PATCH, DELETE } = await import(
      "../../src/app/api/notes/[id]/shares/[userId]/route"
    );

    const resP = await PATCH(
      new Request("http://t", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "EDIT" }),
      }),
      { params: { id: n.id, userId: invitee.id } }
    );
    expect(resP.status).toBe(200);
    const after = await prisma.noteShare.findUnique({
      where: { noteId_userId: { noteId: n.id, userId: invitee.id } },
    });
    expect(after?.role).toBe("EDIT");

    const resD = await DELETE(new Request("http://t"), {
      params: { id: n.id, userId: invitee.id },
    });
    expect(resD.status).toBe(204);
    const gone = await prisma.noteShare.findUnique({
      where: { noteId_userId: { noteId: n.id, userId: invitee.id } },
    });
    expect(gone).toBeNull();
  });
});
