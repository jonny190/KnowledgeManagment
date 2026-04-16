import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@km/db";
import { resetDb, createUser, createWorkspaceFixture } from "../helpers/db";

vi.mock("../../src/lib/session", () => ({
  getCurrentUserId: vi.fn(),
  requireUserId: vi.fn(),
}));

import { requireUserId } from "../../src/lib/session";
import { GET as getTree } from "../../src/app/api/vaults/[id]/tree/route";

describe("GET /api/vaults/[id]/tree filters PRIVATE notes", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
  });

  it("hides PRIVATE notes the caller is not shared to", async () => {
    const { user: owner } = await createUser();
    const { workspace, vault, rootFolder } = await createWorkspaceFixture(owner.id);
    const { user: member } = await createUser();
    await prisma.membership.create({
      data: { workspaceId: workspace.id, userId: member.id, role: "MEMBER" },
    });
    const pub = await prisma.note.create({
      data: {
        vaultId: vault.id,
        folderId: rootFolder.id,
        title: "public",
        slug: "public",
        content: "",
        visibility: "WORKSPACE",
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    const priv = await prisma.note.create({
      data: {
        vaultId: vault.id,
        folderId: rootFolder.id,
        title: "private",
        slug: "private",
        content: "",
        visibility: "PRIVATE",
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    vi.mocked(requireUserId).mockResolvedValue(member.id);
    const res = await getTree(new Request("http://t"), { params: { id: vault.id } });
    const body = await res.json();
    const ids = body.notes.map((n: { id: string }) => n.id);
    expect(ids).toContain(pub.id);
    expect(ids).not.toContain(priv.id);
  });

  it("shows a PRIVATE note to the user it is shared with", async () => {
    const { user: owner } = await createUser();
    const { workspace, vault, rootFolder } = await createWorkspaceFixture(owner.id);
    const { user: member } = await createUser();
    await prisma.membership.create({
      data: { workspaceId: workspace.id, userId: member.id, role: "MEMBER" },
    });
    const priv = await prisma.note.create({
      data: {
        vaultId: vault.id,
        folderId: rootFolder.id,
        title: "priv",
        slug: "priv",
        content: "",
        visibility: "PRIVATE",
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    await prisma.noteShare.create({
      data: { noteId: priv.id, userId: member.id, role: "VIEW", createdBy: owner.id },
    });
    vi.mocked(requireUserId).mockResolvedValue(member.id);
    const res = await getTree(new Request("http://t"), { params: { id: vault.id } });
    const body = await res.json();
    const ids = body.notes.map((n: { id: string }) => n.id);
    expect(ids).toContain(priv.id);
  });
});
