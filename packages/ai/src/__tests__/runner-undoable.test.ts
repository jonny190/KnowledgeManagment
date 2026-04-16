import { describe, it, expect } from "vitest";
import { z } from "zod";
import { runChat } from "../runner";
import { StubProvider } from "../providers/stub";
import type { AiTool, AiToolContext } from "../types";

describe("runChat", () => {
  it("emits tool_result_undoable when a tool returns an undo field", async () => {
    const undoableTool: AiTool = {
      name: "fakeWrite",
      description: "t",
      jsonSchema: { type: "object", properties: {}, required: [] },
      parse: (raw) => z.object({}).parse(raw),
      async execute() {
        return {
          noteId: "n1",
          title: "X",
          undo: { kind: "create_note", id: "n1" },
        };
      },
    };
    const provider = new StubProvider({
      mode: "tool-then-finish",
      toolUse: { id: "call_a", name: "fakeWrite", args: {} },
    });
    const events: unknown[] = [];
    const ctx: AiToolContext = {
      userId: "u",
      vaultId: "v",
      prisma: {} as unknown as import("@km/db").PrismaClient,
    };
    await runChat({
      provider,
      tools: [undoableTool],
      systemPrompt: "",
      history: [],
      ctx,
      maxToolHops: 2,
      signal: new AbortController().signal,
      emit: (ev) => events.push(ev),
    });
    const undoable = events.find(
      (e) => (e as { type?: string }).type === "tool_result_undoable",
    );
    expect(undoable).toMatchObject({
      type: "tool_result_undoable",
      callId: "call_a",
      undo: { kind: "create_note", id: "n1" },
    });
    expect((undoable as { summary: string }).summary).toMatch(/X|fakeWrite/);
  });

  it("emits tool_result_undoable with null undo when result carries undo:null", async () => {
    const tool: AiTool = {
      name: "editNote",
      description: "t",
      jsonSchema: { type: "object", properties: {}, required: [] },
      parse: (raw) => z.object({}).parse(raw),
      async execute() {
        return { noteId: "n2", undo: null };
      },
    };
    const provider = new StubProvider({
      mode: "tool-then-finish",
      toolUse: { id: "call_b", name: "editNote", args: {} },
    });
    const events: unknown[] = [];
    await runChat({
      provider,
      tools: [tool],
      systemPrompt: "",
      history: [],
      ctx: { userId: "u", vaultId: "v", prisma: {} as unknown as import("@km/db").PrismaClient },
      maxToolHops: 2,
      signal: new AbortController().signal,
      emit: (ev) => events.push(ev),
    });
    const undoable = events.find(
      (e) => (e as { type?: string }).type === "tool_result_undoable",
    ) as { undo: unknown; summary: string } | undefined;
    expect(undoable?.undo).toBeNull();
    expect(undoable?.summary).toMatch(/Ctrl-Z/);
  });
});
