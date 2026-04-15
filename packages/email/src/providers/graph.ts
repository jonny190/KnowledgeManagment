import type { EmailProvider, SendEmailPayload, SendEmailResult } from "../types.js";
import { renderVerify } from "../templates/verify.js";
import { renderReset } from "../templates/reset.js";
import { renderInvite } from "../templates/invite.js";

export class GraphError extends Error {
  terminal: boolean;
  status: number;
  constructor(status: number, msg: string, terminal: boolean) {
    super(msg);
    this.status = status;
    this.terminal = terminal;
  }
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

export function __resetGraphCacheForTests() {
  cachedToken = null;
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }
  const tenant = requireEnv("GRAPH_TENANT_ID");
  const clientId = requireEnv("GRAPH_CLIENT_ID");
  const clientSecret = requireEnv("GRAPH_CLIENT_SECRET");
  const url = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new GraphError(res.status, `token endpoint failed: ${text}`, res.status === 401 || res.status === 403);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    accessToken: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return cachedToken.accessToken;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new GraphError(500, `missing env var ${name}`, true);
  return v;
}

export class GraphEmailProvider implements EmailProvider {
  async send(payload: SendEmailPayload): Promise<SendEmailResult> {
    const mailbox = requireEnv("EMAIL_FROM_MAILBOX");
    const fromName = process.env.EMAIL_FROM_NAME ?? "";
    const rendered = render(payload);
    const token = await getAccessToken();

    const messageBody = {
      message: {
        subject: rendered.subject,
        body: { contentType: "HTML", content: rendered.html },
        toRecipients: [{ emailAddress: { address: payload.to } }],
        from: {
          emailAddress: {
            address: mailbox,
            ...(fromName ? { name: fromName } : {}),
          },
        },
      },
      saveToSentItems: false,
    };

    const url = `https://graph.microsoft.com/v1.0/users/${mailbox}/sendMail`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(messageBody),
    });
    if (res.status === 202) {
      return { providerId: res.headers.get("request-id") ?? `graph-${Date.now()}`, provider: "graph" };
    }
    const text = await res.text();
    const terminal = res.status === 401 || res.status === 403;
    throw new GraphError(res.status, `sendMail failed: ${text}`, terminal);
  }
}

function render(payload: SendEmailPayload) {
  switch (payload.kind) {
    case "VERIFY_EMAIL":
      return renderVerify(payload.data);
    case "PASSWORD_RESET":
      return renderReset(payload.data);
    case "INVITE":
      return renderInvite(payload.data);
  }
}
