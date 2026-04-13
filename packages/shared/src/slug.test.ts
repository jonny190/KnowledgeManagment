import { describe, it, expect } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("My First Note")).toBe("my-first-note");
  });
  it("strips punctuation", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
  });
  it("collapses whitespace and trims dashes", () => {
    expect(slugify("  spaced   out  ")).toBe("spaced-out");
  });
  it("falls back to 'untitled' for empty result", () => {
    expect(slugify("!!!")).toBe("untitled");
  });
});
