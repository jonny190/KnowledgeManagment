import { createHmac, timingSafeEqual } from "node:crypto";

export interface ApplyAdminUpdateInput {
  realtimeUrl: string;
  adminSecret: string;
  noteId: string;
  op: "append" | "replace";
  text: string;
}

export interface ApplyAdminUpdateResult {
  applied: boolean;
  revision: number;
}

export function computeAdminSignature(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifyAdminSignature(
  secret: string,
  rawBody: string,
  provided: string | null | undefined,
): boolean {
  if (!provided) return false;
  const expected = computeAdminSignature(secret, rawBody);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(
    new Uint8Array(Buffer.from(expected, "hex")),
    new Uint8Array(Buffer.from(provided, "hex")),
  );
}

export async function applyAdminUpdate(
  input: ApplyAdminUpdateInput,
): Promise<ApplyAdminUpdateResult> {
  const body = JSON.stringify({
    noteId: input.noteId,
    op: input.op,
    text: input.text,
    origin: "ai",
  });
  const signature = computeAdminSignature(input.adminSecret, body);
  const res = await fetch(`${input.realtimeUrl}/internal/ydoc/apply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-KM-Admin-Signature": signature,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`realtime admin ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as ApplyAdminUpdateResult;
}
