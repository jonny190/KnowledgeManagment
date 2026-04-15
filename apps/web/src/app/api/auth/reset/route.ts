import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@km/db";
import { consumeEmailToken } from "@/lib/email-tokens";
import { signOutAllSessions } from "@/lib/sessions";

const Body = z.object({
  token: z.string().min(16),
  password: z.string().min(8).max(200),
});

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const result = await consumeEmailToken(parsed.data.token, "PASSWORD_RESET");
  if (!result.ok) {
    const status = result.reason === "already_consumed" || result.reason === "expired" ? 410 : 400;
    return NextResponse.json({ error: result.reason }, { status });
  }
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  await prisma.user.update({
    where: { id: result.userId },
    data: { passwordHash },
  });
  await signOutAllSessions(result.userId);
  return NextResponse.json({ ok: true });
}
