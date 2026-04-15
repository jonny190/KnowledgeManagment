import { describe, expect, it, vi, beforeEach, type MockInstance } from "vitest";
import { prisma } from "@km/db";
import { createUser } from "@/test/factories";

vi.mock("@/lib/session", () => ({ requireUserId: vi.fn() }));

import { requireUserId } from "@/lib/session";
import { POST } from "@/app/api/me/password/route";

const requireUserIdMock = requireUserId as unknown as MockInstance;

beforeEach(async () => {
  await prisma.user.deleteMany();
});

describe("password change gate", () => {
  it("returns 403 when unverified", async () => {
    const u = await createUser({ emailVerified: null });
    requireUserIdMock.mockResolvedValue(u.id);
    const res = await POST(new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ currentPassword: "x", newPassword: "new-pw-12345" }),
      headers: { "content-type": "application/json" },
    }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.reason).toBe("verify_email_required");
  });

  it("returns 400 wrong_password when current password is incorrect", async () => {
    const u = await createUser({ emailVerified: new Date(), password: "correct-pass" });
    requireUserIdMock.mockResolvedValue(u.id);
    const res = await POST(new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ currentPassword: "wrong-pass", newPassword: "new-pw-12345" }),
      headers: { "content-type": "application/json" },
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("wrong_password");
  });

  it("returns 200 and updates password when current password matches", async () => {
    const u = await createUser({ emailVerified: new Date(), password: "correct-pass" });
    requireUserIdMock.mockResolvedValue(u.id);
    const res = await POST(new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ currentPassword: "correct-pass", newPassword: "new-pw-12345" }),
      headers: { "content-type": "application/json" },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
