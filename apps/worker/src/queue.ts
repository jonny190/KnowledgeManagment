import PgBoss from "pg-boss";

let bossPromise: Promise<PgBoss> | null = null;

export function getBoss(): Promise<PgBoss> {
  if (bossPromise) return bossPromise;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to start pg-boss");
  }
  const boss = new PgBoss({
    connectionString,
    retryLimit: 3,
    retryBackoff: true,
    retentionDays: 14,
    monitorStateIntervalSeconds: 60,
  });
  boss.on("error", (err) => {
    console.error("[pg-boss]", err);
  });
  bossPromise = boss.start().then(() => boss);
  return bossPromise;
}

export async function stopBoss(): Promise<void> {
  if (!bossPromise) return;
  const boss = await bossPromise;
  await boss.stop({ graceful: true });
  bossPromise = null;
}
