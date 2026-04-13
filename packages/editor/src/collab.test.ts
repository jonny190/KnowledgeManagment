import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { EditorState } from "@codemirror/state";
import { collabExtension } from "./collab";

describe("collabExtension", () => {
  it("returns an array of CodeMirror extensions that can bootstrap an EditorState", () => {
    const doc = new Y.Doc();
    const ytext = doc.getText("content");
    const awareness = new Awareness(doc);
    const ext = collabExtension({ ytext, awareness });
    const state = EditorState.create({ doc: ytext.toString(), extensions: ext });
    expect(state).toBeTruthy();
  });
});
