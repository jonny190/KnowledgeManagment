import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@km/db";
import { hashToken } from "@km/email/tokens";
import { makeVaultWithNotes } from "@/test/factories";
import { consumeEmailToken } from "@/lib/email-tokens";

describe("consumeEmailToken", () => {
  beforeEach(async () => {
    await prisma.emailToken.deleteMany();
    await prisma.user.deleteMany();
  });

  it("consumes a valid VERIFY_EMAIL token exactly once", async () => {
    const { user } = await makeVaultWithNotes([]);
    const raw = "raw-token-1";
    await prisma.emailToken.create({
      data: {
        userId: user.id,
        email: user.email,
        kind: "VERIFY_EMAIL",
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const result = await consumeEmailToken(raw, "VERIFY_EMAIL");
    expect(result.ok).toBe(true);
    expect(result.ok && result.userId).toBe(user.id);
    const second = await consumeEmailToken(raw, "VERIFY_EMAIL");
    expect(second.ok).toBe(false);
    expect(!second.ok && second.reason).toBe("already_consumed");
  });

  it("rejects expired tokens", async () => {
    const { user } = await makeVaultWithNotes([]);
    const raw = "raw-token-2";
    await prisma.emailToken.create({
      data: {
        userId: user.id,
        email: user.email,
        kind: "PASSWORD_RESET",
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const r = await consumeEmailToken(raw, "PASSWORD_RESET");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("expired");
  });

  it("returns not_found for unknown token", async () => {
    const r = await consumeEmailToken("no-such-token", "VERIFY_EMAIL");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("not_found");
  });
});
