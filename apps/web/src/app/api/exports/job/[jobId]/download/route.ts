import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/session";
import { prisma } from "@km/db";
import { assertCanAccessVault, AuthzError } from "@/lib/authz";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

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
    select: { id: true, vaultId: true, status: true, archivePath: true },
  });

  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    await assertCanAccessVault(userId, job.vaultId, "MEMBER");
  } catch (err) {
    if (err instanceof AuthzError) {
      return NextResponse.json({ error: "forbidden" }, { status: err.status });
    }
    throw err;
  }

  if (job.status !== "COMPLETED" || !job.archivePath) {
    return NextResponse.json({ error: "not ready" }, { status: 409 });
  }

  const info = await stat(job.archivePath);
  const stream = createReadStream(job.archivePath);

  return new Response(stream as unknown as ReadableStream, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-length": String(info.size),
      "content-disposition": `attachment; filename="vault-export-${job.id}.zip"`,
      "cache-control": "private, no-store",
    },
  });
}
