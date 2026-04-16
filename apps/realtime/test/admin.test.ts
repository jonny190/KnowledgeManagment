import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Y from "yjs";
import { applyAdminUpdate, __setAdminDocProvider, __resetAdminState } from "../src/admin.js";

vi.mock("../src/snapshot.js", async () => {
  const actual = await vi.importActual<typeof import("../src/snapshot.js")>("../src/snapshot.js");
  return {
    ...actual,
    snapshotNote: vi.fn(async () => undefined),
  };
});

describe("applyAdminUpdate", () => {
  beforeEach(() => {
    __resetAdminState();
  });

  it("appends text to an existing Y.Doc", async () => {
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "start ");
    __setAdminDocProvider(async () => ({ doc, lastEditorUserId: null, persist: async () => {} }));
    const res = await applyAdminUpdate({ noteId: "n1", op: "append", text: "added" });
    expect(res.applied).toBe(true);
    expect(doc.getText("content").toString()).toBe("start added");
  });

  it("replaces the full text when op is 'replace'", async () => {
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "old body");
    __setAdminDocProvider(async () => ({ doc, lastEditorUserId: null, persist: async () => {} }));
    await applyAdminUpdate({ noteId: "n1", op: "replace", text: "brand new" });
    expect(doc.getText("content").toString()).toBe("brand new");
  });

  it("serialises concurrent calls under the per-note mutex", async () => {
    const doc = new Y.Doc();
    const observed: string[] = [];
    __setAdminDocProvider(async () => {
      observed.push(doc.getText("content").toString());
      return { doc, lastEditorUserId: null, persist: async () => {} };
    });
    await Promise.all([
      applyAdminUpdate({ noteId: "n1", op: "append", text: "a" }),
      applyAdminUpdate({ noteId: "n1", op: "append", text: "b" }),
      applyAdminUpdate({ noteId: "n1", op: "append", text: "c" }),
    ]);
    expect(doc.getText("content").toString().length).toBe(3);
    // Each call observed a different snapshot length: 0, 1, 2.
    expect(new Set(observed).size).toBe(3);
  });
});
