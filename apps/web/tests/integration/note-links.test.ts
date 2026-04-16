import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@km/db";
import { resetDb, createUser, createWorkspaceFixture } from "../helpers/db";

vi.mock("../../src/lib/session", () => ({
  getCurrentUserId: vi.fn(),
  requireUserId: vi.fn(),
}));

import { requireUserId } from "../../src/lib/session";
import { POST as createLink } from "../../src/app/api/notes/[id]/links/route";
import { DELETE as revokeLink } from "../../src/app/api/notes/[id]/links/[linkId]/route";

describe("note public links", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
  });

  it("owner creates a link with a 21-char slug", async () => {
    const { user: owner } = await createUser();
    const { vault } = await createWorkspaceFixture(owner.id);
    const n = await prisma.note.create({
      data: {
        vaultId: vault.id,
        title: "t",
        slug: "t",
        content: "hello",
        visibility: "PRIVATE",
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    vi.mocked(requireUserId).mockResolvedValue(owner.id);
    const res = await createLink(
      new Request("http://t", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: { id: n.id } }
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.link.slug).toMatch(/^[A-Za-z0-9_-]{21}$/);
    expect(body.link.revokedAt).toBeNull();
  });

  it("owner revokes a link, row is marked revoked", async () => {
    const { user: owner } = await createUser();
    const { vault } = await createWorkspaceFixture(owner.id);
    const n = await prisma.note.create({
      data: {
        vaultId: vault.id,
        title: "t",
        slug: "t",
        content: "",
        visibility: "PRIVATE",
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    const link = await prisma.noteLink.create({
      data: { noteId: n.id, slug: "abcdefghij0123456789x", createdBy: owner.id },
    });
    vi.mocked(requireUserId).mockResolvedValue(owner.id);
    const res = await revokeLink(new Request("http://t"), {
      params: { id: n.id, linkId: link.id },
    });
    expect(res.status).toBe(204);
    const after = await prisma.noteLink.findUnique({ where: { id: link.id } });
    expect(after?.revokedAt).toBeInstanceOf(Date);
  });

  it("non-owner cannot create or revoke", async () => {
    const { user: owner } = await createUser();
    const { workspace, vault } = await createWorkspaceFixture(owner.id);
    const { user: member } = await createUser();
    await prisma.membership.create({
      data: { workspaceId: workspace.id, userId: member.id, role: "MEMBER" },
    });
    const n = await prisma.note.create({
      data: {
        vaultId: vault.id,
        title: "t",
        slug: "t",
        content: "",
        visibility: "WORKSPACE",
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    vi.mocked(requireUserId).mockResolvedValue(member.id);
    const res = await createLink(
      new Request("http://t", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: { id: n.id } }
    );
    expect(res.status).toBe(403);
  });

  it("GET /api/public/n/[slug] returns 200 with html", async () => {
    const { user: owner } = await createUser();
    const { vault } = await createWorkspaceFixture(owner.id);
    const n = await prisma.note.create({
      data: {
        vaultId: vault.id,
        title: "Hello",
        slug: "hello",
        content: "# Hi\n\nBody",
        visibility: "PRIVATE",
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    await prisma.noteLink.create({
      data: { noteId: n.id, slug: "pubslug00000000000abcd", createdBy: owner.id },
    });
    const { GET } = await import("../../src/app/api/public/n/[slug]/route");
    const res = await GET(new Request("http://t"), { params: { slug: "pubslug00000000000abcd" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.note.title).toBe("Hello");
    expect(body.note.html).toContain("<h1>");
  });

  it("GET /api/public/n/[slug] returns 404 when revoked", async () => {
    const { user: owner } = await createUser();
    const { vault } = await createWorkspaceFixture(owner.id);
    const n = await prisma.note.create({
      data: {
        vaultId: vault.id,
        title: "X",
        slug: "x",
        content: "body",
        visibility: "PRIVATE",
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    await prisma.noteLink.create({
      data: {
        noteId: n.id,
        slug: "revokedslug00000000001",
        createdBy: owner.id,
        revokedAt: new Date(),
      },
    });
    const { GET } = await import("../../src/app/api/public/n/[slug]/route");
    const res = await GET(new Request("http://t"), { params: { slug: "revokedslug00000000001" } });
    expect(res.status).toBe(404);
  });

  it("GET /api/public/n/[slug] returns 410 when expired", async () => {
    const { user: owner } = await createUser();
    const { vault } = await createWorkspaceFixture(owner.id);
    const n = await prisma.note.create({
      data: {
        vaultId: vault.id,
        title: "X",
        slug: "xe",
        content: "body",
        visibility: "PRIVATE",
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    await prisma.noteLink.create({
      data: {
        noteId: n.id,
        slug: "expiredslug00000000002",
        createdBy: owner.id,
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const { GET } = await import("../../src/app/api/public/n/[slug]/route");
    const res = await GET(new Request("http://t"), { params: { slug: "expiredslug00000000002" } });
    expect(res.status).toBe(410);
  });
});
