import { describe, it, expect } from "vitest";
import { parseSseChunk } from "./sse";

describe("parseSseChunk", () => {
  it("parses a single event", () => {
    const events = parseSseChunk('event: text\ndata: {"type":"text","delta":"hi"}\n\n');
    expect(events).toEqual([{ event: "text", data: { type: "text", delta: "hi" } }]);
  });

  it("parses multiple events in a chunk", () => {
    const raw =
      'event: ready\ndata: {"type":"ready","conversationId":"c","messageId":"m"}\n\n' +
      'event: text\ndata: {"type":"text","delta":"x"}\n\n';
    const events = parseSseChunk(raw);
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe("ready");
  });

  it("ignores trailing partials", () => {
    const events = parseSseChunk("event: text\ndata: {");
    expect(events).toEqual([]);
  });
});
