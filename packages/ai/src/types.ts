import type { PrismaClient } from "@km/db";
import type { AiSseEvent } from "@km/shared";

export interface AiToolContext {
  userId: string;
  vaultId: string;
  prisma: PrismaClient;
}

export interface AiTool<TArgs = unknown, TResult = unknown> {
  name: string;
  description: string;
  jsonSchema: Record<string, unknown>;
  parse: (raw: unknown) => TArgs;
  execute: (args: TArgs, ctx: AiToolContext) => Promise<TResult>;
}

export interface AiUsageRecord {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  model: string;
}

export interface AiProviderRequest {
  systemPrompt: string;
  cachedNoteContext?: { hash: string; text: string };
  history: Array<{ role: "user" | "assistant" | "tool"; content: unknown }>;
  tools: Array<AiTool>;
  signal: AbortSignal;
}

export interface AiProvider {
  name: string;
  model: string;
  stream(
    req: AiProviderRequest,
    ctx: AiToolContext,
    emit: (event: AiSseEvent) => void,
  ): Promise<AiUsageRecord>;
}
