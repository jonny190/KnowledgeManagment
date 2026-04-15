import { describe, expect, it, beforeEach, vi } from "vitest";
import { prisma } from "@km/db";
import { createUser } from "@/test/factories";

const sendMock = vi.fn(async () => "job");
vi.mock("@/lib/queue", () => ({ getBoss: vi.fn(async () => ({ send: sendMock })), enqueueExportVault: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUserId: vi.fn() }));

import { requireUserId } from "@/lib/session";
import { POST } from "@/app/api/me/verify-email/resend/route";

beforeEach(async () => {
  sendMock.mockClear();
  await prisma.user.deleteMany();
});

describe("POST /api/me/verify-email/resend", () => {
  it("enqueues when user is unverified", async () => {
    const u = await createUser({ email: "u@x.com", emailVerified: null });
    (requireUserId as ReturnType<typeof vi.fn>).mockResolvedValue(u.id);
    const res = await POST(new Request("http://x", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(sendMock).toHaveBeenCalledWith("send-email", { kind: "VERIFY_EMAIL", userId: u.id }, expect.anything());
  });

  it("returns 200 without enqueuing when already verified", async () => {
    const u = await createUser({ email: "v@x.com", emailVerified: new Date() });
    (requireUserId as ReturnType<typeof vi.fn>).mockResolvedValue(u.id);
    const res = await POST(new Request("http://x", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
