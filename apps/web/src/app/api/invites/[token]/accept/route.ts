import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/session";
import { acceptInvite } from "@/app/actions/invites";

export async function POST(_req: Request, ctx: { params: { token: string } }) {
  const userId = await requireUserId();
  const result = await acceptInvite(userId, ctx.params.token);
  if (result.ok) return NextResponse.json({ workspaceId: result.workspaceId }, { status: 200 });
  if (result.reason === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (result.reason === "expired") return NextResponse.json({ error: "Expired" }, { status: 410 });
  return NextResponse.json({ error: "Already accepted" }, { status: 409 });
}
