import { NextResponse } from "next/server";
import { prisma } from "@km/db";
import { requireUserId } from "@/lib/session";
import { enqueueSendEmail } from "@/lib/email-jobs";

export async function POST() {
  const userId = await requireUserId();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user && !user.emailVerified) {
    await enqueueSendEmail({ kind: "VERIFY_EMAIL", userId: user.id });
  }
  return NextResponse.json({ ok: true });
}
