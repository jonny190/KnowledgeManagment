import { describe, it, expect, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import { prisma } from "../src/prisma.js";
import { verifyRealtimeToken } from "../src/auth.js";

const SECRET = "test-secret-realtime";
process.env.REALTIME_JWT_SECRET = SECRET;

async function seed() {
  const user = await prisma.user.create({ data: { email: `a${Date.now()}@t.io` } });
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

function sign(payload: object) {
  return jwt.sign(payload, SECRET, { algorithm: "HS256", noTimestamp: true });
}

describe("verifyRealtimeToken", () => {
  beforeEach(async () => {
    await prisma.realtimeGrant.deleteMany({});
    await prisma.noteDoc.deleteMany({});
    await prisma.link.deleteMany({});
    await prisma.note.deleteMany({});
    await prisma.attachment.deleteMany({});
    await prisma.folder.deleteMany({});
    await prisma.exportJob.deleteMany({});
    await prisma.vault.deleteMany({});
    await prisma.invite.deleteMany({});
    await prisma.membership.deleteMany({});
    await prisma.workspace.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.account.deleteMany({});
    await prisma.user.deleteMany({});
  });

  it("accepts a valid token with a live grant", async () => {
    const { user, vault, note } = await seed();
    const exp = Math.floor(Date.now() / 1000) + 60;
    const jti = "valid-jti-1";
    await prisma.realtimeGrant.create({
      data: { jti, userId: user.id, noteId: note.id, expiresAt: new Date(exp * 1000) },
    });
    const token = sign({ jti, sub: user.id, nid: note.id, vid: vault.id, role: "OWNER", exp });

    const ctx = await verifyRealtimeToken(token, note.id);
    expect(ctx.userId).toBe(user.id);
    expect(ctx.role).toBe("OWNER");
  });

  it("rejects when path noteId mismatches nid claim", async () => {
    const { user, vault, note } = await seed();
    const exp = Math.floor(Date.now() / 1000) + 60;
    const jti = "mismatch";
    await prisma.realtimeGrant.create({
      data: { jti, userId: user.id, noteId: note.id, expiresAt: new Date(exp * 1000) },
    });
    const token = sign({ jti, sub: user.id, nid: note.id, vid: vault.id, role: "OWNER", exp });

    await expect(verifyRealtimeToken(token, "other-note-id")).rejects.toThrow(/nid/);
  });

  it("rejects a bad signature", async () => {
    const { user, vault, note } = await seed();
    const exp = Math.floor(Date.now() / 1000) + 60;
    const bad = jwt.sign(
      { jti: "x", sub: user.id, nid: note.id, vid: vault.id, role: "OWNER", exp },
      "wrong-secret",
      { algorithm: "HS256", noTimestamp: true },
    );
    await expect(verifyRealtimeToken(bad, note.id)).rejects.toThrow();
  });

  it("rejects when grant is revoked", async () => {
    const { user, vault, note } = await seed();
    const exp = Math.floor(Date.now() / 1000) + 60;
    const jti = "revoked";
    await prisma.realtimeGrant.create({
      data: {
        jti,
        userId: user.id,
        noteId: note.id,
        expiresAt: new Date(exp * 1000),
        revokedAt: new Date(),
      },
    });
    const token = sign({ jti, sub: user.id, nid: note.id, vid: vault.id, role: "OWNER", exp });
    await expect(verifyRealtimeToken(token, note.id)).rejects.toThrow(/revoked/);
  });

  it("rejects when grant missing", async () => {
    const { user, vault, note } = await seed();
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = sign({ jti: "ghost", sub: user.id, nid: note.id, vid: vault.id, role: "OWNER", exp });
    await expect(verifyRealtimeToken(token, note.id)).rejects.toThrow(/grant/);
  });

  it("rejects non-member after membership revoked", async () => {
    const { user, note } = await seed();
    // Drop the vault to simulate loss of access.
    await prisma.note.deleteMany({});
    await prisma.vault.deleteMany({});
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = sign({ jti: "vanish", sub: user.id, nid: note.id, vid: "gone", role: "OWNER", exp });
    await expect(verifyRealtimeToken(token, note.id)).rejects.toThrow();
  });
});
