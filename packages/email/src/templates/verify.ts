import type { VerifyEmailData } from "../types";

export function renderVerify(data: VerifyEmailData) {
  const subject = "Verify your email";
  const text = `Hi${data.userDisplayName ? " " + data.userDisplayName : ""},

Confirm your email by opening this link:

${data.verifyUrl}

If you did not sign up, ignore this message.`;
  const html = `<p>Hi${data.userDisplayName ? " " + escapeHtml(data.userDisplayName) : ""},</p>
<p>Confirm your email by opening this link:</p>
<p><a href="${escapeAttr(data.verifyUrl)}">${escapeHtml(data.verifyUrl)}</a></p>
<p>If you did not sign up, ignore this message.</p>`;
  return { subject, text, html };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function escapeAttr(s: string) {
  return escapeHtml(s);
}
