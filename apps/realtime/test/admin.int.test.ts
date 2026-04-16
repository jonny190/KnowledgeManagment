import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as Y from "yjs";
import { createHmac } from "node:crypto";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import WebSocket from "ws";
import jwt from "jsonwebtoken";
import { prisma } from "../src/prisma.js";
import { startServer } from "../src/server.js";
import type { Hocuspocus } from "@hocuspocus/server";

const JWT_SECRET = "int-admin-jwt";
const ADMIN_SECRET = "int-admin-secret";
process.env.REALTIME_JWT_SECRET = JWT_SECRET;
process.env.REALTIME_ADMIN_SECRET = ADMIN_SECRET;

const PORT = 3998;
let server: Hocuspocus;

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
  const jti = `jti-${Date.now()}`;
  const exp = Math.floor(Date.now() / 1000) + 120;
  await prisma.realtimeGrant.create({
    data: { jti, userId: user.id, noteId: note.id, expiresAt: new Date(exp * 1000) },
  });
  const token = jwt.sign(
    { jti, sub: user.id, nid: note.id, vid: vault.id, role: "OWNER", exp },
    JWT_SECRET,
    { algorithm: "HS256", noTimestamp: true },
  );
  return { user, note, token };
}

function sign(body: string): string {
  return createHmac("sha256", ADMIN_SECRET).update(body).digest("hex");
}

async function waitFor(fn: () => boolean | Promise<boolean>, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("waitFor timeout");
}

describe("admin /internal/ydoc/apply", () => {
  beforeEach(async () => {
    await prisma.link.deleteMany({});
    await prisma.noteDoc.deleteMany({});
    await prisma.realtimeGrant.deleteMany({});
    await prisma.note.deleteMany({});
    await prisma.folder.deleteMany({});
    await prisma.vault.deleteMany({});
    await prisma.user.deleteMany({});
    server = await startServer(PORT);
  });
  afterEach(async () => {
    await server.destroy();
  });

  it("returns 401 when the signature is missing", async () => {
    const res = await fetch(`http://localhost:${PORT}/internal/ydoc/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ noteId: "x", op: "append", text: "y" }),
    });
    expect(res.status).toBe(401);
  });

  it.skipIf(process.env.CI)(
    "applies a signed append and a connected client sees the text",
    { retry: 2 },
    async () => {
      const { note, token } = await seed();
      const doc = new Y.Doc();
      const wsProvider = new HocuspocusProviderWebsocket({
        url: `ws://localhost:${PORT}`,
        WebSocketPolyfill: WebSocket,
      });
      const provider = new HocuspocusProvider({
        websocketProvider: wsProvider,
        name: note.id,
        token,
        document: doc,
      });
      await waitFor(() => provider.isSynced);

      const body = JSON.stringify({
        noteId: note.id,
        op: "append",
        text: "hello admin",
        origin: "ai",
      });
      const res = await fetch(`http://localhost:${PORT}/internal/ydoc/apply`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-km-admin-signature": sign(body),
        },
        body,
      });
      expect(res.status).toBe(200);

      await waitFor(() => doc.getText("content").toString() === "hello admin");

      provider.disconnect();
      wsProvider.disconnect();
    },
    20_000,
  );
});
