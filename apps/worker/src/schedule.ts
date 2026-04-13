import type PgBoss from "pg-boss";
import { prisma } from "@km/db";
import { EXPORT_VAULT_QUEUE } from "./jobs/types.js";

const NIGHTLY_CRON = "0 3 * * *";
const SCHEDULED_QUEUE = "export-vault-scheduled";

export { SCHEDULED_QUEUE };

export async function registerNightlyExports(boss: PgBoss): Promise<void> {
  const vaults = await prisma.vault.findMany({ select: { id: true, ownerId: true } });
  for (const vault of vaults) {
    const scheduleName = `nightly-export-${vault.id}`;
    await boss.schedule(
      scheduleName,
      NIGHTLY_CRON,
      {
        queue: SCHEDULED_QUEUE,
        vaultId: vault.id,
        requestedByUserId: vault.ownerId,
      },
      { tz: "UTC" },
    );
  }
  console.log(`[schedule] registered nightly exports for ${vaults.length} vaults`);
}

export async function handleScheduledExportPayload(
  boss: PgBoss,
  payload: { vaultId: string; requestedByUserId: string },
): Promise<void> {
  const job = await prisma.exportJob.create({
    data: {
      vaultId: payload.vaultId,
      status: "PENDING",
      requestedByUserId: payload.requestedByUserId,
    },
    select: { id: true },
  });
  await boss.send(EXPORT_VAULT_QUEUE, {
    vaultId: payload.vaultId,
    requestedByUserId: payload.requestedByUserId,
    jobId: job.id,
  });
}
