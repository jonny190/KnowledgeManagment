import type { EmailProvider, SendEmailPayload, SendEmailResult } from "../types.js";
import { renderVerify } from "../templates/verify.js";
import { renderReset } from "../templates/reset.js";
import { renderInvite } from "../templates/invite.js";

export class ConsoleEmailProvider implements EmailProvider {
  async send(payload: SendEmailPayload): Promise<SendEmailResult> {
    const rendered = render(payload);
    const id = `console-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    console.log("[email:console]", {
      id,
      to: payload.to,
      kind: payload.kind,
      subject: rendered.subject,
      text: rendered.text,
    });
    return { providerId: id, provider: "console" };
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
