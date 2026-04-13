import { describe, it, expect, vi } from "vitest";
import { runChat } from "../src/runner";
import type { AiProvider, AiProviderRequest, AiToolContext, AiTool } from "../src/types";
import type { AiSseEvent } from "@km/shared";

const fakeTool: AiTool = {
  name: "echo",
  description: "echo args",
  jsonSchema: { type: "object" },
  parse: (raw) => raw,
  async execute(args) {
    return { echoed: args };
  },
};

class ScriptedProvider implements AiProvider {
  name = "scripted";
  model = "m";
  private callCount = 0;
  async stream(
    _req: AiProviderRequest,
    _ctx: AiToolContext,
    emit: (event: AiSseEvent) => void,
  ) {
    this.callCount++;
    if (this.callCount === 1) {
      emit({ type: "tool_use", id: "t1", name: "echo", args: { hi: 1 } });
    } else {
      emit({ type: "text", delta: "final" });
    }
    return { inputTokens: 1, outputTokens: 1, cachedTokens: 0, model: "m" };
  }
}

describe("runChat", () => {
  it("invokes the tool, feeds the result back, and streams the final text", async () => {
    const events: unknown[] = [];
    const usage = await runChat({
      provider: new ScriptedProvider(),
      tools: [fakeTool],
      systemPrompt: "sys",
      history: [{ role: "user", content: "hi" }],
      ctx: { userId: "u", vaultId: "v", prisma: {} as never },
      maxToolHops: 4,
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
    });
    expect(events.some((e: unknown) => (e as { type?: string }).type === "tool_use")).toBe(true);
    expect(events.some((e: unknown) => (e as { type?: string }).type === "tool_result")).toBe(true);
    expect(events.some((e: unknown) => (e as { type?: string }).type === "text")).toBe(true);
    expect(usage.inputTokens).toBe(2);
  });

  it("aborts on max tool hops", async () => {
    class LoopProvider implements AiProvider {
      name = "loop";
      model = "m";
      async stream(
        _req: AiProviderRequest,
        _ctx: AiToolContext,
        emit: (event: AiSseEvent) => void,
      ) {
        emit({ type: "tool_use", id: "x", name: "echo", args: {} });
        return { inputTokens: 0, outputTokens: 0, cachedTokens: 0, model: "m" };
      }
    }
    await expect(
      runChat({
        provider: new LoopProvider(),
        tools: [fakeTool],
        systemPrompt: "s",
        history: [{ role: "user", content: "hi" }],
        ctx: { userId: "u", vaultId: "v", prisma: {} as never },
        maxToolHops: 2,
        signal: new AbortController().signal,
        emit: vi.fn(),
      }),
    ).rejects.toThrow(/max tool hops/);
  });
});
