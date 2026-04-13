import { nanoid } from "nanoid";
import { createHash } from "node:crypto";

export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = nanoid(32);
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return { token, tokenHash };
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
