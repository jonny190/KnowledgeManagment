import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { updateNote } from "../updateNote";

const realFetch = global.fetch;
beforeEach(() => {
  global.fetch = vi.fn() as unknown as typeof fetch;
});
afterAll(() => {
  global.fetch = realFetch;
});

function prismaWithNote(note: { id: string; vaultId: string } | null) {
  return {
    note: { findUnique: vi.fn().mockResolvedValue(note) },
  };
}

describe("updateNote tool", () => {
  it("rejects invalid mode", () => {
    expect(() =>
      updateNote.parse({ noteId: "cknote1", content: "x", mode: "replace_all" }),
    ).toThrow();
  });

  it("returns a typed error when note not found", async () => {
    const prisma = prismaWithNote(null);
    const ctx = {
      userId: "u1",
      vaultId: "v1",
      prisma: prisma as unknown as import("@km/db").PrismaClient,
      adminSecret: "s",
      realtimeUrl: "http://realtime:3001",
    };
    const args = updateNote.parse({
      noteId: "cknote00000000000000000000",
      content: "x",
      mode: "append",
    });
    const result = await updateNote.execute(args, ctx);
    expect(result).toEqual({ error: "not_found" });
  });

  it("rejects note from a different vault", async () => {
    const prisma = prismaWithNote({ id: "cknote1", vaultId: "otherv" });
    const ctx = {
      userId: "u1",
      vaultId: "v1",
      prisma: prisma as unknown as import("@km/db").PrismaClient,
      adminSecret: "s",
      realtimeUrl: "http://realtime:3001",
    };
    const args = updateNote.parse({
      noteId: "cknote00000000000000000000",
      content: "x",
      mode: "append",
    });
    await expect(updateNote.execute(args, ctx)).rejects.toThrow(/not in this vault/);
  });

  it("POSTs a signed admin update and returns undo null", async () => {
    const prisma = prismaWithNote({ id: "cknote1", vaultId: "v1" });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ applied: true, revision: 1 }), { status: 200 }),
    );
    const ctx = {
      userId: "u1",
      vaultId: "v1",
      prisma: prisma as unknown as import("@km/db").PrismaClient,
      adminSecret: "s3cr3t",
      realtimeUrl: "http://realtime:3001",
    };
    const args = updateNote.parse({
      noteId: "cknote00000000000000000000",
      content: "added\n",
      mode: "append",
    });
    const result = await updateNote.execute(args, ctx);
    expect(result).toEqual({ noteId: "cknote1", undo: null });
    expect(global.fetch).toHaveBeenCalledWith(
      "http://realtime:3001/internal/ydoc/apply",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws when adminSecret or realtimeUrl are absent", async () => {
    const prisma = prismaWithNote({ id: "cknote1", vaultId: "v1" });
    const ctx = {
      userId: "u1",
      vaultId: "v1",
      prisma: prisma as unknown as import("@km/db").PrismaClient,
    };
    const args = updateNote.parse({
      noteId: "cknote00000000000000000000",
      content: "x",
      mode: "append",
    });
    await expect(updateNote.execute(args, ctx)).rejects.toThrow(/admin.*not configured/i);
  });
});
