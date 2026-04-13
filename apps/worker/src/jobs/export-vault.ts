import { prisma } from "@km/db";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type PgBoss from "pg-boss";
import { renderVaultToDirectory } from "../fs/render.js";
import { createZip } from "../fs/zip.js";
import { isExportVaultPayload, type ExportVaultPayload } from "./types.js";

export interface RunExportOptions {
  dataDir: string;
}

export async function runExport(
  payload: ExportVaultPayload,
  options: RunExportOptions,
): Promise<string> {
  await prisma.exportJob.update({
    where: { id: payload.jobId },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  const workDir = await mkdtemp(join(tmpdir(), `export-${payload.jobId}-`));
  const exportsDir = join(options.dataDir, "exports");
  await mkdir(exportsDir, { recursive: true });
  const archivePath = join(exportsDir, `${payload.jobId}.zip`);

  try {
    const [folders, notes, diagrams] = await Promise.all([
      prisma.folder.findMany({
        where: { vaultId: payload.vaultId },
        select: { id: true, path: true },
      }),
      prisma.note.findMany({
        where: { vaultId: payload.vaultId },
        select: { title: true, folderId: true, content: true },
      }),
      prisma.diagram.findMany({
        where: { vaultId: payload.vaultId },
        select: {
          id: true,
          kind: true,
          slug: true,
          xml: true,
          folderId: true,
          folder: { select: { path: true } },
        },
      }),
    ]);

    await renderVaultToDirectory({
      outDir: workDir,
      folders: folders.map((f) => ({ id: f.id, path: f.path ?? "" })),
      notes: notes.map((n) => ({
        title: n.title,
        folderId: n.folderId,
        content: n.content,
      })),
      diagrams: diagrams.map((d) => ({
        slug: d.slug,
        kind: d.kind,
        xml: d.xml,
        folderPath: d.folder?.path ?? "",
      })),
    });

    await createZip(workDir, archivePath);

    await prisma.exportJob.update({
      where: { id: payload.jobId },
      data: {
        status: "COMPLETED",
        finishedAt: new Date(),
        archivePath,
        errorMessage: null,
      },
    });

    return archivePath;
  } catch (err) {
    await prisma.exportJob.update({
      where: { id: payload.jobId },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export function makeExportHandler(options: RunExportOptions) {
  return async (job: PgBoss.Job<unknown>): Promise<void> => {
    if (!isExportVaultPayload(job.data)) {
      throw new Error("invalid export-vault payload");
    }
    await runExport(job.data, options);
  };
}
