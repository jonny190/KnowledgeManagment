import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@km/db";
import { resetDb, createUser } from "../helpers/db";

vi.mock("@km/ai", async (orig) => {
  const mod = await orig<typeof import("@km/ai")>();
  const { StubProvider } = mod;
  return {
    ...mod,
    getProvider: () => new StubProvider([{ type: "text", delta: "summary" }]),
  };
});

vi.mock("../../src/lib/session", () => ({
  requireUserId: vi.fn(),
}));
vi.mock("../../src/lib/authz", () => ({
  assertCanAccessVault: vi.fn(async () => undefined),
}));

import { requireUserId } from "../../src/lib/session";
import { POST } from "../../src/app/api/ai/command/route";

describe("POST /api/ai/command", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
  });

  it("templates the command into a user message and streams a reply", async () => {
    const { user, vault } = await createUser();
    const conversation = await prisma.aiConversation.create({
      data: { vaultId: vault.id, createdById: user.id },
    });
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    const res = await POST(
      new Request("http://test/api/ai/command", {
        method: "POST",
        body: JSON.stringify({
          conversationId: conversation.id,
          command: "summarize",
          selection: "long text here",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("event: text");

    const messages = await prisma.aiMessage.findMany({ where: { conversationId: conversation.id } });
    expect(messages).toHaveLength(2);
    const userMsg = messages.find((m) => m.role === "USER");
    const content = userMsg!.content as Array<{ text: string }>;
    expect(content[0].text).toContain("Summarise");
  });
});
