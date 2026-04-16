import { describe, it, expect } from "vitest";
import { StubProvider } from "../providers/stub";

describe("StubProvider", () => {
  it("emits the scripted steps in order when given a script", async () => {
    const provider = new StubProvider([
      { type: "text", delta: "hi" },
      { type: "tool_use", id: "call_1", name: "createNote", args: { title: "x" } },
    ]);
    const events: Array<{ type: string }> = [];
    await provider.stream(
      {
        systemPrompt: "",
        history: [],
        tools: [],
        signal: new AbortController().signal,
      },
      { userId: "u", vaultId: "v", prisma: {} as never },
      (ev) => events.push(ev),
    );
    expect(events.map((e) => e.type)).toEqual(["text", "tool_use"]);
  });

  it("stubToolCallMode 'tool-then-finish' emits tool_use once then stops on next hop", async () => {
    const provider = new StubProvider({
      mode: "tool-then-finish",
      toolUse: { id: "call_99", name: "createNote", args: { vaultId: "v", title: "x" } },
    });
    const first: Array<{ type: string }> = [];
    await provider.stream(
      { systemPrompt: "", history: [], tools: [], signal: new AbortController().signal },
      { userId: "u", vaultId: "v", prisma: {} as never },
      (ev) => first.push(ev),
    );
    expect(first.map((e) => e.type)).toEqual(["tool_use"]);

    const second: Array<{ type: string }> = [];
    await provider.stream(
      { systemPrompt: "", history: [{ role: "tool", content: [] }], tools: [], signal: new AbortController().signal },
      { userId: "u", vaultId: "v", prisma: {} as never },
      (ev) => second.push(ev),
    );
    expect(second.map((e) => e.type)).toEqual(["text"]);
  });
});
