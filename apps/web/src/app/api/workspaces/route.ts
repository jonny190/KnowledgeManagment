import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireUserId } from "@/lib/session";
import { createWorkspace } from "@/app/actions/workspaces";

export async function POST(req: Request) {
  const userId = await requireUserId();
  try {
    const body = await req.json();
    const { workspace, vault } = await createWorkspace(userId, body);
    return NextResponse.json({ workspace, vault }, { status: 201 });
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    throw e;
  }
}
