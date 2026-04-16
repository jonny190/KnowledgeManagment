import { z } from "zod";
import type { AiTool } from "../types";

function computeChildPath(parentPath: string, childName: string): string {
  return parentPath.length === 0 ? childName : `${parentPath}/${childName}`;
}

const createFolderArgs = z.object({
  vaultId: z.string().cuid(),
  name: z.string().min(1).max(120),
  parentId: z.string().cuid().optional(),
});

export interface CreateFolderResult {
  folderId: string;
  path: string;
  undo: { kind: "create_folder"; id: string };
}

export const createFolder: AiTool<z.infer<typeof createFolderArgs>, CreateFolderResult> = {
  name: "createFolder",
  description:
    "Create a new folder in the current vault. If parentId is omitted the folder lives at the vault root.",
  jsonSchema: {
    type: "object",
    properties: {
      vaultId: { type: "string" },
      name: { type: "string", maxLength: 120 },
      parentId: { type: "string" },
    },
    required: ["vaultId", "name"],
  },
  parse: (raw) => createFolderArgs.parse(raw),
  async execute(args, ctx) {
    if (args.vaultId !== ctx.vaultId) {
      throw new Error("createFolder: vaultId does not match conversation vault");
    }
    let parentPath = "";
    if (args.parentId) {
      const parent = await ctx.prisma.folder.findUnique({
        where: { id: args.parentId },
        select: { vaultId: true, path: true },
      });
      if (!parent || parent.vaultId !== args.vaultId) {
        throw new Error("createFolder: parent folder not in this vault");
      }
      parentPath = parent.path;
    }
    const folder = await ctx.prisma.folder.create({
      data: {
        vaultId: args.vaultId,
        parentId: args.parentId ?? null,
        name: args.name,
        path: computeChildPath(parentPath, args.name),
      },
    });
    return {
      folderId: folder.id,
      path: folder.path,
      undo: { kind: "create_folder", id: folder.id },
    };
  },
};
