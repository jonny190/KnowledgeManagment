import { describe, it, expect, beforeEach, vi } from "vitest";
import jwt from "jsonwebtoken";
import { prisma } from "@km/db";
import { issueRealtimeToken } from "./realtime";

vi.mock("@/lib/session", () => ({
  requireUserId: vi.fn(),
}));

import { requireUserId } from "@/lib/session";

process.env.REALTIME_JWT_SECRET = "test-secret";

async function seedNote() {
  const user = await prisma.user.create({ data: { email: `r${Date.now()}@t.io` } });
  const vault = await prisma.vault.create({
    data: { ownerType: "USER", ownerId: user.id, name: "V" },
  });
  const note = await prisma.note.create({
    data: {
      vaultId: vault.id,
      title: "T",
      slug: "t",
      content: "",
      createdById: user.id,
      updatedById: user.id,
    },
  });
  return { user, vault, note };
}

describe("issueRealtimeToken", () => {
  beforeEach(async () => {
    await prisma.realtimeGrant.deleteMany({});
    await prisma.note.deleteMany({});
    await prisma.vault.deleteMany({});
    await prisma.user.deleteMany({});
    vi.mocked(requireUserId).mockReset();
  });

  it("issues a token and inserts a grant row", async () => {
    const { user, vault, note } = await seedNote();
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    const token = await issueRealtimeToken(note.id);

    const decoded = jwt.verify(token, "test-secret") as { sub: string; nid: string; vid: string; role: string; jti: string };
    expect(decoded.sub).toBe(user.id);
    expect(decoded.nid).toBe(note.id);
    expect(decoded.vid).toBe(vault.id);
    expect(decoded.role).toBe("OWNER");
    expect(typeof decoded.jti).toBe("string");

    const grant = await prisma.realtimeGrant.findUnique({ where: { jti: decoded.jti } });
    expect(grant).not.toBeNull();
    expect(grant!.userId).toBe(user.id);
    expect(grant!.noteId).toBe(note.id);
  });

  it("rejects when user cannot access the vault", async () => {
    const { note } = await seedNote();
    const stranger = await prisma.user.create({ data: { email: `s${Date.now()}@t.io` } });
    vi.mocked(requireUserId).mockResolvedValue(stranger.id);

    await expect(issueRealtimeToken(note.id)).rejects.toThrow();
  });

  it("rejects for missing note", async () => {
    vi.mocked(requireUserId).mockResolvedValue("nonexistent-user");
    await expect(issueRealtimeToken("no-such-note")).rejects.toThrow();
  });
});
