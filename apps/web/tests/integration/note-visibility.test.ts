import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@km/db";
import { resetDb, createUser, createWorkspaceFixture } from "../helpers/db";

vi.mock("../../src/lib/session", () => ({
  getCurrentUserId: vi.fn(),
  requireUserId: vi.fn(),
}));

import { requireUserId } from "../../src/lib/session";
import { POST as setVisibility } from "../../src/app/api/notes/[id]/visibility/route";

describe("POST /api/notes/[id]/visibility", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
  });

  it("owner flips WORKSPACE note to PRIVATE", async () => {
    const { user: owner } = await createUser();
    const { vault } = await createWorkspaceFixture(owner.id);
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
    vi.mocked(requireUserId).mockResolvedValue(owner.id);
    const res = await setVisibility(
      new Request("http://t", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibility: "PRIVATE" }),
      }),
      { params: { id: n.id } }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.note.visibility).toBe("PRIVATE");
  });

  it("400s on a personal-vault note", async () => {
    const { user, vault } = await createUser();
    const n = await prisma.note.create({
      data: {
        vaultId: vault.id,
        title: "t",
        slug: "t",
        content: "",
        visibility: "PRIVATE",
        createdById: user.id,
        updatedById: user.id,
      },
    });
    vi.mocked(requireUserId).mockResolvedValue(user.id);
    const res = await setVisibility(
      new Request("http://t", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibility: "WORKSPACE" }),
      }),
      { params: { id: n.id } }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toBe("personal_vault_is_always_private");
  });

  it("non-owner is forbidden", async () => {
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
    const res = await setVisibility(
      new Request("http://t", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibility: "PRIVATE" }),
      }),
      { params: { id: n.id } }
    );
    expect(res.status).toBe(403);
  });
});
