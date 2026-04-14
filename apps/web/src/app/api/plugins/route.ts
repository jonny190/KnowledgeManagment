import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@km/db";
import { requireUserId } from "@/lib/session";

const addSchema = z.object({ url: z.string().url() });

export async function GET() {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await prisma.userPlugin.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ plugins: rows });
}

export async function POST(req: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: z.infer<typeof addSchema>;
  try {
    body = addSchema.parse(await req.json());
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  const row = await prisma.userPlugin.upsert({
    where: { userId_url: { userId, url: body.url } },
    create: { userId, url: body.url },
    update: { enabled: true },
  });
  return NextResponse.json({ plugin: row }, { status: 201 });
}
