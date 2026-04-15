import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queue", () => ({
  getBoss: vi.fn(async () => ({
    send: vi.fn(async () => "job-id-1"),
  })),
  enqueueExportVault: vi.fn(),
}));

import { enqueueSendEmail } from "@/lib/email-jobs";

describe("enqueueSendEmail", () => {
  it("enqueues a send-email job with kind and ids", async () => {
    const id = await enqueueSendEmail({ kind: "VERIFY_EMAIL", userId: "u1" });
    expect(id).toBe("job-id-1");
  });
});
