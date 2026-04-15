import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@km/db";
import { hashToken } from "@km/email/tokens";
import { createUser } from "@/test/factories";
import Page from "@/app/(auth)/verify-email/page";

beforeEach(async () => {
  await prisma.emailToken.deleteMany();
  await prisma.user.deleteMany();
});

describe("VerifyEmailPage", () => {
  it("marks user verified when token is valid", async () => {
    const u = await createUser({ email: "v@x.com", emailVerified: null });
    const raw = "verify-raw-1";
    await prisma.emailToken.create({
      data: {
        userId: u.id,
        email: u.email,
        kind: "VERIFY_EMAIL",
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    // redirect() throws a special Next.js error; catch it so we can check DB state
    await Page({ searchParams: Promise.resolve({ token: raw }) }).catch(() => undefined);
    const after = await prisma.user.findUnique({ where: { id: u.id } });
    expect(after?.emailVerified).not.toBeNull();
  });
});
