import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@km/db";
import { requireUserId } from "@/lib/session";

const patchSchema = z.object({
  themePreference: z.enum(["light", "dark", "system"]),
});

export async function PATCH(req: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Bad request";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  await prisma.user.update({
    where: { id: userId },
    data: { themePreference: body.themePreference },
  });
  return new NextResponse(null, { status: 204 });
}
