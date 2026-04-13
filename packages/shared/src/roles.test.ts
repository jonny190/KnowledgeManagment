import { describe, it, expect } from "vitest";
import { roleAtLeast, ROLE_RANK } from "./roles";

describe("roleAtLeast", () => {
  it("OWNER satisfies every requirement", () => {
    expect(roleAtLeast("OWNER", "OWNER")).toBe(true);
    expect(roleAtLeast("OWNER", "ADMIN")).toBe(true);
    expect(roleAtLeast("OWNER", "MEMBER")).toBe(true);
  });

  it("ADMIN satisfies ADMIN and MEMBER but not OWNER", () => {
    expect(roleAtLeast("ADMIN", "OWNER")).toBe(false);
    expect(roleAtLeast("ADMIN", "ADMIN")).toBe(true);
    expect(roleAtLeast("ADMIN", "MEMBER")).toBe(true);
  });

  it("MEMBER only satisfies MEMBER", () => {
    expect(roleAtLeast("MEMBER", "OWNER")).toBe(false);
    expect(roleAtLeast("MEMBER", "ADMIN")).toBe(false);
    expect(roleAtLeast("MEMBER", "MEMBER")).toBe(true);
  });

  it("ROLE_RANK orders OWNER > ADMIN > MEMBER", () => {
    expect(ROLE_RANK.OWNER).toBeGreaterThan(ROLE_RANK.ADMIN);
    expect(ROLE_RANK.ADMIN).toBeGreaterThan(ROLE_RANK.MEMBER);
  });
});
