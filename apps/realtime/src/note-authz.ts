import { prisma } from "./prisma.js";

export type RealtimeRequiredRole = "VIEW" | "EDIT" | "OWNER";

export interface RealtimeNoteAccess {
  noteId: string;
  vaultId: string;
  effectiveRole: "VIEW" | "EDIT" | "OWNER";
}

const RANK: Record<"VIEW" | "EDIT" | "OWNER", number> = { VIEW: 1, EDIT: 2, OWNER: 3 };

export async function assertCanAccessNoteForRealtime(
  userId: string,
  noteId: string,
  required: RealtimeRequiredRole,
): Promise<RealtimeNoteAccess> {
  if (!userId) throw new Error("not authenticated");
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: {
      id: true,
      vaultId: true,
      visibility: true,
      createdById: true,
      vault: { select: { ownerType: true, ownerId: true } },
    },
  });
  if (!note) throw new Error("note not found");

  const ok = (eff: "VIEW" | "EDIT" | "OWNER"): RealtimeNoteAccess => {
    if (RANK[eff] < RANK[required]) throw new Error("forbidden");
    return { noteId: note.id, vaultId: note.vaultId, effectiveRole: eff };
  };

  if (note.createdById === userId) return ok("OWNER");
  if (note.vault.ownerType === "USER" && note.vault.ownerId === userId) return ok("OWNER");

  const share = await prisma.noteShare.findUnique({
    where: { noteId_userId: { noteId: note.id, userId } },
    select: { role: true },
  });
  if (share) return ok(share.role as "VIEW" | "EDIT");

  if (note.vault.ownerType === "WORKSPACE" && note.visibility === "WORKSPACE") {
    const m = await prisma.membership.findFirst({
      where: { workspaceId: note.vault.ownerId, userId },
      select: { role: true },
    });
    if (m) return ok(m.role === "MEMBER" ? "EDIT" : "OWNER");
  }

  throw new Error("forbidden");
}
