import { describe, expect, it, beforeEach, vi, afterAll } from "vitest";
import { prisma } from "@km/db";
import { __resetProviderForTests } from "@km/email";
import { handleSendEmail } from "../src/jobs/send-email.js";
import { createUser, createWorkspace, createInvite } from "./factories.js";
import type { Job } from "pg-boss";
import type { SendEmailJobData } from "../src/jobs/send-email.js";

async function resetDb() {
  await prisma.$transaction([
    prisma.emailToken.deleteMany(),
    prisma.invite.deleteMany(),
    prisma.membership.deleteMany(),
    prisma.workspace.deleteMany(),
    prisma.vault.deleteMany(),
    prisma.folder.deleteMany(),
    prisma.session.deleteMany(),
    prisma.account.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

beforeEach(async () => {
  process.env.EMAIL_PROVIDER = "console";
  process.env.APP_URL = "https://app.test";
  __resetProviderForTests();
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

function makeJob(data: SendEmailJobData): Job<SendEmailJobData> {
  return { id: "test-job", data } as unknown as Job<SendEmailJobData>;
}

describe("handleSendEmail", () => {
  it("creates a VERIFY_EMAIL token and sends via console", async () => {
    const user = await createUser({ email: "v@b.com" });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleSendEmail(makeJob({ kind: "VERIFY_EMAIL", userId: user.id }));
    const token = await prisma.emailToken.findFirst({ where: { userId: user.id } });
    expect(token?.kind).toBe("VERIFY_EMAIL");
    expect(token?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(JSON.stringify(spy.mock.calls)).toContain("verify-email?token=");
    spy.mockRestore();
  });

  it("creates a PASSWORD_RESET token and sends via console", async () => {
    const user = await createUser({ email: "pr@b.com" });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleSendEmail(makeJob({ kind: "PASSWORD_RESET", userId: user.id }));
    const token = await prisma.emailToken.findFirst({ where: { userId: user.id } });
    expect(token?.kind).toBe("PASSWORD_RESET");
    expect(JSON.stringify(spy.mock.calls)).toContain("reset?token=");
    spy.mockRestore();
  });

  it("enforces rate limit of 3 per 10 minutes per (email, kind)", async () => {
    const user = await createUser({ email: "r@b.com" });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    for (let i = 0; i < 3; i++) {
      await handleSendEmail(makeJob({ kind: "PASSWORD_RESET", userId: user.id }));
    }
    await handleSendEmail(makeJob({ kind: "PASSWORD_RESET", userId: user.id }));
    const count = await prisma.emailToken.count({
      where: { userId: user.id, kind: "PASSWORD_RESET" },
    });
    expect(count).toBe(3);
    const allCalls = spy.mock.calls.map((c) => String(c[0]));
    const warns = allCalls.filter((c) => c.includes("[email:rate-limited]"));
    expect(warns.length).toBe(1);
    spy.mockRestore();
  });

  it("sends an INVITE using the existing Invite row without creating an EmailToken", async () => {
    const inviter = await createUser({ email: "inv@b.com", name: "Alice" });
    const workspace = await createWorkspace(inviter.id, "Acme");
    const invite = await createInvite({ email: "guest@b.com", workspaceId: workspace.id });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleSendEmail(makeJob({ kind: "INVITE", inviteId: invite.id }));
    const tokens = await prisma.emailToken.count();
    expect(tokens).toBe(0);
    expect(JSON.stringify(spy.mock.calls)).toContain("guest@b.com");
    spy.mockRestore();
  });
});
