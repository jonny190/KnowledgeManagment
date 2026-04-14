import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeVaultWithNotes } from "@/test/factories";

vi.mock("@/lib/session", () => ({
  requireUserId: vi.fn(),
}));

import { requireUserId } from "@/lib/session";
import { GET } from "./route";

describe("GET /api/search", () => {
  beforeEach(() => {
    vi.mocked(requireUserId).mockReset();
  });

  it("rejects unauthenticated requests", async () => {
    vi.mocked(requireUserId).mockRejectedValue(new Response("Unauthorized", { status: 401 }));
    const r = await GET(new NextRequest("http://x/api/search?vaultId=v&q=hello"));
    expect(r.status).toBe(401);
  });

  it("rejects access to vaults the user cannot read", async () => {
    const { vault } = await makeVaultWithNotes([]);
    vi.mocked(requireUserId).mockResolvedValue("some-other-user");
    const r = await GET(new NextRequest(`http://x/api/search?vaultId=${vault.id}&q=hello`));
    expect(r.status).toBe(403);
  });

  it("returns results as JSON", async () => {
    const { vault, user } = await makeVaultWithNotes(["Welcome"]);
    vi.mocked(requireUserId).mockResolvedValue(user.id);
    const r = await GET(new NextRequest(`http://x/api/search?vaultId=${vault.id}&q=welcome`));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.results[0].title).toBe("Welcome");
  });
});
