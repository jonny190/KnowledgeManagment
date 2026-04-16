import { prisma } from "@km/db";
import { AuthzError } from "./authz";

export type RequiredNoteRole = "VIEW" | "EDIT" | "OWNER";

export type EffectiveNoteRole = "VIEW" | "EDIT" | "OWNER";

export type NoteAccessGrantedBy =
  | { kind: "personal_owner" }
  | { kind: "note_owner" }
  | { kind: "workspace"; role: "OWNER" | "ADMIN" | "MEMBER" }
  | { kind: "share"; role: "VIEW" | "EDIT" };

export interface NoteAccess {
  note: {
    id: string;
    vaultId: string;
    visibility: "WORKSPACE" | "PRIVATE";
    createdById: string;
  };
  grantedBy: NoteAccessGrantedBy;
  effectiveRole: EffectiveNoteRole;
}

const ROLE_RANK: Record<EffectiveNoteRole, number> = { VIEW: 1, EDIT: 2, OWNER: 3 };

function satisfies(effective: EffectiveNoteRole, required: RequiredNoteRole): boolean {
  return ROLE_RANK[effective] >= ROLE_RANK[required];
}

export async function assertCanAccessNote(
  userId: string,
  noteId: string,
  required: RequiredNoteRole,
): Promise<NoteAccess> {
  if (!userId) throw new AuthzError("Not authenticated", 401);

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
  if (!note) throw new AuthzError("Note not found", 404);

  const noteOut = {
    id: note.id,
    vaultId: note.vaultId,
    visibility: note.visibility as "WORKSPACE" | "PRIVATE",
    createdById: note.createdById,
  };

  // 1. Note creator always OWNER.
  if (note.createdById === userId) {
    const access: NoteAccess = {
      note: noteOut,
      grantedBy: { kind: "note_owner" },
      effectiveRole: "OWNER",
    };
    if (!satisfies(access.effectiveRole, required)) throw new AuthzError("Forbidden");
    return access;
  }

  // 2. Personal vault owner.
  if (note.vault.ownerType === "USER" && note.vault.ownerId === userId) {
    const access: NoteAccess = {
      note: noteOut,
      grantedBy: { kind: "personal_owner" },
      effectiveRole: "OWNER",
    };
    if (!satisfies(access.effectiveRole, required)) throw new AuthzError("Forbidden");
    return access;
  }

  // 3. Explicit share row.
  const share = await prisma.noteShare.findUnique({
    where: { noteId_userId: { noteId: note.id, userId } },
    select: { role: true },
  });
  if (share) {
    const effective = share.role as "VIEW" | "EDIT";
    const access: NoteAccess = {
      note: noteOut,
      grantedBy: { kind: "share", role: effective },
      effectiveRole: effective,
    };
    if (!satisfies(access.effectiveRole, required)) throw new AuthzError("Forbidden");
    return access;
  }

  // 4. Workspace visibility fallback.
  if (note.vault.ownerType === "WORKSPACE" && noteOut.visibility === "WORKSPACE") {
    const membership = await prisma.membership.findFirst({
      where: { workspaceId: note.vault.ownerId, userId },
      select: { role: true },
    });
    if (membership) {
      const wsRole = membership.role as "OWNER" | "ADMIN" | "MEMBER";
      const effective: EffectiveNoteRole = wsRole === "MEMBER" ? "EDIT" : "OWNER";
      const access: NoteAccess = {
        note: noteOut,
        grantedBy: { kind: "workspace", role: wsRole },
        effectiveRole: effective,
      };
      if (!satisfies(access.effectiveRole, required)) throw new AuthzError("Forbidden");
      return access;
    }
  }

  throw new AuthzError("Forbidden");
}
