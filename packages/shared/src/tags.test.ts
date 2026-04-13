import { describe, it, expect } from "vitest";
import { parseTags } from "./tags";

describe("parseTags", () => {
  it("returns empty on empty content", () => {
    expect(parseTags("")).toEqual([]);
  });

  it("finds a single tag", () => {
    const r = parseTags("hello #draft world");
    expect(r).toHaveLength(1);
    expect(r[0]!.name).toBe("draft");
    expect(r[0]!.start).toBe(6);
    expect(r[0]!.end).toBe(12);
  });

  it("finds multiple tags and lowercases", () => {
    const r = parseTags("#alpha and #Beta here");
    expect(r.map((t) => t.name)).toEqual(["alpha", "beta"]);
  });

  it("keeps slash paths as a single tag", () => {
    const r = parseTags("see #foo/bar now");
    expect(r).toHaveLength(1);
    expect(r[0]!.name).toBe("foo/bar");
  });

  it("stops at punctuation boundary", () => {
    const r = parseTags("stop at #foo! now");
    expect(r).toHaveLength(1);
    expect(r[0]!.name).toBe("foo");
  });

  it("ignores tags in fenced code blocks", () => {
    const r = parseTags("```\n#notatag\n```\n");
    expect(r).toEqual([]);
  });

  it("ignores tags inside inline code", () => {
    const r = parseTags("text `#notatag` more");
    expect(r).toEqual([]);
  });

  it("ignores mid-word hashes with no whitespace before", () => {
    const r = parseTags("a#foo not a tag");
    expect(r).toEqual([]);
  });
});
