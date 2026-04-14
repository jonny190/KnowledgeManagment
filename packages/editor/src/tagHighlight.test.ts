// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { EditorState, StateField } from "@codemirror/state";
import { DecorationSet } from "@codemirror/view";
import { tagHighlight } from "./tagHighlight";

describe("tagHighlight extension", () => {
  it("produces at least one decoration for a document with a tag", () => {
    const state = EditorState.create({
      doc: "body with #draft tag",
      extensions: [tagHighlight()],
    });
    const decorations = state.field(tagHighlight.field as StateField<DecorationSet>);
    expect(decorations.size).toBeGreaterThan(0);
  });

  it("produces no decorations for a document without tags", () => {
    const state = EditorState.create({
      doc: "plain text no tags here",
      extensions: [tagHighlight()],
    });
    const decorations = state.field(tagHighlight.field as StateField<DecorationSet>);
    expect(decorations.size).toBe(0);
  });
});
