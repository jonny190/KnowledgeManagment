import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@km/db";
import { resetDb, createUser } from "../helpers/db";

vi.mock("@km/ai", async (orig) => {
  const mod = await orig<typeof import("@km/ai")>();
  const { StubProvider } = mod;
  return {
    ...mod,
    getProvider: () =>
      new StubProvider([{ type: "text", delta: "hi from stub" }]),
  };
});

vi.mock("../../src/lib/session", () => ({
  requireUserId: vi.fn(),
}));
vi.mock("../../src/lib/authz", () => ({
  assertCanAccessVault: vi.fn(async () => undefined),
}));

import { requireUserId } from "../../src/lib/session";
import { POST } from "../../src/app/api/ai/chat/route";

async function readSse(res: Response): Promise<string[]> {
  const reader = res.body!.getReader();
  const chunks: string[] = [];
  const dec = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(dec.decode(value));
  }
  return chunks.join("").split("\n\n").filter(Boolean);
}

describe("POST /api/ai/chat", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
  });

  it("streams text, persists messages, and records usage", async () => {
    const { user, vault } = await createUser();
    const note = await prisma.note.create({
      data: {
        vaultId: vault.id,
        title: "N",
        slug: "n",
        content: "body",
        createdById: user.id,
        updatedById: user.id,
      },
    });
    const conversation = await prisma.aiConversation.create({
      data: { vaultId: vault.id, noteId: note.id, createdById: user.id },
    });
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    const res = await POST(
      new Request("http://test/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({ conversationId: conversation.id, message: "hi" }),
      }),
    );
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const events = await readSse(res);
    expect(events.some((e) => e.includes("event: ready"))).toBe(true);
    expect(events.some((e) => e.includes("event: text") && e.includes("hi from stub"))).toBe(true);
    expect(events.some((e) => e.includes("event: done"))).toBe(true);

    const messages = await prisma.aiMessage.findMany({ where: { conversationId: conversation.id } });
    expect(messages).toHaveLength(2);
    const usage = await prisma.aiUsage.findFirst({ where: { userId: user.id } });
    expect(usage?.requests).toBe(1);
    expect(usage!.inputTokens + usage!.outputTokens).toBeGreaterThan(0);
  });
});
