import { describe, it, expect } from "vitest";
import { buildCommandUserMessage } from "../src/commands";

describe("buildCommandUserMessage", () => {
  it("templates summarize", () => {
    const msg = buildCommandUserMessage("summarize", { selection: "hello world" });
    expect(msg).toContain("Summarise");
    expect(msg).toContain("hello world");
  });

  it("templates expand", () => {
    expect(buildCommandUserMessage("expand", { selection: "x" })).toContain("Expand");
  });

  it("templates rewrite", () => {
    expect(buildCommandUserMessage("rewrite", { selection: "x" })).toContain("Rewrite");
  });

  it("templates translate with a language", () => {
    const msg = buildCommandUserMessage("translate", { selection: "hi", language: "French" });
    expect(msg).toContain("French");
    expect(msg).toContain("hi");
  });

  it("throws if translate is missing a language", () => {
    expect(() => buildCommandUserMessage("translate", { selection: "hi" })).toThrow();
  });
});
