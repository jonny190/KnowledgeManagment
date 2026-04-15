import type { InviteEmailData } from "../types";

export function renderInvite(data: InviteEmailData) {
  const subject = `You were invited to ${data.workspaceName}`;
  const text = `${data.inviterName} invited you to join the workspace "${data.workspaceName}".

Accept the invite:

${data.acceptUrl}`;
  const html = `<p>${escapeHtml(data.inviterName)} invited you to join the workspace "${escapeHtml(data.workspaceName)}".</p>
<p><a href="${escapeAttr(data.acceptUrl)}">Accept the invite</a></p>`;
  return { subject, text, html };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function escapeAttr(s: string) {
  return escapeHtml(s);
}
