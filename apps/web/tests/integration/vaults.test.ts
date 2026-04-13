import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, createUser, createWorkspaceFixture } from "../helpers/db";
import { prisma } from "@km/db";

vi.mock("@/lib/session", () => ({
  getCurrentUserId: vi.fn(),
  requireUserId: vi.fn(),
}));

import { getCurrentUserId, requireUserId } from "@/lib/session";
import { GET } from "@/app/api/vaults/route";

describe("GET /api/vaults", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(getCurrentUserId).mockReset();
    vi.mocked(requireUserId).mockReset();
  });

  it("returns personal vault plus workspace vaults the user belongs to", async () => {
    const { user, vault: personal } = await createUser();
    const { vault: wsVault, workspace } = await createWorkspaceFixture(user.id, "Team");
    const { user: other } = await createUser();
    await createWorkspaceFixture(other.id, "Other");

    vi.mocked(requireUserId).mockResolvedValue(user.id);
    const res = await GET(new Request("http://t/api/vaults"));
    const body = await res.json();

    expect(res.status).toBe(200);
    const ids = body.vaults.map((v: any) => v.id).sort();
    expect(ids).toEqual([personal.id, wsVault.id].sort());
    const team = body.vaults.find((v: any) => v.id === wsVault.id);
    expect(team.ownerType).toBe("WORKSPACE");
    expect(team.workspaceId).toBe(workspace.id);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireUserId).mockRejectedValue(new Response("Unauthorized", { status: 401 }));
    try {
      await GET(new Request("http://t/api/vaults"));
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Response).status).toBe(401);
    }
  });
});
