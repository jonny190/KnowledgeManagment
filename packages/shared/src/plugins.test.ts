import { describe, it, expect } from "vitest";
import { pluginDefinitionSchema } from "./plugins";

describe("pluginDefinitionSchema", () => {
  it("accepts a valid definition", () => {
    const d = pluginDefinitionSchema.parse({
      id: "wordcount",
      name: "Word count",
      version: "1.0.0",
      activate: () => {},
    });
    expect(d.id).toBe("wordcount");
  });

  it("rejects missing activate", () => {
    expect(() =>
      pluginDefinitionSchema.parse({ id: "x", name: "X", version: "1.0.0" }),
    ).toThrow();
  });
});
