import { describe, it, expect, beforeEach, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import * as Y from "yjs";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import WebSocket from "ws";
import { prisma } from "../src/prisma.js";
import { startServer } from "../src/server.js";
import type { Hocuspocus } from "@hocuspocus/server";

const SECRET = "int-test-secret";
process.env.REALTIME_JWT_SECRET = SECRET;

let server: Hocuspocus;
const PORT = 3999;

async function seed() {
  const user = await prisma.user.create({ data: { email: `i${Date.now()}@t.io` } });
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
    SECRET,
    { algorithm: "HS256", noTimestamp: true },
  );
  return { user, vault, note, token };
}

async function waitFor(fn: () => boolean | Promise<boolean>, ms = 8000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const result = await fn();
    if (result) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("waitFor timeout");
}

function makeProvider(url: string, noteId: string, token: string, doc: Y.Doc) {
  const wsProvider = new HocuspocusProviderWebsocket({
    url,
    WebSocketPolyfill: WebSocket,
  });
  const provider = new HocuspocusProvider({
    websocketProvider: wsProvider,
    name: noteId,
    token,
    document: doc,
  });
  return { provider, wsProvider };
}

describe("realtime integration", () => {
  beforeEach(async () => {
    await prisma.link.deleteMany({});
    await prisma.noteDoc.deleteMany({});
    await prisma.realtimeGrant.deleteMany({});
    await prisma.note.deleteMany({});
    await prisma.vault.deleteMany({});
    await prisma.user.deleteMany({});
    server = await startServer(PORT);
  });

  afterEach(async () => {
    await server.destroy();
  });

  it("two clients converge and a snapshot updates Note.content + Link", async () => {
    const { note, token } = await seed();

    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const { provider: a, wsProvider: wsA } = makeProvider(`ws://localhost:${PORT}`, note.id, token, docA);
    const { provider: b, wsProvider: wsB } = makeProvider(`ws://localhost:${PORT}`, note.id, token, docB);

    await waitFor(() => a.isSynced && b.isSynced);

    docA.getText("content").insert(0, "Hello ");
    docB.getText("content").insert(6, "[[Nowhere]]");

    await waitFor(
      () =>
        docA.getText("content").toString() === "Hello [[Nowhere]]" &&
        docB.getText("content").toString() === "Hello [[Nowhere]]",
    );

    a.disconnect();
    b.disconnect();
    wsA.disconnect();
    wsB.disconnect();

    // onDisconnect triggers an immediate snapshot.
    await waitFor(async () => {
      const fresh = await prisma.note.findUnique({ where: { id: note.id } });
      return fresh?.content === "Hello [[Nowhere]]";
    });

    const links = await prisma.link.findMany({ where: { sourceNoteId: note.id } });
    expect(links).toHaveLength(1);
    expect(links[0]!.targetTitle).toBe("Nowhere");
    expect(links[0]!.resolved).toBe(false);
  }, 30_000);

  it("rejects a token when the grant has been revoked", async () => {
    const { note, token } = await seed();
    await prisma.realtimeGrant.updateMany({ data: { revokedAt: new Date() } });

    const docA = new Y.Doc();
    const { provider: a, wsProvider: wsA } = makeProvider(`ws://localhost:${PORT}`, note.id, token, docA);

    let errored = false;
    a.on("authenticationFailed", () => {
      errored = true;
    });

    await waitFor(() => errored, 8000);
    a.disconnect();
    wsA.disconnect();
    expect(errored).toBe(true);
  }, 15_000);
});
