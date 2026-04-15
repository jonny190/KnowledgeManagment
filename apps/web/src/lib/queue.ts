import PgBoss from "pg-boss";
import { EXPORT_VAULT_QUEUE, type ExportVaultPayload } from "@km/worker/src/jobs/types";

let bossPromise: Promise<PgBoss> | null = null;

export function getBoss(): Promise<PgBoss> {
  if (bossPromise) return bossPromise;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL required for queue");
  const boss = new PgBoss({ connectionString });
  boss.on("error", (err) => console.error("[pg-boss web]", err));
  bossPromise = boss.start().then(() => boss);
  return bossPromise;
}

export async function enqueueExportVault(payload: ExportVaultPayload): Promise<string> {
  const boss = await getBoss();
  const id = await boss.send(EXPORT_VAULT_QUEUE, payload, {
    retryLimit: 3,
    retryBackoff: true,
  });
  if (!id) throw new Error("pg-boss did not return a job id");
  return id;
}
