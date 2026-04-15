import { describe, expect, it, beforeEach, vi, type MockInstance } from "vitest";
import { prisma } from "@km/db";
import { createUser } from "@/test/factories";

const sendMock = vi.fn(async () => "job-1");
vi.mock("@/lib/queue", () => ({ getBoss: vi.fn(async () => ({ send: sendMock })) }));
vi.mock("@/lib/session", () => ({ requireUserId: vi.fn() }));

import { requireUserId } from "@/lib/session";
import { POST } from "@/app/api/workspaces/[id]/invites/route";

const requireUserIdMock = requireUserId as unknown as MockInstance;

beforeEach(async () => {
  sendMock.mockClear();
  await prisma.invite.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
});

describe("invite creation enqueues INVITE email", () => {
  it("creates invite and sends send-email job with inviteId", async () => {
    const me = await createUser({ email: "me@x.com" });
    const workspace = await prisma.workspace.create({
      data: { name: "Test Workspace", slug: "test-workspace", ownerId: me.id },
    });
    await prisma.membership.create({
      data: { workspaceId: workspace.id, userId: me.id, role: "ADMIN" },
    });
    requireUserIdMock.mockResolvedValue(me.id);

    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({ email: "guest@x.com", role: "MEMBER" }),
        headers: { "content-type": "application/json" },
      }),
      { params: { id: workspace.id } } as Parameters<typeof POST>[1],
    );

    expect(res.status).toBe(201);
    const invite = await prisma.invite.findFirst();
    expect(invite).toBeTruthy();
    expect(invite!.token).toBeTruthy();
    expect(sendMock).toHaveBeenCalledWith(
      "send-email",
      { kind: "INVITE", inviteId: invite!.id },
      expect.anything(),
    );
  });
});
