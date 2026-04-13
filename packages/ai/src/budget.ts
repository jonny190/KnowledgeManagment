import type { PrismaClient } from "@km/db";

export class AiBudgetExceededError extends Error {
  constructor(public readonly reason: "tokens" | "requests") {
    super(`AI daily budget exceeded: ${reason}`);
    this.name = "AiBudgetExceededError";
  }
}

export interface BudgetLimits {
  tokenLimit: number;
  requestLimit: number;
}

function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function enforceDailyBudget(
  prisma: PrismaClient,
  userId: string,
  limits: BudgetLimits,
): Promise<void> {
  const row = await prisma.aiUsage.findUnique({
    where: { userId_day: { userId, day: todayUtc() } },
  });
  if (!row) return;
  if (row.requests >= limits.requestLimit) {
    throw new AiBudgetExceededError("requests");
  }
  if (row.inputTokens + row.outputTokens >= limits.tokenLimit) {
    throw new AiBudgetExceededError("tokens");
  }
}

export interface UsageDelta {
  userId: string;
  vaultId: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export async function recordUsage(prisma: PrismaClient, delta: UsageDelta): Promise<void> {
  const day = todayUtc();
  await prisma.aiUsage.upsert({
    where: { userId_day: { userId: delta.userId, day } },
    create: {
      userId: delta.userId,
      vaultId: delta.vaultId,
      day,
      inputTokens: delta.inputTokens,
      outputTokens: delta.outputTokens,
      cachedTokens: delta.cachedTokens,
      requests: 1,
    },
    update: {
      inputTokens: { increment: delta.inputTokens },
      outputTokens: { increment: delta.outputTokens },
      cachedTokens: { increment: delta.cachedTokens },
      requests: { increment: 1 },
    },
  });
}
