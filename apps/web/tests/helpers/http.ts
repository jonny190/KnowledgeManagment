import { vi } from "vitest";

export function mockSession(userId: string | null) {
  vi.doMock("next-auth", async () => {
    const actual = await vi.importActual<typeof import("next-auth")>("next-auth");
    return {
      ...actual,
      getServerSession: async () =>
        userId ? { user: { id: userId } } : null,
    };
  });
}

export async function callHandler<T extends (req: Request, ctx: { params: Record<string, string> }) => Promise<Response>>(
  handler: T,
  init: { method: string; url: string; body?: unknown; params?: Record<string, string> }
) {
  const req = new Request(init.url, {
    method: init.method,
    headers: { "content-type": "application/json" },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const res = await handler(req, { params: init.params ?? {} });
  const text = await res.text();
  const json = text.length > 0 ? JSON.parse(text) : null;
  return { status: res.status, body: json };
}
