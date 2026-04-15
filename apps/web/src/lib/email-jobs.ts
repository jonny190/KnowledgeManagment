import { getBoss } from "@/lib/queue";

export const SEND_EMAIL_QUEUE = "send-email" as const;

export type SendEmailJob =
  | { kind: "VERIFY_EMAIL"; userId: string }
  | { kind: "PASSWORD_RESET"; userId: string }
  | { kind: "INVITE"; inviteId: string };

export async function enqueueSendEmail(job: SendEmailJob): Promise<string> {
  const boss = await getBoss();
  const id = await boss.send(SEND_EMAIL_QUEUE, job, {
    retryLimit: 5,
    retryBackoff: true,
  });
  if (!id) throw new Error("pg-boss send returned null");
  return id;
}
