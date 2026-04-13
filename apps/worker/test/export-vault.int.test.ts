import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "@km/db";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { runExport } from "../src/jobs/export-vault";
import * as renderMod from "../src/fs/render";

async function resetDb() {
  await prisma.$transaction([
    prisma.link.deleteMany(),
    prisma.attachment.deleteMany(),
    prisma.note.deleteMany(),
    prisma.diagram.deleteMany(),
    prisma.folder.deleteMany(),
    prisma.exportJob.deleteMany(),
    prisma.vault.deleteMany(),
    prisma.invite.deleteMany(),
    prisma.membership.deleteMany(),
    prisma.workspace.deleteMany(),
    prisma.session.deleteMany(),
    prisma.account.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

const testDataDirs: string[] = [];

afterAll(async () => {
  for (const dir of testDataDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  await prisma.$disconnect();
});

describe("runExport integration", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("produces a zip that contains all notes with wiki-links verbatim", async () => {
    const user = await prisma.user.create({ data: { email: "e@x.test" } });
    const vault = await prisma.vault.create({
      data: { ownerType: "USER", ownerId: user.id, name: "V" },
    });
    const root = await prisma.folder.create({
      data: { vaultId: vault.id, name: "root", path: "" },
    });
    const projects = await prisma.folder.create({
      data: {
        vaultId: vault.id,
        name: "Projects",
        path: "Projects",
        parentId: root.id,
      },
    });
    await prisma.note.create({
      data: {
        vaultId: vault.id,
        folderId: root.id,
        title: "Welcome",
        slug: "welcome",
        content: "# Hi\nSee [[Plan]] and [[Plan|the plan]].",
        createdById: user.id,
        updatedById: user.id,
      },
    });
    await prisma.note.create({
      data: {
        vaultId: vault.id,
        folderId: projects.id,
        title: "Plan",
        slug: "plan",
        content: "details",
        createdById: user.id,
        updatedById: user.id,
      },
    });

    const dataDir = await mkdtemp(join(tmpdir(), "data-"));
    testDataDirs.push(dataDir);

    const job = await prisma.exportJob.create({
      data: {
        vaultId: vault.id,
        status: "PENDING",
        requestedByUserId: user.id,
      },
    });

    const archivePath = await runExport(
      { vaultId: vault.id, requestedByUserId: user.id, jobId: job.id },
      { dataDir },
    );

    expect(archivePath).toBe(join(dataDir, "exports", `${job.id}.zip`));

    const extract = await mkdtemp(join(tmpdir(), "extract-"));
    testDataDirs.push(extract);
    execFileSync("unzip", ["-q", archivePath, "-d", extract]);
    const welcome = await readFile(join(extract, "Welcome.md"), "utf8");
    expect(welcome).toBe("# Hi\nSee [[Plan]] and [[Plan|the plan]].");
    const plan = await readFile(join(extract, "Projects/Plan.md"), "utf8");
    expect(plan).toBe("details");

    const updated = await prisma.exportJob.findUnique({ where: { id: job.id } });
    expect(updated?.status).toBe("COMPLETED");
    expect(updated?.archivePath).toBe(archivePath);
  });

  it("marks the job FAILED with an error message when rendering throws", async () => {
    const user = await prisma.user.create({ data: { email: "f@x.test" } });
    const vault = await prisma.vault.create({
      data: { ownerType: "USER", ownerId: user.id, name: "V" },
    });
    const job = await prisma.exportJob.create({
      data: {
        vaultId: vault.id,
        status: "PENDING",
        requestedByUserId: user.id,
      },
    });

    const dataDir = await mkdtemp(join(tmpdir(), "data-fail-"));
    testDataDirs.push(dataDir);

    // Spy on renderVaultToDirectory so we can force a failure
    const spy = vi.spyOn(renderMod, "renderVaultToDirectory").mockRejectedValueOnce(
      new Error("simulated render failure"),
    );

    try {
      await expect(
        runExport(
          { vaultId: vault.id, requestedByUserId: user.id, jobId: job.id },
          { dataDir },
        ),
      ).rejects.toThrow("simulated render failure");
    } finally {
      spy.mockRestore();
    }

    const updated = await prisma.exportJob.findUnique({ where: { id: job.id } });
    expect(updated?.status).toBe("FAILED");
    expect(updated?.errorMessage).toBeTruthy();
  });

  it("writes drawio and bpmn files into the archive", async () => {
    const user = await prisma.user.create({ data: { email: "diagrams@x.test" } });
    const vault = await prisma.vault.create({
      data: { ownerType: "USER", ownerId: user.id, name: "V" },
    });
    await prisma.folder.create({
      data: { vaultId: vault.id, name: "", path: "" },
    });

    await prisma.diagram.create({
      data: {
        vaultId: vault.id,
        kind: "DRAWIO",
        title: "Flow",
        slug: "flow",
        xml: "<mxfile id=\"x\"/>",
        createdById: user.id,
        updatedById: user.id,
      },
    });
    await prisma.diagram.create({
      data: {
        vaultId: vault.id,
        kind: "BPMN",
        title: "Proc",
        slug: "proc",
        xml: "<bpmn/>",
        createdById: user.id,
        updatedById: user.id,
      },
    });

    const dataDir = await mkdtemp(join(tmpdir(), "data-diag-"));
    testDataDirs.push(dataDir);

    const job = await prisma.exportJob.create({
      data: {
        vaultId: vault.id,
        status: "PENDING",
        requestedByUserId: user.id,
      },
    });

    const archivePath = await runExport(
      { vaultId: vault.id, requestedByUserId: user.id, jobId: job.id },
      { dataDir },
    );

    const extract = await mkdtemp(join(tmpdir(), "extract-diag-"));
    testDataDirs.push(extract);
    execFileSync("unzip", ["-q", archivePath, "-d", extract]);

    const flowContent = await readFile(join(extract, "flow.drawio"), "utf8");
    expect(flowContent).toBe("<mxfile id=\"x\"/>");

    const procContent = await readFile(join(extract, "proc.bpmn"), "utf8");
    expect(procContent).toBe("<bpmn/>");
  });
});
