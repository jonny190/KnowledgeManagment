import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@km/db";
import { resetDb, createUser, createWorkspaceFixture } from "../helpers/db";

vi.mock("../../src/lib/session", () => ({
  getCurrentUserId: vi.fn(),
  requireUserId: vi.fn(),
}));

import { requireUserId } from "../../src/lib/session";
import { GET, PATCH, DELETE } from "../../src/app/api/notes/[id]/route";

async function mkNote(vaultId: string, createdById: string, visibility: "WORKSPACE" | "PRIVATE") {
  return prisma.note.create({
    data: {
      vaultId,
      title: "t",
      slug: `t-${Math.random().toString(36).slice(2, 8)}`,
      content: "",
      visibility,
      createdById,
      updatedById: createdById,
    },
  });
}

describe("/api/notes/[id] authz switchover", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
  });

  it("GET: workspace member can read WORKSPACE note", async () => {
    const { user: owner } = await createUser();
    const { workspace, vault } = await createWorkspaceFixture(owner.id);
    const { user: member } = await createUser();
    await prisma.membership.create({
      data: { workspaceId: workspace.id, userId: member.id, role: "MEMBER" },
    });
    const n = await mkNote(vault.id, owner.id, "WORKSPACE");
    vi.mocked(requireUserId).mockResolvedValue(member.id);
    const res = await GET(new Request("http://t"), { params: { id: n.id } });
    expect(res.status).toBe(200);
  });

  it("GET: workspace member is forbidden on PRIVATE note they are not shared to", async () => {
    const { user: owner } = await createUser();
    const { workspace, vault } = await createWorkspaceFixture(owner.id);
    const { user: member } = await createUser();
    await prisma.membership.create({
      data: { workspaceId: workspace.id, userId: member.id, role: "MEMBER" },
    });
    const n = await mkNote(vault.id, owner.id, "PRIVATE");
    vi.mocked(requireUserId).mockResolvedValue(member.id);
    const res = await GET(new Request("http://t"), { params: { id: n.id } });
    expect(res.status).toBe(403);
  });

  it("PATCH: VIEW share is rejected with 403", async () => {
    const { user: owner } = await createUser();
    const { workspace, vault } = await createWorkspaceFixture(owner.id);
    const { user: member } = await createUser();
    await prisma.membership.create({
      data: { workspaceId: workspace.id, userId: member.id, role: "MEMBER" },
    });
    const n = await mkNote(vault.id, owner.id, "PRIVATE");
    await prisma.noteShare.create({
      data: { noteId: n.id, userId: member.id, role: "VIEW", createdBy: owner.id },
    });
    vi.mocked(requireUserId).mockResolvedValue(member.id);
    const res = await PATCH(
      new Request("http://t", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "new" }),
      }),
      { params: { id: n.id } }
    );
    expect(res.status).toBe(403);
  });

  it("DELETE: EDIT share is rejected with 403 (OWNER required)", async () => {
    const { user: owner } = await createUser();
    const { workspace, vault } = await createWorkspaceFixture(owner.id);
    const { user: member } = await createUser();
    await prisma.membership.create({
      data: { workspaceId: workspace.id, userId: member.id, role: "MEMBER" },
    });
    const n = await mkNote(vault.id, owner.id, "PRIVATE");
    await prisma.noteShare.create({
      data: { noteId: n.id, userId: member.id, role: "EDIT", createdBy: owner.id },
    });
    vi.mocked(requireUserId).mockResolvedValue(member.id);
    const res = await DELETE(new Request("http://t"), { params: { id: n.id } });
    expect(res.status).toBe(403);
  });

  it("DELETE: note creator succeeds with 204", async () => {
    const { user: owner } = await createUser();
    const { vault } = await createWorkspaceFixture(owner.id);
    const n = await mkNote(vault.id, owner.id, "WORKSPACE");
    vi.mocked(requireUserId).mockResolvedValue(owner.id);
    const res = await DELETE(new Request("http://t"), { params: { id: n.id } });
    expect(res.status).toBe(204);
  });
});
