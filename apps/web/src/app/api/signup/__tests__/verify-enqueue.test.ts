import { describe, expect, it, vi } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sendMock = vi.fn(async (..._args: any[]) => "job-1");
vi.mock("@/lib/queue", () => ({
  getBoss: vi.fn(async () => ({ send: sendMock })),
  enqueueExportVault: vi.fn(),
}));

import { POST } from "@/app/api/signup/route";

describe("signup enqueues verify email", () => {
  it("sends a send-email job with kind VERIFY_EMAIL", async () => {
    const req = new Request("http://x/api/signup", {
      method: "POST",
      body: JSON.stringify({ email: "new@user.com", password: "pw-12345678", name: "New" }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const call = sendMock.mock.calls.find((c) => c[0] === "send-email");
    expect(call).toBeTruthy();
    expect(call?.[1]).toMatchObject({ kind: "VERIFY_EMAIL" });
  });
});
