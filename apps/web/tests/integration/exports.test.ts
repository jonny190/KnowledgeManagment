import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, createUser } from "../helpers/db";
import { prisma } from "@km/db";

vi.mock("../../src/lib/session", () => ({
  getCurrentUserId: vi.fn(),
  requireUserId: vi.fn(),
}));

vi.mock("../../src/lib/queue", () => ({
  enqueueExportVault: vi.fn().mockResolvedValue("queue-job-id"),
}));

import { requireUserId } from "../../src/lib/session";
import { enqueueExportVault } from "../../src/lib/queue";
import { POST as triggerExport } from "../../src/app/api/exports/[vaultId]/route";
import { GET as getStatus } from "../../src/app/api/exports/job/[jobId]/route";

const enqueue = enqueueExportVault as ReturnType<typeof vi.fn>;

describe("exports API", () => {
  beforeEach(async () => {
    await resetDb();
    enqueue.mockClear();
    vi.mocked(requireUserId).mockReset();
  });

  it("returns 401 when not signed in", async () => {
    vi.mocked(requireUserId).mockRejectedValue(new Response("Unauthorized", { status: 401 }));
    const res = await triggerExport(new Request("http://x"), { params: { vaultId: "v1" } });
    expect(res.status).toBe(401);
  });

  it("returns 403 when user cannot access vault", async () => {
    const { user: owner, vault } = await createUser();
    const { user: intruder } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(intruder.id);

    const res = await triggerExport(new Request("http://x"), {
      params: { vaultId: vault.id },
    });
    expect(res.status).toBe(403);
  });

  it("creates a PENDING ExportJob and enqueues when authorised", async () => {
    const { user, vault } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    const res = await triggerExport(new Request("http://x"), {
      params: { vaultId: vault.id },
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.jobId).toBeTruthy();

    const job = await prisma.exportJob.findUnique({ where: { id: body.jobId } });
    expect(job?.status).toBe("PENDING");
    expect(job?.requestedByUserId).toBe(user.id);
    expect(enqueue).toHaveBeenCalledWith({
      vaultId: vault.id,
      requestedByUserId: user.id,
      jobId: body.jobId,
    });
  });

  it("GET status returns 404 for unknown job", async () => {
    const { user } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(user.id);
    const res = await getStatus(new Request("http://x"), {
      params: { jobId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.status).toBe(404);
  });

  it("GET status returns 403 when user cannot access the job's vault", async () => {
    const { user: owner, vault } = await createUser();
    const job = await prisma.exportJob.create({
      data: { vaultId: vault.id, status: "PENDING", requestedByUserId: owner.id },
    });
    const { user: intruder } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(intruder.id);

    const res = await getStatus(new Request("http://x"), {
      params: { jobId: job.id },
    });
    expect(res.status).toBe(403);
  });
});
