import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@km/db";
import { resetDb, createUser } from "../helpers/db";

vi.mock("@km/ai", async (orig) => {
  const mod = await orig<typeof import("@km/ai")>();
  const { StubProvider } = mod;
  return {
    ...mod,
    getProvider: () =>
      new StubProvider({
        mode: "tool-then-finish",
        toolUse: {
          id: "call_1",
          name: "createNote",
          // Filled in at runtime via global closure below.
          args: (globalThis as unknown as { __NEXT_ARGS: unknown }).__NEXT_ARGS,
        },
      }),
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

describe("AI write tools via SSE route", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
  });

  it("createNote via tool-use creates DB row and emits tool_result_undoable", async () => {
    const { user, vault } = await createUser();
    const note = await prisma.note.create({
      data: {
        vaultId: vault.id,
        title: "Host",
        slug: "host",
        content: "",
        createdById: user.id,
        updatedById: user.id,
      },
    });
    const conversation = await prisma.aiConversation.create({
      data: { vaultId: vault.id, noteId: note.id, createdById: user.id },
    });
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    (globalThis as unknown as { __NEXT_ARGS: unknown }).__NEXT_ARGS = {
      vaultId: vault.id,
      title: "From Chat",
    };

    const res = await POST(
      new Request("http://test/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({ conversationId: conversation.id, message: "make a note" }),
      }),
    );
    const events = await readSse(res);
    expect(events.some((e) => e.includes("event: tool_result_undoable"))).toBe(true);
    expect(events.some((e) => e.includes('"kind":"create_note"'))).toBe(true);

    const created = await prisma.note.findFirst({
      where: { vaultId: vault.id, title: "From Chat" },
    });
    expect(created).not.toBeNull();
    expect(created!.slug).toBe("from-chat");
  });
});
