import { describe, it, expect } from "vitest";
import { undoUrl } from "../undoUrl";

describe("undoUrl", () => {
  it("builds the notes delete URL for create_note", () => {
    expect(undoUrl({ kind: "create_note", id: "n1" })).toBe("/api/notes/n1");
  });
  it("builds the folders delete URL for create_folder", () => {
    expect(undoUrl({ kind: "create_folder", id: "f1" })).toBe("/api/folders/f1");
  });
});
