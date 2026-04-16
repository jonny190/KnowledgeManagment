import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { applyAdminUpdate, computeAdminSignature } from "./admin-client";

describe("computeAdminSignature", () => {
  it("returns a stable HMAC-SHA256 hex string", () => {
    const sig = computeAdminSignature("secret", '{"hello":"world"}');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(sig).toBe(computeAdminSignature("secret", '{"hello":"world"}'));
  });
  it("is sensitive to the body content", () => {
    const a = computeAdminSignature("secret", '{"a":1}');
    const b = computeAdminSignature("secret", '{"a":2}');
    expect(a).not.toBe(b);
  });
});

describe("applyAdminUpdate", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  it("POSTs signed payload and returns parsed body on 200", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ applied: true, revision: 7 }), { status: 200 }),
    );
    const result = await applyAdminUpdate({
      realtimeUrl: "http://realtime:3001",
      adminSecret: "s3cr3t",
      noteId: "n1",
      op: "append",
      text: "hi",
    });
    expect(result).toEqual({ applied: true, revision: 7 });
    const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]![0]).toBe("http://realtime:3001/internal/ydoc/apply");
    const init = calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    const body = init.body as string;
    expect(JSON.parse(body)).toEqual({
      noteId: "n1",
      op: "append",
      text: "hi",
      origin: "ai",
    });
    const headers = init.headers as Record<string, string>;
    expect(headers["X-KM-Admin-Signature"]).toMatch(/^[0-9a-f]{64}$/);
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("throws a typed error on non-200 responses", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response("nope", { status: 401 }),
    );
    await expect(
      applyAdminUpdate({
        realtimeUrl: "http://realtime:3001",
        adminSecret: "wrong",
        noteId: "n1",
        op: "append",
        text: "x",
      }),
    ).rejects.toThrow(/realtime admin 401/);
  });
});
