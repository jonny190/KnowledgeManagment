import { getBoss, stopBoss } from "./queue.js";
import { EXPORT_VAULT_QUEUE } from "./jobs/types.js";
import { makeExportHandler } from "./jobs/export-vault.js";
import { SCHEDULED_QUEUE, registerNightlyExports, handleScheduledExportPayload } from "./schedule.js";
import { handleSendEmail } from "./jobs/send-email.js";

async function main() {
  const dataDir = process.env.DATA_DIR ?? "/data";

  const boss = await getBoss();

  await boss.work(EXPORT_VAULT_QUEUE, { teamSize: 2 }, makeExportHandler({ dataDir }));
  await boss.work("send-email", { teamSize: 2 }, handleSendEmail);

  await boss.work(SCHEDULED_QUEUE, { teamSize: 1 }, async (job) => {
    const data = job.data as { vaultId: string; requestedByUserId: string };
    await handleScheduledExportPayload(boss, data);
  });

  await registerNightlyExports(boss);

  console.log("[worker] ready");

  const shutdown = async () => {
    console.log("[worker] shutting down");
    await stopBoss();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("[worker] fatal", err);
  process.exit(1);
});
