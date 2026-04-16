import { z } from "zod";
import { computeSnippet } from "@km/shared";
import type { AiTool } from "./types";

const readNoteArgs = z.object({ title: z.string().min(1).max(256) });

export const readNote: AiTool<z.infer<typeof readNoteArgs>, unknown> = {
  name: "readNote",
  description: "Read the markdown content of a note in the current vault by exact title.",
  jsonSchema: {
    type: "object",
    properties: { title: { type: "string" } },
    required: ["title"],
  },
  parse: (raw) => readNoteArgs.parse(raw),
  async execute(args, ctx) {
    const note = await ctx.prisma.note.findFirst({
      where: { vaultId: ctx.vaultId, title: args.title },
      select: { id: true, title: true, content: true, updatedAt: true },
    });
    if (!note) return { error: "not_found" };
    return note;
  },
};

const searchNotesArgs = z.object({
  query: z.string().min(1).max(128),
  limit: z.number().int().min(1).max(25).optional(),
});

export const searchNotes: AiTool<z.infer<typeof searchNotesArgs>, unknown[]> = {
  name: "searchNotes",
  description: "Search notes in the current vault by case-insensitive title prefix.",
  jsonSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 25 },
    },
    required: ["query"],
  },
  parse: (raw) => searchNotesArgs.parse(raw),
  async execute(args, ctx) {
    const rows = await ctx.prisma.note.findMany({
      where: {
        vaultId: ctx.vaultId,
        title: { startsWith: args.query, mode: "insensitive" },
      },
      orderBy: { title: "asc" },
      take: args.limit ?? 10,
      select: { id: true, title: true, content: true },
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      snippet: computeSnippet(r.content, args.query),
    }));
  },
};

const listBacklinksArgs = z.object({ noteId: z.string().min(1) });

export const listBacklinks: AiTool<z.infer<typeof listBacklinksArgs>, unknown[]> = {
  name: "listBacklinks",
  description: "List notes in the current vault that link to the given note id.",
  jsonSchema: {
    type: "object",
    properties: { noteId: { type: "string" } },
    required: ["noteId"],
  },
  parse: (raw) => listBacklinksArgs.parse(raw),
  async execute(args, ctx) {
    const target = await ctx.prisma.note.findFirst({
      where: { id: args.noteId, vaultId: ctx.vaultId },
      select: { id: true, title: true },
    });
    if (!target) {
      throw new Error("noteId not in current vault");
    }
    const links = await ctx.prisma.link.findMany({
      where: { targetNoteId: target.id },
      include: { sourceNote: { select: { id: true, title: true, content: true } } },
    });
    return links
      .filter((l) => l.sourceNote)
      .map((l) => ({
        sourceNoteId: l.sourceNote!.id,
        sourceTitle: l.sourceNote!.title,
        snippet: computeSnippet(l.sourceNote!.content, target.title),
      }));
  },
};

export { createNote, setRecomputeHook, __resetRecomputeHookForTests } from "./tools/createNote";
export { createFolder } from "./tools/createFolder";
export { updateNote } from "./tools/updateNote";

import { createNote as _createNote } from "./tools/createNote";
import { createFolder as _createFolder } from "./tools/createFolder";
import { updateNote as _updateNote } from "./tools/updateNote";

export const ALL_TOOLS = [
  readNote,
  searchNotes,
  listBacklinks,
  _createNote,
  _updateNote,
  _createFolder,
];
