import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@km/db";
import { enqueueSendEmail } from "@/lib/email-jobs";

const Body = z.object({ email: z.string().email() });

export async function POST(req: Request) {
  let email: string | null = null;
  try {
    const json = await req.json();
    const parsed = Body.safeParse(json);
    if (parsed.success) email = parsed.data.email.toLowerCase();
  } catch {
    // fall through: always 200
  }
  if (email) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      try {
        await enqueueSendEmail({ kind: "PASSWORD_RESET", userId: user.id });
      } catch (err) {
        console.error("[forgot] enqueue failed", err);
      }
    }
  }
  return NextResponse.json({ ok: true });
}
