import { prisma } from "@km/db";
import { assertCanAccessVault } from "@/lib/authz";
import { enqueueExportVault } from "@/lib/queue";

export interface CreateExportResult {
  jobId: string;
}

export async function createExport(params: {
  userId: string;
  vaultId: string;
}): Promise<CreateExportResult> {
  await assertCanAccessVault(params.userId, params.vaultId, "MEMBER");

  const job = await prisma.exportJob.create({
    data: {
      vaultId: params.vaultId,
      status: "PENDING",
      requestedByUserId: params.userId,
    },
    select: { id: true },
  });

  await enqueueExportVault({
    vaultId: params.vaultId,
    requestedByUserId: params.userId,
    jobId: job.id,
  });

  return { jobId: job.id };
}
