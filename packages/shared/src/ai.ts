import { z } from "zod";

export const aiCommandName = z.enum(["summarize", "expand", "rewrite", "translate"]);
export type AiCommandName = z.infer<typeof aiCommandName>;

export const aiChatRequest = z.object({
  conversationId: z.string().min(1),
  message: z.string().min(1).max(8000),
});
export type AiChatRequest = z.infer<typeof aiChatRequest>;

export const aiCommandRequest = z.object({
  conversationId: z.string().min(1),
  command: aiCommandName,
  selection: z.string().min(1).max(8000),
  language: z.string().min(1).max(64).optional(),
});
export type AiCommandRequest = z.infer<typeof aiCommandRequest>;

export const aiSseEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready"), conversationId: z.string(), messageId: z.string() }),
  z.object({ type: z.literal("text"), delta: z.string() }),
  z.object({ type: z.literal("tool_use"), id: z.string(), name: z.string(), args: z.unknown() }),
  z.object({
    type: z.literal("tool_result"),
    id: z.string(),
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z.string().optional(),
  }),
  z.object({
    type: z.literal("tool_result_undoable"),
    callId: z.string(),
    summary: z.string(),
    undo: z
      .object({
        kind: z.enum(["create_note", "create_folder"]),
        id: z.string(),
      })
      .nullable(),
  }),
  z.object({
    type: z.literal("usage"),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cachedTokens: z.number().int().nonnegative(),
    model: z.string(),
  }),
  z.object({ type: z.literal("done") }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
]);
export type AiSseEvent = z.infer<typeof aiSseEvent>;
