import { describe, it, expect } from "vitest";
import { userColor } from "./userColor";

describe("userColor", () => {
  it("returns a deterministic hsl string per userId", () => {
    const a = userColor("abc");
    const b = userColor("abc");
    expect(a).toBe(b);
    expect(a).toMatch(/^hsl\(\d{1,3}, 70%, 50%\)$/);
  });

  it("differs for different ids", () => {
    expect(userColor("a")).not.toBe(userColor("b"));
  });
});
