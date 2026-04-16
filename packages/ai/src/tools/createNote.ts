import { z } from "zod";
import { slugify } from "@km/shared";
import type { AiTool } from "../types";

// Dynamic import of recomputeLinksAndTags: the helper lives in apps/web to stay
// close to the human PATCH pipeline. @km/ai must not statically depend on the
// web app, so we accept an injected recompute function from the caller via a
// module-level hook that the web route installs at boot.
type RecomputeFn = (
  tx: unknown,
  noteId: string,
  vaultId: string,
  markdown: string,
) => Promise<void>;
let recomputeHook: RecomputeFn | null = null;
export function setRecomputeHook(fn: RecomputeFn): void {
  recomputeHook = fn;
}
export function __resetRecomputeHookForTests(): void {
  recomputeHook = null;
}

const createNoteArgs = z.object({
  vaultId: z.string().cuid(),
  title: z.string().min(1).max(200),
  content: z.string().max(100_000).optional(),
  folderId: z.string().cuid().optional(),
});

export interface CreateNoteResult {
  noteId: string;
  title: string;
  slug: string;
  undo: { kind: "create_note"; id: string };
}

export const createNote: AiTool<z.infer<typeof createNoteArgs>, CreateNoteResult> = {
  name: "createNote",
  description:
    "Create a new note in the current vault with the given title and optional initial markdown content. Returns the new note id. Prefer this over asking the user to create a note when they requested one.",
  jsonSchema: {
    type: "object",
    properties: {
      vaultId: { type: "string" },
      title: { type: "string", maxLength: 200 },
      content: { type: "string", maxLength: 100_000 },
      folderId: { type: "string" },
    },
    required: ["vaultId", "title"],
  },
  parse: (raw) => createNoteArgs.parse(raw),
  async execute(args, ctx) {
    if (args.vaultId !== ctx.vaultId) {
      throw new Error("createNote: vaultId does not match conversation vault");
    }
    const baseSlug = slugify(args.title);
    let slug = baseSlug;
    let suffix = 1;
    while (await ctx.prisma.note.findFirst({ where: { vaultId: args.vaultId, slug } })) {
      suffix += 1;
      slug = `${baseSlug}-${suffix}`;
    }
    const content = args.content ?? "";
    const now = new Date();
    const note = await ctx.prisma.$transaction(async (tx) => {
      const created = await tx.note.create({
        data: {
          vaultId: args.vaultId,
          folderId: args.folderId ?? null,
          title: args.title,
          slug,
          content,
          contentUpdatedAt: now,
          createdById: ctx.userId,
          updatedById: ctx.userId,
        },
      });
      if (content.length > 0 && recomputeHook) {
        await recomputeHook(tx, created.id, args.vaultId, content);
      }
      return created;
    });
    return {
      noteId: note.id,
      title: note.title,
      slug: note.slug,
      undo: { kind: "create_note", id: note.id },
    };
  },
};
