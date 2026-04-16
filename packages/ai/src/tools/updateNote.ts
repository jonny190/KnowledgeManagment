import { z } from "zod";
import type { AiTool } from "../types";
import { applyAdminUpdate } from "../admin-client";

const updateNoteArgs = z.object({
  noteId: z.string().cuid(),
  content: z.string().max(100_000),
  mode: z.enum(["append", "replace"]),
});

export type UpdateNoteResult =
  | { noteId: string; undo: null }
  | { error: "not_found" };

export const updateNote: AiTool<z.infer<typeof updateNoteArgs>, UpdateNoteResult> = {
  name: "updateNote",
  description:
    "Append text to, or fully replace the content of, an existing note in the current vault. Prefer mode 'append' unless the user asked for a rewrite.",
  jsonSchema: {
    type: "object",
    properties: {
      noteId: { type: "string" },
      content: { type: "string", maxLength: 100_000 },
      mode: { type: "string", enum: ["append", "replace"] },
    },
    required: ["noteId", "content", "mode"],
  },
  parse: (raw) => updateNoteArgs.parse(raw),
  async execute(args, ctx) {
    if (!ctx.adminSecret || !ctx.realtimeUrl) {
      throw new Error("updateNote: realtime admin is not configured");
    }
    const note = await ctx.prisma.note.findUnique({
      where: { id: args.noteId },
      select: { id: true, vaultId: true },
    });
    if (!note) return { error: "not_found" };
    if (note.vaultId !== ctx.vaultId) {
      throw new Error("updateNote: note is not in this vault");
    }
    const { getNoteAuthzHook } = await import("./noteAuthzHook");
    const hook = getNoteAuthzHook();
    if (hook) {
      try {
        await hook(ctx.userId, note.id, "EDIT");
      } catch {
        return { error: "not_found" };
      }
    }
    await applyAdminUpdate({
      realtimeUrl: ctx.realtimeUrl,
      adminSecret: ctx.adminSecret,
      noteId: note.id,
      op: args.mode,
      text: args.content,
    });
    return { noteId: note.id, undo: null };
  },
};
