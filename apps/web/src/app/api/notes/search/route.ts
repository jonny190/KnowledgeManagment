import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@km/db";
import { searchNotesQuery } from "@km/shared";
import { requireUserId } from "@/lib/session";
import { assertCanAccessVault, AuthzError } from "@/lib/authz";

export async function GET(req: Request) {
  const userId = await requireUserId();
  const url = new URL(req.url);
  let params;
  try {
    params = searchNotesQuery.parse({
      vaultId: url.searchParams.get("vaultId"),
      q: url.searchParams.get("q"),
    });
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: e.flatten() }, { status: 400 });
    throw e;
  }

  try {
    await assertCanAccessVault(userId, params.vaultId, "MEMBER");
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const results = await prisma.note.findMany({
    where: {
      vaultId: params.vaultId,
      title: { startsWith: params.q, mode: "insensitive" },
    },
    select: { id: true, title: true, slug: true },
    orderBy: { title: "asc" },
    take: 20,
  });
  return NextResponse.json({ results }, { status: 200 });
}
