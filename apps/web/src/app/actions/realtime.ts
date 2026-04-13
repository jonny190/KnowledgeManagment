"use server";

import jwt from "jsonwebtoken";
import { nanoid } from "nanoid";
import { prisma } from "@km/db";
import { requireUserId } from "@/lib/session";
import { assertCanAccessVault } from "@/lib/authz";

const TTL_SECONDS = 300;

export async function issueRealtimeToken(noteId: string): Promise<string> {
  const secret = process.env.REALTIME_JWT_SECRET;
  if (!secret) throw new Error("REALTIME_JWT_SECRET not set");

  const userId = await requireUserId();

  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { id: true, vaultId: true },
  });
  if (!note) throw new Error("Note not found");

  const { role } = await assertCanAccessVault(userId, note.vaultId, "MEMBER");

  const jti = nanoid(21);
  const now = Math.floor(Date.now() / 1000);
  const exp = now + TTL_SECONDS;

  const payload = { jti, sub: userId, nid: note.id, vid: note.vaultId, role, exp };
  const token = jwt.sign(payload, secret, { algorithm: "HS256", noTimestamp: true });

  await prisma.realtimeGrant.create({
    data: {
      jti,
      userId,
      noteId: note.id,
      expiresAt: new Date(exp * 1000),
    },
  });

  return token;
}
