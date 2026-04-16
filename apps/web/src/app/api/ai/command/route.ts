import { prisma } from "@km/db";
import type { AiTool } from "@km/ai";
import {
  ALL_TOOLS,
  AiBudgetExceededError,
  SYSTEM_PROMPT,
  buildCommandUserMessage,
  enforceDailyBudget,
  getProvider,
  recordUsage,
  runChat,
  setRecomputeHook,
} from "@km/ai";
import { aiCommandRequest, type AiSseEvent } from "@km/shared";
import { requireUserId } from "@/lib/session";
import { assertCanAccessVault } from "@/lib/authz";
import { recomputeLinksAndTags } from "@/lib/links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_LIMIT = Number(process.env.AI_DAILY_TOKEN_LIMIT ?? 200000);
const REQUEST_LIMIT = Number(process.env.AI_DAILY_REQUEST_LIMIT ?? 200);
const MAX_TOOL_HOPS = Number(process.env.AI_MAX_TOOL_HOPS ?? 8);

let hookInstalled = false;
function ensureRecomputeHook() {
  if (hookInstalled) return;
  setRecomputeHook(async (tx, noteId, vaultId, markdown) => {
    await recomputeLinksAndTags(
      tx as Parameters<typeof recomputeLinksAndTags>[0],
      noteId,
      vaultId,
      markdown,
    );
  });
  hookInstalled = true;
}

function sseEncoder() {
  const encoder = new TextEncoder();
  return (event: AiSseEvent) =>
    encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  const parsed = aiCommandRequest.parse(await req.json());

  const conversation = await prisma.aiConversation.findUniqueOrThrow({
    where: { id: parsed.conversationId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  await assertCanAccessVault(userId, conversation.vaultId, "MEMBER");

  try {
    await enforceDailyBudget(prisma, userId, {
      tokenLimit: TOKEN_LIMIT,
      requestLimit: REQUEST_LIMIT,
    });
  } catch (err) {
    if (err instanceof AiBudgetExceededError) {
      return new Response(JSON.stringify({ code: "budget_exceeded", reason: err.reason }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    }
    throw err;
  }

  const templated = buildCommandUserMessage(parsed.command, {
    selection: parsed.selection,
    language: parsed.language,
  });

  const userMessage = await prisma.aiMessage.create({
    data: {
      conversationId: conversation.id,
      role: "USER",
      content: [{ type: "text", text: templated }],
    },
  });

  const history: Array<{ role: "user" | "assistant" | "tool"; content: unknown }> = [
    ...conversation.messages.map((m) => ({
      role: m.role.toLowerCase() as "user" | "assistant" | "tool",
      content: m.content as unknown,
    })),
    { role: "user", content: templated },
  ];

  ensureRecomputeHook();
  const provider = getProvider();
  const controller = new AbortController();
  const encode = sseEncoder();
  let totalUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, model: provider.model };
  const collected: Array<unknown> = [];

  const stream = new ReadableStream<Uint8Array>({
    async start(streamCtl) {
      const send = (event: AiSseEvent) => streamCtl.enqueue(encode(event));
      send({ type: "ready", conversationId: conversation.id, messageId: userMessage.id });
      try {
        totalUsage = await runChat({
          provider,
          tools: ALL_TOOLS as AiTool[],
          systemPrompt: SYSTEM_PROMPT,
          history,
          ctx: {
            userId,
            vaultId: conversation.vaultId,
            prisma,
            realtimeUrl: process.env.REALTIME_INTERNAL_URL ?? "http://localhost:3001",
            adminSecret: process.env.REALTIME_ADMIN_SECRET ?? "",
          },
          maxToolHops: MAX_TOOL_HOPS,
          signal: controller.signal,
          emit: (event) => {
            if (event.type === "text") {
              collected.push({ type: "text", text: event.delta });
            }
            send(event);
          },
        });
        send({
          type: "usage",
          inputTokens: totalUsage.inputTokens,
          outputTokens: totalUsage.outputTokens,
          cachedTokens: totalUsage.cachedTokens,
          model: totalUsage.model,
        });
        send({ type: "done" });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: "error", code: "stream_failed", message });
      } finally {
        try {
          await prisma.aiMessage.create({
            data: {
              conversationId: conversation.id,
              role: "ASSISTANT",
              content: collected as never,
              inputTokens: totalUsage.inputTokens,
              outputTokens: totalUsage.outputTokens,
              cachedTokens: totalUsage.cachedTokens,
              model: totalUsage.model,
            },
          });
          await recordUsage(prisma, {
            userId,
            vaultId: conversation.vaultId,
            inputTokens: totalUsage.inputTokens,
            outputTokens: totalUsage.outputTokens,
            cachedTokens: totalUsage.cachedTokens,
          });
        } finally {
          streamCtl.close();
        }
      }
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    },
  });
}
