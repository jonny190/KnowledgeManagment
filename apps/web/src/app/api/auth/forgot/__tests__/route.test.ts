import { describe, expect, it, vi, beforeEach } from "vitest";
import { prisma } from "@km/db";
import { createUser } from "@/test/factories";

const sendMock = vi.fn(async () => "job-1");
vi.mock("@/lib/queue", () => ({
  getBoss: vi.fn(async () => ({ send: sendMock })),
  enqueueExportVault: vi.fn(),
}));

import { POST } from "@/app/api/auth/forgot/route";

beforeEach(async () => {
  sendMock.mockClear();
  await prisma.user.deleteMany();
});

describe("POST /api/auth/forgot", () => {
  it("returns 200 and enqueues PASSWORD_RESET when user exists", async () => {
    const u = await createUser({ email: "known@x.com" });
    const res = await POST(new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ email: u.email }),
      headers: { "content-type": "application/json" },
    }));
    expect(res.status).toBe(200);
    expect(sendMock).toHaveBeenCalledWith("send-email", { kind: "PASSWORD_RESET", userId: u.id }, expect.anything());
  });

  it("returns 200 and does NOT enqueue when user unknown", async () => {
    const res = await POST(new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ email: "nobody@x.com" }),
      headers: { "content-type": "application/json" },
    }));
    expect(res.status).toBe(200);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("returns 200 on malformed input (no enumeration)", async () => {
    const res = await POST(new Request("http://x", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
    }));
    expect(res.status).toBe(200);
  });
});
