import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@km/db";
import { hashToken } from "@km/email/tokens";
import { createUser } from "@/test/factories";
import { POST } from "@/app/api/auth/reset/route";

beforeEach(async () => {
  await prisma.emailToken.deleteMany();
  await prisma.user.deleteMany();
});

describe("POST /api/auth/reset", () => {
  it("consumes token, updates password, rejects second use", async () => {
    const u = await createUser({ email: "r@x.com", password: "old-password-1" });
    const raw = "reset-raw-token-abc-1";
    await prisma.emailToken.create({
      data: {
        userId: u.id,
        email: u.email,
        kind: "PASSWORD_RESET",
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const res1 = await POST(new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ token: raw, password: "new-password-1" }),
      headers: { "content-type": "application/json" },
    }));
    expect(res1.status).toBe(200);

    const res2 = await POST(new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ token: raw, password: "other-password-1" }),
      headers: { "content-type": "application/json" },
    }));
    expect(res2.status).toBe(410);
  });

  it("returns 400 when input invalid", async () => {
    const res = await POST(new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ token: "", password: "x" }),
      headers: { "content-type": "application/json" },
    }));
    expect(res.status).toBe(400);
  });
});
