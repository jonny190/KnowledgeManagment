import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@km/db";
import { resetDb, createUser, createWorkspaceFixture } from "../helpers/db";
import { assertCanAccessNote } from "../../src/lib/note-authz";
import { AuthzError } from "../../src/lib/authz";

async function makeNote(opts: {
  vaultId: string;
  createdById: string;
  visibility?: "WORKSPACE" | "PRIVATE";
  title?: string;
  folderId?: string | null;
}) {
  return prisma.note.create({
    data: {
      vaultId: opts.vaultId,
      folderId: opts.folderId ?? null,
      title: opts.title ?? "t",
      slug: `t-${Math.random().toString(36).slice(2, 8)}`,
      content: "",
      visibility: opts.visibility ?? "WORKSPACE",
      createdById: opts.createdById,
      updatedById: opts.createdById,
    },
  });
}

describe("assertCanAccessNote", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns OWNER when the caller is the note creator", async () => {
    const { user, vault, rootFolder } = await createUser();
    const n = await makeNote({
      vaultId: vault.id,
      createdById: user.id,
      folderId: rootFolder.id,
      visibility: "PRIVATE",
    });
    const res = await assertCanAccessNote(user.id, n.id, "OWNER");
    expect(res.effectiveRole).toBe("OWNER");
    expect(res.grantedBy.kind).toBe("note_owner");
  });

  it("returns OWNER for the personal-vault owner even if they are not the creator", async () => {
    const { user: owner, vault, rootFolder } = await createUser();
    const { user: other } = await createUser();
    const n = await makeNote({
      vaultId: vault.id,
      createdById: other.id,
      folderId: rootFolder.id,
    });
    const res = await assertCanAccessNote(owner.id, n.id, "OWNER");
    expect(res.grantedBy.kind).toBe("personal_owner");
  });

  it("returns VIEW from an explicit share", async () => {
    const { user: author } = await createUser();
    const { workspace, vault, rootFolder } = await createWorkspaceFixture(author.id);
    const { user: invitee } = await createUser();
    await prisma.membership.create({
      data: { workspaceId: workspace.id, userId: invitee.id, role: "MEMBER" },
    });
    const n = await makeNote({
      vaultId: vault.id,
      createdById: author.id,
      folderId: rootFolder.id,
      visibility: "PRIVATE",
    });
    await prisma.noteShare.create({
      data: { noteId: n.id, userId: invitee.id, role: "VIEW", createdBy: author.id },
    });
    const res = await assertCanAccessNote(invitee.id, n.id, "VIEW");
    expect(res.effectiveRole).toBe("VIEW");
    expect(res.grantedBy).toEqual({ kind: "share", role: "VIEW" });
  });

  it("rejects VIEW share asked for EDIT", async () => {
    const { user: author } = await createUser();
    const { workspace, vault, rootFolder } = await createWorkspaceFixture(author.id);
    const { user: invitee } = await createUser();
    await prisma.membership.create({
      data: { workspaceId: workspace.id, userId: invitee.id, role: "MEMBER" },
    });
    const n = await makeNote({
      vaultId: vault.id,
      createdById: author.id,
      folderId: rootFolder.id,
      visibility: "PRIVATE",
    });
    await prisma.noteShare.create({
      data: { noteId: n.id, userId: invitee.id, role: "VIEW", createdBy: author.id },
    });
    await expect(assertCanAccessNote(invitee.id, n.id, "EDIT")).rejects.toBeInstanceOf(AuthzError);
  });

  it("returns OWNER for a workspace OWNER on a WORKSPACE note", async () => {
    const { user: owner } = await createUser();
    const { vault, rootFolder } = await createWorkspaceFixture(owner.id);
    const { user: author } = await createUser();
    await prisma.membership.create({
      data: {
        workspaceId: (await prisma.vault.findUnique({ where: { id: vault.id } }))!.ownerId,
        userId: author.id,
        role: "MEMBER",
      },
    });
    const n = await makeNote({
      vaultId: vault.id,
      createdById: author.id,
      folderId: rootFolder.id,
    });
    const res = await assertCanAccessNote(owner.id, n.id, "OWNER");
    expect(res.effectiveRole).toBe("OWNER");
    expect(res.grantedBy).toEqual({ kind: "workspace", role: "OWNER" });
  });

  it("returns EDIT for a workspace MEMBER on a WORKSPACE note", async () => {
    const { user: owner } = await createUser();
    const { workspace, vault, rootFolder } = await createWorkspaceFixture(owner.id);
    const { user: member } = await createUser();
    await prisma.membership.create({
      data: { workspaceId: workspace.id, userId: member.id, role: "MEMBER" },
    });
    const n = await makeNote({
      vaultId: vault.id,
      createdById: owner.id,
      folderId: rootFolder.id,
    });
    const res = await assertCanAccessNote(member.id, n.id, "EDIT");
    expect(res.effectiveRole).toBe("EDIT");
    expect(res.grantedBy).toEqual({ kind: "workspace", role: "MEMBER" });
  });

  it("forbids a workspace MEMBER on a PRIVATE note they are not shared to", async () => {
    const { user: author } = await createUser();
    const { workspace, vault, rootFolder } = await createWorkspaceFixture(author.id);
    const { user: outsider } = await createUser();
    await prisma.membership.create({
      data: { workspaceId: workspace.id, userId: outsider.id, role: "MEMBER" },
    });
    const n = await makeNote({
      vaultId: vault.id,
      createdById: author.id,
      folderId: rootFolder.id,
      visibility: "PRIVATE",
    });
    await expect(assertCanAccessNote(outsider.id, n.id, "VIEW")).rejects.toBeInstanceOf(AuthzError);
  });

  it("throws 404 when the note does not exist", async () => {
    const { user } = await createUser();
    await expect(assertCanAccessNote(user.id, "cl_missing_xxxxxxxxxxxxxxxxxx", "VIEW")).rejects.toMatchObject({
      status: 404,
    });
  });
});
