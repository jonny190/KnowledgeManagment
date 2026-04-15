import { describe, expect, it, beforeEach, vi } from "vitest";
import { prisma } from "@km/db";
import { createUser } from "@/test/factories";

const { createExportMock } = vi.hoisted(() => ({
  createExportMock: vi.fn(async () => ({ jobId: "job-1" })),
}));

vi.mock("@/lib/exports/create", () => ({ createExport: createExportMock }));
vi.mock("@/lib/session", () => ({ requireUserId: vi.fn() }));

import { requireUserId } from "@/lib/session";
import { POST } from "@/app/api/exports/[vaultId]/route";

beforeEach(async () => {
  createExportMock.mockClear();
  await prisma.vault.deleteMany();
  await prisma.user.deleteMany();
});

describe("export vault email-verified gate", () => {
  it("returns 403 verify_email_required when user has no verified email", async () => {
    const u = await createUser({ emailVerified: null });
    (requireUserId as any).mockResolvedValue(u.id);
    const res = await POST(new Request("http://x", { method: "POST" }), {
      params: { vaultId: "v-1" },
    } as any);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.reason).toBe("verify_email_required");
    expect(createExportMock).not.toHaveBeenCalled();
  });

  it("proceeds past gate when user is verified", async () => {
    const u = await createUser({ emailVerified: new Date() });
    (requireUserId as any).mockResolvedValue(u.id);
    const res = await POST(new Request("http://x", { method: "POST" }), {
      params: { vaultId: "v-1" },
    } as any);
    // createExport mock succeeds so expect 202
    expect(res.status).toBe(202);
    expect(createExportMock).toHaveBeenCalled();
  });
});
