import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@km/db";
import { requireUserId } from "@/lib/session";
import { assertCanAccessVault, AuthzError } from "@/lib/authz";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    await assertCanAccessVault(userId, params.id, "MEMBER");
  } catch (e) {
    if (e instanceof AuthzError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const rows = await prisma.tag.findMany({
    where: { vaultId: params.id },
    select: {
      name: true,
      _count: { select: { notes: true } },
    },
    orderBy: [{ notes: { _count: "desc" } }, { name: "asc" }],
  });

  return NextResponse.json({
    tags: rows.map((r) => ({ name: r.name, count: r._count.notes })),
  });
}
