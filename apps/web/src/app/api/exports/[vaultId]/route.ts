import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/session";
import { createExport } from "@/lib/exports/create";
import { AuthzError } from "@/lib/authz";

export async function POST(
  _req: Request,
  { params }: { params: { vaultId: string } },
) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { jobId } = await createExport({
      userId,
      vaultId: params.vaultId,
    });
    return NextResponse.json({ jobId }, { status: 202 });
  } catch (err) {
    if (err instanceof AuthzError) {
      return NextResponse.json({ error: "forbidden" }, { status: err.status });
    }
    throw err;
  }
}
