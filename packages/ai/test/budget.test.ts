import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@km/db";
import { AiBudgetExceededError, enforceDailyBudget, recordUsage } from "../src/budget";

async function makeUserAndVault() {
  const user = await prisma.user.create({ data: { email: `u${Date.now()}@t.io` } });
  const vault = await prisma.vault.create({
    data: { ownerType: "USER", ownerId: user.id, name: "V" },
  });
  return { user, vault };
}

describe("budget", () => {
  beforeEach(async () => {
    await prisma.aiUsage.deleteMany({});
    await prisma.vault.deleteMany({});
    await prisma.user.deleteMany({});
  });

  it("allows when no usage row exists", async () => {
    const { user } = await makeUserAndVault();
    await expect(
      enforceDailyBudget(prisma, user.id, { tokenLimit: 1000, requestLimit: 10 }),
    ).resolves.toBeUndefined();
  });

  it("recordUsage upserts and increments", async () => {
    const { user, vault } = await makeUserAndVault();
    await recordUsage(prisma, {
      userId: user.id,
      vaultId: vault.id,
      inputTokens: 10,
      outputTokens: 20,
      cachedTokens: 0,
    });
    await recordUsage(prisma, {
      userId: user.id,
      vaultId: vault.id,
      inputTokens: 5,
      outputTokens: 5,
      cachedTokens: 0,
    });
    const row = await prisma.aiUsage.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.inputTokens).toBe(15);
    expect(row.outputTokens).toBe(25);
    expect(row.requests).toBe(2);
  });

  it("throws AiBudgetExceededError once over the token cap", async () => {
    const { user, vault } = await makeUserAndVault();
    await recordUsage(prisma, {
      userId: user.id,
      vaultId: vault.id,
      inputTokens: 600,
      outputTokens: 500,
      cachedTokens: 0,
    });
    await expect(
      enforceDailyBudget(prisma, user.id, { tokenLimit: 1000, requestLimit: 100 }),
    ).rejects.toBeInstanceOf(AiBudgetExceededError);
  });

  it("throws once over the request cap", async () => {
    const { user, vault } = await makeUserAndVault();
    for (let i = 0; i < 3; i++) {
      await recordUsage(prisma, {
        userId: user.id,
        vaultId: vault.id,
        inputTokens: 1,
        outputTokens: 1,
        cachedTokens: 0,
      });
    }
    await expect(
      enforceDailyBudget(prisma, user.id, { tokenLimit: 100000, requestLimit: 3 }),
    ).rejects.toBeInstanceOf(AiBudgetExceededError);
  });
});
