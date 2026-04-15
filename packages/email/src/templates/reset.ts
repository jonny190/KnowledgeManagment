import type { PasswordResetData } from "../types.js";

export function renderReset(data: PasswordResetData) {
  const subject = "Reset your password";
  const text = `Someone requested a password reset for your account.

Open this link within the next hour to set a new password:

${data.resetUrl}

If this was not you, ignore this message.`;
  const html = `<p>Someone requested a password reset for your account.</p>
<p>Open this link within the next hour to set a new password:</p>
<p><a href="${escapeAttr(data.resetUrl)}">${escapeHtml(data.resetUrl)}</a></p>
<p>If this was not you, ignore this message.</p>`;
  return { subject, text, html };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function escapeAttr(s: string) {
  return escapeHtml(s);
}
