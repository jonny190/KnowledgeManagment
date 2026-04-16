import jwt from "jsonwebtoken";
import { realtimeJwtPayload, type RealtimeJwtPayload } from "@km/shared";
import { prisma } from "./prisma.js";
import { assertCanAccessNoteForRealtime } from "./note-authz.js";

export interface RealtimeContext {
  userId: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  vaultId: string;
  noteId: string;
  jti: string;
}

export async function verifyRealtimeToken(
  token: string,
  pathNoteId: string,
): Promise<RealtimeContext> {
  const secret = process.env.REALTIME_JWT_SECRET;
  if (!secret) throw new Error("REALTIME_JWT_SECRET not set");

  let raw: unknown;
  try {
    raw = jwt.verify(token, secret, { algorithms: ["HS256"] });
  } catch (e) {
    throw new Error(`jwt verify failed: ${(e as Error).message}`);
  }

  const payload: RealtimeJwtPayload = realtimeJwtPayload.parse(raw);

  if (payload.nid !== pathNoteId) {
    throw new Error(`nid mismatch: claim=${payload.nid} path=${pathNoteId}`);
  }

  const grant = await prisma.realtimeGrant.findUnique({ where: { jti: payload.jti } });
  if (!grant) throw new Error(`grant not found for jti=${payload.jti}`);
  if (grant.revokedAt) throw new Error(`grant revoked for jti=${payload.jti}`);
  if (grant.expiresAt.getTime() <= Date.now()) throw new Error("grant expired");

  // Re-check note access against live Postgres state.
  const access = await assertCanAccessNoteForRealtime(payload.sub, payload.nid, "EDIT");
  if (access.vaultId !== payload.vid) throw new Error("vault mismatch");

  return {
    userId: payload.sub,
    role: payload.role,
    vaultId: payload.vid,
    noteId: payload.nid,
    jti: payload.jti,
  };
}
