import { prisma } from "@km/db";
import type { AiTool } from "@km/ai";
import {
  ALL_TOOLS,
  AiBudgetExceededError,
  SYSTEM_PROMPT,
  enforceDailyBudget,
  getProvider,
  recordUsage,
  runChat,
} from "@km/ai";
import { aiChatRequest, type AiSseEvent } from "@km/shared";
import { requireUserId } from "@/lib/session";
import { assertCanAccessVault } from "@/lib/authz";
import { createHash } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_LIMIT = Number(process.env.AI_DAILY_TOKEN_LIMIT ?? 200000);
const REQUEST_LIMIT = Number(process.env.AI_DAILY_REQUEST_LIMIT ?? 200);
const MAX_TOOL_HOPS = Number(process.env.AI_MAX_TOOL_HOPS ?? 8);

function sseEncoder() {
  const encoder = new TextEncoder();
  return (event: AiSseEvent) =>
    encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  const parsed = aiChatRequest.parse(await req.json());

  const conversation = await prisma.aiConversation.findUniqueOrThrow({
    where: { id: parsed.conversationId },
    include: { note: true, messages: { orderBy: { createdAt: "asc" } } },
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

  const userMessage = await prisma.aiMessage.create({
    data: {
      conversationId: conversation.id,
      role: "USER",
      content: [{ type: "text", text: parsed.message }],
    },
  });

  const note = conversation.note;
  const cachedNoteContext = note
    ? {
        hash: createHash("sha1").update(note.content).digest("hex"),
        text: `# Active note\n\n## Title\n${note.title}\n\n## Body\n${note.content}`,
      }
    : undefined;

  const history: Array<{ role: "user" | "assistant" | "tool"; content: unknown }> = [
    ...conversation.messages.map((m) => ({
      role: m.role.toLowerCase() as "user" | "assistant" | "tool",
      content: m.content as unknown,
    })),
    { role: "user", content: parsed.message },
  ];

  const provider = getProvider();
  const controller = new AbortController();
  const encode = sseEncoder();
  let totalUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, model: provider.model };
  const collectedAssistantBlocks: Array<unknown> = [];

  const stream = new ReadableStream<Uint8Array>({
    async start(streamCtl) {
      const send = (event: AiSseEvent) => streamCtl.enqueue(encode(event));
      send({ type: "ready", conversationId: conversation.id, messageId: userMessage.id });
      try {
        totalUsage = await runChat({
          provider,
          tools: ALL_TOOLS as AiTool[],
          systemPrompt: SYSTEM_PROMPT,
          cachedNoteContext,
          history,
          ctx: { userId, vaultId: conversation.vaultId, prisma },
          maxToolHops: MAX_TOOL_HOPS,
          signal: controller.signal,
          emit: (event) => {
            if (event.type === "text") {
              collectedAssistantBlocks.push({ type: "text", text: event.delta });
            } else if (event.type === "tool_use") {
              collectedAssistantBlocks.push({
                type: "tool_use",
                id: event.id,
                name: event.name,
                input: event.args,
              });
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
              content: collectedAssistantBlocks as never,
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
