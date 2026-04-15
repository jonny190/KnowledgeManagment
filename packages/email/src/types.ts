export type EmailKind = "VERIFY_EMAIL" | "PASSWORD_RESET" | "INVITE";

export interface VerifyEmailData {
  verifyUrl: string;
  userDisplayName?: string | null;
}

export interface PasswordResetData {
  resetUrl: string;
  userDisplayName?: string | null;
}

export interface InviteEmailData {
  acceptUrl: string;
  workspaceName: string;
  inviterName: string;
}

export type SendEmailPayload =
  | { to: string; kind: "VERIFY_EMAIL"; data: VerifyEmailData }
  | { to: string; kind: "PASSWORD_RESET"; data: PasswordResetData }
  | { to: string; kind: "INVITE"; data: InviteEmailData };

export interface SendEmailResult {
  providerId: string;
  provider: "console" | "graph";
}

export interface EmailProvider {
  send(payload: SendEmailPayload): Promise<SendEmailResult>;
}
