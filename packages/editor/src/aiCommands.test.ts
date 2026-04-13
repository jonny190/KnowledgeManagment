import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { parseSlashCommand, captureContext } from "./aiCommands";

describe("parseSlashCommand", () => {
  it("recognises supported commands", () => {
    expect(parseSlashCommand("/summarize")).toEqual({ command: "summarize" });
    expect(parseSlashCommand("/translate fr")).toEqual({ command: "translate", language: "fr" });
  });

  it("returns null for unknown text", () => {
    expect(parseSlashCommand("/unknown")).toBeNull();
    expect(parseSlashCommand("hello")).toBeNull();
  });
});

describe("captureContext", () => {
  it("returns the selection when present", () => {
    const state = EditorState.create({ doc: "line one\nline two", selection: { anchor: 0, head: 8 } });
    expect(captureContext(state)).toBe("line one");
  });

  it("falls back to the current line when no selection", () => {
    const state = EditorState.create({ doc: "line one\nline two", selection: { anchor: 12, head: 12 } });
    expect(captureContext(state)).toBe("line two");
  });
});
