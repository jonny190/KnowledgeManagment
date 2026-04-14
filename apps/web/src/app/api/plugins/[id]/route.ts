import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@km/db";
import { requireUserId } from "@/lib/session";

const patchSchema = z.object({ enabled: z.boolean() });

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  try {
    const row = await prisma.userPlugin.update({
      where: { id: params.id, userId },
      data: { enabled: body.enabled },
    });
    return NextResponse.json({ plugin: row });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await prisma.userPlugin.delete({ where: { id: params.id, userId } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
