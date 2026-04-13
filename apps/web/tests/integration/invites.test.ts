import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, createUser, createWorkspaceFixture } from "../helpers/db";
import { prisma } from "@km/db";

vi.mock("@/lib/session", () => ({
  getCurrentUserId: vi.fn(),
  requireUserId: vi.fn(),
}));

const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

import { requireUserId } from "@/lib/session";
import { POST as createInvite } from "@/app/api/workspaces/[id]/invites/route";

describe("POST /api/workspaces/:id/invites", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
    logSpy.mockClear();
  });

  it("OWNER can invite; token is generated and email is logged", async () => {
    const { user: owner } = await createUser();
    const { workspace } = await createWorkspaceFixture(owner.id);
    vi.mocked(requireUserId).mockResolvedValue(owner.id);

    const res = await createInvite(
      new Request(`http://t/api/workspaces/${workspace.id}/invites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "friend@test.local", role: "MEMBER" }),
      }),
      { params: { id: workspace.id } }
    );
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.invite.email).toBe("friend@test.local");
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThanOrEqual(32);

    const rows = await prisma.invite.findMany({ where: { workspaceId: workspace.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(body.token);

    expect(logSpy).toHaveBeenCalled();
    const logged = logSpy.mock.calls.flat().join(" ");
    expect(logged).toContain("friend@test.local");
  });

  it("MEMBER cannot invite (403)", async () => {
    const { user: owner } = await createUser();
    const { workspace } = await createWorkspaceFixture(owner.id);
    const { user: member } = await createUser();
    await prisma.membership.create({
      data: { workspaceId: workspace.id, userId: member.id, role: "MEMBER" },
    });
    vi.mocked(requireUserId).mockResolvedValue(member.id);

    const res = await createInvite(
      new Request(`http://t/api/workspaces/${workspace.id}/invites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "x@test.local", role: "MEMBER" }),
      }),
      { params: { id: workspace.id } }
    );
    expect(res.status).toBe(403);
  });

  it("non-member cannot invite (403)", async () => {
    const { user: owner } = await createUser();
    const { workspace } = await createWorkspaceFixture(owner.id);
    const { user: stranger } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(stranger.id);

    const res = await createInvite(
      new Request(`http://t/api/workspaces/${workspace.id}/invites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "x@test.local", role: "MEMBER" }),
      }),
      { params: { id: workspace.id } }
    );
    expect(res.status).toBe(403);
  });
});

import { POST as acceptInvite } from "@/app/api/invites/[token]/accept/route";
import { generateInviteToken } from "@/lib/invite-token";

describe("POST /api/invites/:token/accept", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
  });

  it("accepts an invite and creates membership at the invite's role", async () => {
    const { user: owner } = await createUser();
    const { workspace } = await createWorkspaceFixture(owner.id);
    const { user: invitee } = await createUser({ email: "friend@test.local" });
    const { token, tokenHash } = generateInviteToken();
    await prisma.invite.create({
      data: {
        workspaceId: workspace.id,
        email: "friend@test.local",
        tokenHash,
        role: "MEMBER",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    vi.mocked(requireUserId).mockResolvedValue(invitee.id);
    const res = await acceptInvite(
      new Request(`http://t/api/invites/${token}/accept`, { method: "POST" }),
      { params: { token } }
    );
    expect(res.status).toBe(200);

    const m = await prisma.membership.findFirst({
      where: { workspaceId: workspace.id, userId: invitee.id },
    });
    expect(m?.role).toBe("MEMBER");

    const inv = await prisma.invite.findUniqueOrThrow({ where: { tokenHash } });
    expect(inv.acceptedAt).not.toBeNull();
  });

  it("rejects expired invite with 410", async () => {
    const { user: owner } = await createUser();
    const { workspace } = await createWorkspaceFixture(owner.id);
    const { user: invitee } = await createUser({ email: "friend@test.local" });
    const { token, tokenHash } = generateInviteToken();
    await prisma.invite.create({
      data: {
        workspaceId: workspace.id,
        email: "friend@test.local",
        tokenHash,
        role: "MEMBER",
        expiresAt: new Date(Date.now() - 1),
      },
    });

    vi.mocked(requireUserId).mockResolvedValue(invitee.id);
    const res = await acceptInvite(
      new Request(`http://t/api/invites/${token}/accept`, { method: "POST" }),
      { params: { token } }
    );
    expect(res.status).toBe(410);
  });

  it("rejects already-accepted invite with 409", async () => {
    const { user: owner } = await createUser();
    const { workspace } = await createWorkspaceFixture(owner.id);
    const { user: invitee } = await createUser({ email: "friend@test.local" });
    const { token, tokenHash } = generateInviteToken();
    await prisma.invite.create({
      data: {
        workspaceId: workspace.id,
        email: "friend@test.local",
        tokenHash,
        role: "MEMBER",
        expiresAt: new Date(Date.now() + 60_000),
        acceptedAt: new Date(),
      },
    });

    vi.mocked(requireUserId).mockResolvedValue(invitee.id);
    const res = await acceptInvite(
      new Request(`http://t/api/invites/${token}/accept`, { method: "POST" }),
      { params: { token } }
    );
    expect(res.status).toBe(409);
  });

  it("rejects unknown token with 404", async () => {
    const { user: invitee } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(invitee.id);
    const res = await acceptInvite(
      new Request(`http://t/api/invites/bogus/accept`, { method: "POST" }),
      { params: { token: "bogus" } }
    );
    expect(res.status).toBe(404);
  });
});
