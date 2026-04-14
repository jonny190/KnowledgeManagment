import { describe, it, expect } from "vitest";
import { buildGraph } from "./graph";
import { makeVaultWithNotes, linkNotes, tagNote } from "../test/factories";

describe("buildGraph", () => {
  it("returns nodes, edges, backlink counts, and tags", async () => {
    const { vault, notes } = await makeVaultWithNotes(["A", "B", "C"]);
    const [noteA, noteB, noteC] = notes;
    await linkNotes(noteA!.id, noteB!.id);
    await linkNotes(noteC!.id, noteB!.id);
    await tagNote(noteB!.id, vault.id, "draft");

    const g = await buildGraph(vault.id);
    expect(g.nodes).toHaveLength(3);
    const b = g.nodes.find((n) => n.label === "B");
    expect(b?.backlinkCount).toBe(2);
    expect(b?.tags).toEqual(["draft"]);
    expect(g.edges).toHaveLength(2);
  });
});
