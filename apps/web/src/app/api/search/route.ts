import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/session";
import { assertCanAccessVault, AuthzError } from "@/lib/authz";
import { searchNotes } from "@/lib/search";

export async function GET(req: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const vaultId = req.nextUrl.searchParams.get("vaultId") ?? "";
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? "50"), 100);

  try {
    await assertCanAccessVault(userId, vaultId, "MEMBER");
  } catch (e) {
    if (e instanceof AuthzError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const results = await searchNotes({ vaultId, query: q, limit });
  return NextResponse.json({ results });
}
