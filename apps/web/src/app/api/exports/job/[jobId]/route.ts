import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/session";
import { prisma } from "@km/db";
import { assertCanAccessVault, AuthzError } from "@/lib/authz";

export async function GET(
  _req: Request,
  { params }: { params: { jobId: string } },
) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const job = await prisma.exportJob.findUnique({
    where: { id: params.jobId },
    select: {
      id: true,
      vaultId: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      archivePath: true,
      errorMessage: true,
    },
  });

  if (!job) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    await assertCanAccessVault(userId, job.vaultId, "MEMBER");
  } catch (err) {
    if (err instanceof AuthzError) {
      return NextResponse.json({ error: "forbidden" }, { status: err.status });
    }
    throw err;
  }

  return NextResponse.json({
    id: job.id,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    errorMessage: job.errorMessage,
    downloadUrl:
      job.status === "COMPLETED" && job.archivePath
        ? `/api/exports/job/${job.id}/download`
        : null,
  });
}
