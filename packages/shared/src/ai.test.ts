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
