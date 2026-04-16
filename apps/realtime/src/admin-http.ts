import type { IncomingMessage, ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { applyAdminUpdate } from "./admin.js";

function verifySignature(secret: string, rawBody: string, provided: string | null): boolean {
  if (!provided) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (expected.length !== provided.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
  } catch {
    return false;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function isAdminRequest(url: string | undefined): boolean {
  return !!url && url.startsWith("/internal/ydoc/apply");
}

export async function handleAdminRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }
  const secret = process.env.REALTIME_ADMIN_SECRET;
  if (!secret) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "admin_secret_not_configured" }));
    return;
  }
  const raw = await readBody(req);
  const sig = (req.headers["x-km-admin-signature"] as string | undefined) ?? null;
  if (!verifySignature(secret, raw, sig)) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "bad_signature" }));
    return;
  }
  let parsed: { noteId?: string; op?: "append" | "replace"; text?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "bad_json" }));
    return;
  }
  if (!parsed.noteId || (parsed.op !== "append" && parsed.op !== "replace") || typeof parsed.text !== "string") {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "bad_body" }));
    return;
  }
  try {
    const result = await applyAdminUpdate({
      noteId: parsed.noteId,
      op: parsed.op,
      text: parsed.text,
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[admin-http] apply failed:", err);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "apply_failed" }));
  }
}
