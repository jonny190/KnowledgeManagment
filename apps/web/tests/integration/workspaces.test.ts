import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, createUser } from "../helpers/db";
import { prisma } from "@km/db";

vi.mock("@/lib/session", () => ({
  getCurrentUserId: vi.fn(),
  requireUserId: vi.fn(),
}));

import { requireUserId } from "@/lib/session";
import { POST } from "@/app/api/workspaces/route";

describe("POST /api/workspaces", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
  });

  it("creates workspace, OWNER membership, vault, and root folder", async () => {
    const { user } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    const res = await POST(
      new Request("http://t/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Acme Corp" }),
      })
    );
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.workspace.name).toBe("Acme Corp");

    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: body.workspace.id } });
    expect(ws.ownerId).toBe(user.id);
    expect(ws.slug).toBe("acme-corp");

    const m = await prisma.membership.findFirst({ where: { workspaceId: ws.id, userId: user.id } });
    expect(m?.role).toBe("OWNER");

    const vault = await prisma.vault.findFirstOrThrow({
      where: { ownerType: "WORKSPACE", ownerId: ws.id },
    });
    expect(vault.name).toBe("Acme Corp");

    const root = await prisma.folder.findFirstOrThrow({
      where: { vaultId: vault.id, parentId: null },
    });
    expect(root.path).toBe("");
  });

  it("rejects empty name with 400", async () => {
    const { user } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    const res = await POST(
      new Request("http://t/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "" }),
      })
    );
    expect(res.status).toBe(400);
  });
});
