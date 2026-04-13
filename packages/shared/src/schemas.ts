import { z } from "zod";

export const createWorkspaceInput = z.object({
  name: z.string().min(1).max(80),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInput>;

export const createInviteInput = z.object({
  email: z.string().email(),
  role: z.enum(["ADMIN", "MEMBER"]),
});
export type CreateInviteInput = z.infer<typeof createInviteInput>;

export const createFolderInput = z.object({
  vaultId: z.string().cuid(),
  parentId: z.string().cuid().nullable().optional(),
  name: z.string().min(1).max(120),
});
export type CreateFolderInput = z.infer<typeof createFolderInput>;

export const updateFolderInput = z.object({
  name: z.string().min(1).max(120).optional(),
  parentId: z.string().cuid().nullable().optional(),
});
export type UpdateFolderInput = z.infer<typeof updateFolderInput>;

export const createNoteInput = z.object({
  vaultId: z.string().cuid(),
  folderId: z.string().cuid().nullable().optional(),
  title: z.string().min(1).max(200),
  content: z.string().default(""),
});
export type CreateNoteInput = z.infer<typeof createNoteInput>;

export const updateNoteInput = z.object({
  title: z.string().min(1).max(200).optional(),
  folderId: z.string().cuid().nullable().optional(),
  content: z.string().optional(),
});
export type UpdateNoteInput = z.infer<typeof updateNoteInput>;

export const searchNotesQuery = z.object({
  vaultId: z.string().cuid(),
  q: z.string().min(1).max(200),
});
export type SearchNotesQuery = z.infer<typeof searchNotesQuery>;
