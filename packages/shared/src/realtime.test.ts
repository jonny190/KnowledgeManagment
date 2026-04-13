import { describe, it, expect } from "vitest";
import { realtimeJwtPayload } from "./realtime";

describe("realtimeJwtPayload", () => {
  it("accepts a valid payload", () => {
    const ok = realtimeJwtPayload.parse({
      jti: "abc",
      sub: "user_1",
      nid: "note_1",
      vid: "vault_1",
      role: "MEMBER",
      exp: 1234567890,
    });
    expect(ok.role).toBe("MEMBER");
  });

  it("rejects an unknown role", () => {
    expect(() =>
      realtimeJwtPayload.parse({
        jti: "a",
        sub: "u",
        nid: "n",
        vid: "v",
        role: "GUEST",
        exp: 1,
      }),
    ).toThrow();
  });
});
