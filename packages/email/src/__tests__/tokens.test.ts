import { describe, expect, it } from "vitest";
import { generateRawToken, hashToken, isExpired } from "../tokens";

describe("email tokens", () => {
  it("generates URL-safe tokens of at least 32 chars", () => {
    const t = generateRawToken();
    expect(t.length).toBeGreaterThanOrEqual(32);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("hashes deterministically with sha256 hex", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).toHaveLength(64);
    expect(hashToken("abc")).not.toEqual(hashToken("abd"));
  });

  it("isExpired true when expiresAt is in the past", () => {
    expect(isExpired(new Date(Date.now() - 1000))).toBe(true);
    expect(isExpired(new Date(Date.now() + 60_000))).toBe(false);
  });
});
