import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/session";
import { assertCanAccessVault, AuthzError } from "@/lib/authz";
import { buildGraph } from "@/lib/graph";

export async function GET(
  _req: Request,
  { params }: { params: { vaultId: string } },
) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await assertCanAccessVault(userId, params.vaultId, "MEMBER");
  } catch (e) {
    if (e instanceof AuthzError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
  return NextResponse.json(await buildGraph(params.vaultId));
}
