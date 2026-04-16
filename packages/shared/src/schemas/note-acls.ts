import { z } from "zod";

export const noteVisibility = z.enum(["WORKSPACE", "PRIVATE"]);
export type NoteVisibilityValue = z.infer<typeof noteVisibility>;

export const noteShareRole = z.enum(["VIEW", "EDIT"]);
export type NoteShareRoleValue = z.infer<typeof noteShareRole>;

export const noteShareCreateInput = z.object({
  email: z.string().email().max(254),
  role: noteShareRole,
});
export type NoteShareCreateInput = z.infer<typeof noteShareCreateInput>;

export const noteSharePatchInput = z.object({
  role: noteShareRole,
});
export type NoteSharePatchInput = z.infer<typeof noteSharePatchInput>;

export const noteVisibilityInput = z.object({
  visibility: noteVisibility,
});
export type NoteVisibilityInput = z.infer<typeof noteVisibilityInput>;

export const noteLinkCreateInput = z.object({
  expiresAt: z.string().datetime().optional(),
});
export type NoteLinkCreateInput = z.infer<typeof noteLinkCreateInput>;
