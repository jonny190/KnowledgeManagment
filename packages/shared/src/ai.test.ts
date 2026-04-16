import { describe, it, expect } from "vitest";
import { aiChatRequest, aiCommandName, aiCommandRequest, aiSseEvent } from "./ai";

describe("ai schemas", () => {
  it("accepts a chat request", () => {
    const ok = aiChatRequest.parse({
      conversationId: "c1",
      message: "hello",
    });
    expect(ok.message).toBe("hello");
  });

  it("rejects an empty message", () => {
    expect(() => aiChatRequest.parse({ conversationId: "c1", message: "" })).toThrow();
  });

  it("validates command names", () => {
    expect(aiCommandName.parse("summarize")).toBe("summarize");
    expect(() => aiCommandName.parse("delete")).toThrow();
  });

  it("validates a command request with optional language", () => {
    const ok = aiCommandRequest.parse({
      conversationId: "c1",
      command: "translate",
      selection: "hello",
      language: "French",
    });
    expect(ok.language).toBe("French");
  });

  it("validates a text SSE event", () => {
    const ok = aiSseEvent.parse({ type: "text", delta: "hi" });
    expect(ok.type).toBe("text");
  });
});

describe("aiSseEvent tool_result_undoable", () => {
  it("parses tool_result_undoable with a create_note undo token", () => {
    const event = {
      type: "tool_result_undoable",
      callId: "call_1",
      summary: "Created note 'Meeting notes'",
      undo: { kind: "create_note", id: "cknote1" },
    };
    expect(aiSseEvent.parse(event)).toEqual(event);
  });

  it("parses tool_result_undoable with undo null", () => {
    const event = {
      type: "tool_result_undoable",
      callId: "call_2",
      summary: "Updated 'Meeting notes'. Use Ctrl-Z in the editor to revert.",
      undo: null,
    };
    expect(aiSseEvent.parse(event)).toEqual(event);
  });

  it("rejects tool_result_undoable with unknown undo.kind", () => {
    expect(() =>
      aiSseEvent.parse({
        type: "tool_result_undoable",
        callId: "call_3",
        summary: "x",
        undo: { kind: "delete_note", id: "abc" },
      }),
    ).toThrow();
  });
});
