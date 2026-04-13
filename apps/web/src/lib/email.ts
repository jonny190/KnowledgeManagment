export interface InviteEmailPayload {
  to: string;
  workspaceName: string;
  acceptUrl: string;
  inviterName: string | null;
}

export async function sendInviteEmail(p: InviteEmailPayload): Promise<void> {
  // v1: log to console. A later phase wires this to a real provider.
  console.log(
    `[invite] to=${p.to} workspace=${p.workspaceName} inviter=${p.inviterName ?? "unknown"} url=${p.acceptUrl}`
  );
}
