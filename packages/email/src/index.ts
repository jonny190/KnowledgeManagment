import type { EmailProvider, SendEmailPayload, SendEmailResult } from "./types.js";
import { ConsoleEmailProvider } from "./providers/console.js";
import { GraphEmailProvider } from "./providers/graph.js";

export * from "./types.js";
export { hashToken, generateRawToken, isExpired } from "./tokens.js";

let cached: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (cached) return cached;
  const choice = process.env.EMAIL_PROVIDER ?? "console";
  if (choice === "graph") {
    cached = new GraphEmailProvider();
  } else {
    cached = new ConsoleEmailProvider();
  }
  return cached;
}

export async function sendEmail(payload: SendEmailPayload): Promise<SendEmailResult> {
  return getEmailProvider().send(payload);
}

export function __resetProviderForTests() {
  cached = null;
}
