# Plan D: Markdown Export Worker and Coolify Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the foundation MVP by adding a pg-boss backed export worker that produces re-importable markdown zips, plus a full Docker and Coolify deployment pipeline driven by GitHub Actions.

**Architecture:** `apps/web` enqueues `export-vault` jobs on a pg-boss queue backed by the same Postgres used by Prisma. `apps/worker` consumes those jobs, renders the vault's folders and notes to `.md` files mirroring `Folder.path`, zips the result into `${DATA_DIR}/exports/<jobId>.zip`, and updates the `ExportJob` row. Coolify runs two containers (web and worker) built from separate multi-stage Dockerfiles sharing a named Docker volume mounted at `/data`. Cloudflare proxies HTTPS in front of HTTP-exposed services per the user's global rule.

**Tech Stack:** pg-boss 9, archiver 7, Next.js 14 (App Router), Node 20, Prisma 5, Docker Compose, Coolify, GitHub Actions, Vitest, Playwright.

**Assumes Plans A, B, C are executed.** The following already exist and this plan treats them as fixed:
- `packages/db` with `Vault`, `Folder`, `Note`, `Attachment`, `ExportJob` Prisma models, and the `ExportStatus` enum (`PENDING | RUNNING | COMPLETED | FAILED`).
- `apps/web` with NextAuth session helpers and `assertCanAccessVault(userId, vaultId, requiredRole)` exported from `apps/web/src/lib/auth/access.ts`.
- `packages/shared` exporting `slugify` and link-parsing utilities.
- `apps/worker` scaffold (`apps/worker/package.json`, `apps/worker/src/index.ts`) wired into the pnpm workspace and `turbo.json` pipelines `build`, `test`, `lint`, `typecheck`.
- Vault settings page at `apps/web/src/app/(app)/vaults/[vaultId]/settings/page.tsx`.

---

## File Structure

**New files:**

- `packages/db/prisma/migrations/20260413_add_exportjob_columns/migration.sql` — adds `requestedByUserId`, `errorMessage`, `payload` columns (if absent from Plan A) and pg-boss schema bootstrap note.
- `apps/worker/src/queue.ts` — pg-boss singleton, queue name constants, typed enqueue helpers.
- `apps/worker/src/jobs/export-vault.ts` — handler: render notes, zip, update row.
- `apps/worker/src/jobs/types.ts` — `ExportVaultPayload` type shared by web and worker.
- `apps/worker/src/fs/render.ts` — pure functions that map `Folder` + `Note` rows to a file tree on disk.
- `apps/worker/src/fs/zip.ts` — wraps archiver into a promise-returning `createZip(srcDir, outPath)`.
- `apps/worker/src/schedule.ts` — registers nightly cron via `boss.schedule`.
- `apps/worker/src/index.ts` (modify) — boots pg-boss, registers handler and schedule.
- `apps/worker/test/render.test.ts` — unit tests for the renderer.
- `apps/worker/test/zip.test.ts` — unit test for zip wrapper.
- `apps/worker/test/export-vault.int.test.ts` — integration test against real Postgres.
- `apps/web/src/lib/queue.ts` — web-side pg-boss client for enqueueing only.
- `apps/web/src/lib/exports/create.ts` — service: create `ExportJob` row and enqueue.
- `apps/web/src/app/api/exports/[vaultId]/route.ts` — `POST` enqueue endpoint.
- `apps/web/src/app/api/exports/job/[jobId]/route.ts` — `GET` status + signed download URL.
- `apps/web/src/app/api/exports/job/[jobId]/download/route.ts` — `GET` stream zip.
- `apps/web/src/app/(app)/vaults/[vaultId]/settings/export-panel.tsx` — client component with Export button, polling, download link.
- `apps/web/test/api/exports.int.test.ts` — integration + authz tests.
- `infra/docker/Dockerfile.web` — multi-stage Next.js production image.
- `infra/docker/Dockerfile.worker` — Node production image.
- `infra/docker/.dockerignore` — shared ignore list.
- `docker-compose.yml` — production compose reference.
- `infra/coolify/README.md` — deployment runbook.
- `infra/coolify/env.example` — documented env vars.
- `.github/workflows/ci.yml` — lint, typecheck, unit, integration on PR.
- `.github/workflows/e2e.yml` — Playwright on `main`.
- `.github/workflows/release.yml` — build and push Docker images on tag.
- `docs/deployment.md` — deployment runbook reference.
- `docs/architecture.md` — text architecture diagram.
- `docs/data-model.md` — data model reference aligned to spec.
- `guides/getting-started.md` — first-run walkthrough.
- `guides/creating-vaults.md` — vault creation guide.
- `guides/inviting-members.md` — invite flow guide.
- `guides/exporting.md` — export guide.

**Modified files:**

- `apps/web/package.json` — add `pg-boss` dependency.
- `apps/worker/package.json` — add `pg-boss`, `archiver`, `@types/archiver`.
- `apps/worker/src/index.ts` — boot queue.
- `turbo.json` — ensure `test:integration` pipeline passes env.
- `pnpm-workspace.yaml` — no change expected; confirm.

---

## Task 1: Install pg-boss and archiver dependencies

**Files:**
- Modify: `apps/worker/package.json`
- Modify: `apps/web/package.json`

- [ ] **Step 1: Add dependencies to the worker**

Run:

```bash
cd /home/jonny/KnowledgeManagment && pnpm --filter @kmgmt/worker add pg-boss@9.0.3 archiver@7.0.1 && pnpm --filter @kmgmt/worker add -D @types/archiver@6.0.2
```

Expected: pnpm installs and updates `apps/worker/package.json` and the lockfile.

- [ ] **Step 2: Add dependencies to web**

Run:

```bash
cd /home/jonny/KnowledgeManagment && pnpm --filter @kmgmt/web add pg-boss@9.0.3
```

Expected: `apps/web/package.json` gains `"pg-boss": "9.0.3"`.

- [ ] **Step 3: Verify installs**

Run:

```bash
cd /home/jonny/KnowledgeManagment && pnpm -r ls pg-boss archiver
```

Expected output contains `pg-boss 9.0.3` under both `@kmgmt/web` and `@kmgmt/worker`, and `archiver 7.0.1` under `@kmgmt/worker`.

- [ ] **Step 4: Commit**

```bash
cd /home/jonny/KnowledgeManagment && git add apps/worker/package.json apps/web/package.json pnpm-lock.yaml && git commit -m "chore: add pg-boss and archiver for export worker"
```

---

## Task 2: Define the export job payload type

**Files:**
- Create: `apps/worker/src/jobs/types.ts`

- [ ] **Step 1: Write the type**

Create `apps/worker/src/jobs/types.ts`:

```ts
export const EXPORT_VAULT_QUEUE = "export-vault" as const;

export interface ExportVaultPayload {
  vaultId: string;
  requestedByUserId: string;
  jobId: string;
}

export function isExportVaultPayload(v: unknown): v is ExportVaultPayload {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.vaultId === "string" &&
    typeof o.requestedByUserId === "string" &&
    typeof o.jobId === "string"
  );
}
```

- [ ] **Step 2: Typecheck**

Run:

```bash
cd /home/jonny/KnowledgeManagment && pnpm --filter @kmgmt/worker typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /home/jonny/KnowledgeManagment && git add apps/worker/src/jobs/types.ts && git commit -m "feat(worker): define ExportVaultPayload type"
```

---

## Task 3: Renderer — map Folder and Note rows to file tree

**Files:**
- Create: `apps/worker/src/fs/render.ts`
- Test: `apps/worker/test/render.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/worker/test/render.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderVaultToDirectory } from "../src/fs/render";

describe("renderVaultToDirectory", () => {
  it("writes notes under folders mirroring Folder.path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "render-"));
    await renderVaultToDirectory({
      outDir: dir,
      folders: [
        { id: "f1", path: "" },
        { id: "f2", path: "Projects" },
        { id: "f3", path: "Projects/Acme" },
      ],
      notes: [
        { title: "Welcome", folderId: "f1", content: "# Hi\n[[Other Note]]" },
        { title: "Plan", folderId: "f3", content: "body" },
      ],
    });

    const welcome = await readFile(join(dir, "Welcome.md"), "utf8");
    expect(welcome).toBe("# Hi\n[[Other Note]]");
    const plan = await readFile(join(dir, "Projects/Acme/Plan.md"), "utf8");
    expect(plan).toBe("body");
    const folderStat = await stat(join(dir, "Projects"));
    expect(folderStat.isDirectory()).toBe(true);
  });

  it("sanitises titles with slashes and preserves wiki-links verbatim", async () => {
    const dir = await mkdtemp(join(tmpdir(), "render-"));
    await renderVaultToDirectory({
      outDir: dir,
      folders: [{ id: "root", path: "" }],
      notes: [
        { title: "A/B: Test", folderId: "root", content: "[[Link|alias]]" },
      ],
    });
    const out = await readFile(join(dir, "A-B- Test.md"), "utf8");
    expect(out).toBe("[[Link|alias]]");
  });

  it("disambiguates duplicate titles in the same folder", async () => {
    const dir = await mkdtemp(join(tmpdir(), "render-"));
    await renderVaultToDirectory({
      outDir: dir,
      folders: [{ id: "root", path: "" }],
      notes: [
        { title: "Dup", folderId: "root", content: "one" },
        { title: "Dup", folderId: "root", content: "two" },
      ],
    });
    const a = await readFile(join(dir, "Dup.md"), "utf8");
    const b = await readFile(join(dir, "Dup (2).md"), "utf8");
    expect([a, b].sort()).toEqual(["one", "two"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /home/jonny/KnowledgeManagment && pnpm --filter @kmgmt/worker test -- render.test
```

Expected: FAIL with "Cannot find module '../src/fs/render'".

- [ ] **Step 3: Implement the renderer**

Create `apps/worker/src/fs/render.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface RenderFolder {
  id: string;
  path: string;
}

export interface RenderNote {
  title: string;
  folderId: string | null;
  content: string;
}

export interface RenderInput {
  outDir: string;
  folders: RenderFolder[];
  notes: RenderNote[];
}

const INVALID_CHARS = /[\/\\:*?"<>|]/g;

function sanitiseFileName(name: string): string {
  const trimmed = name.trim().replace(INVALID_CHARS, "-");
  return trimmed.length === 0 ? "Untitled" : trimmed;
}

export async function renderVaultToDirectory(input: RenderInput): Promise<void> {
  const folderById = new Map<string, RenderFolder>();
  for (const f of input.folders) folderById.set(f.id, f);

  for (const folder of input.folders) {
    if (folder.path === "") continue;
    await mkdir(join(input.outDir, folder.path), { recursive: true });
  }
  await mkdir(input.outDir, { recursive: true });

  const usedByDir = new Map<string, Set<string>>();

  for (const note of input.notes) {
    const folder = note.folderId ? folderById.get(note.folderId) : undefined;
    const relDir = folder ? folder.path : "";
    const baseDir = join(input.outDir, relDir);
    await mkdir(baseDir, { recursive: true });

    const base = sanitiseFileName(note.title);
    const used = usedByDir.get(relDir) ?? new Set<string>();
    let candidate = `${base}.md`;
    let i = 2;
    while (used.has(candidate)) {
      candidate = `${base} (${i}).md`;
      i += 1;
    }
    used.add(candidate);
    usedByDir.set(relDir, used);

    await writeFile(join(baseDir, candidate), note.content, "utf8");
  }
}
```

- [ ] **Step 4: Run the tests**

Run:

```bash
cd /home/jonny/KnowledgeManagment && pnpm --filter @kmgmt/worker test -- render.test
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
cd /home/jonny/KnowledgeManagment && git add apps/worker/src/fs/render.ts apps/worker/test/render.test.ts && git commit -m "feat(worker): render vault folders and notes to filesystem"
```

---

## Task 4: Zip wrapper around archiver

**Files:**
- Create: `apps/worker/src/fs/zip.ts`
- Test: `apps/worker/test/zip.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/worker/test/zip.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createZip } from "../src/fs/zip";

describe("createZip", () => {
  it("produces a readable zip containing source files", async () => {
    const src = await mkdtemp(join(tmpdir(), "zip-src-"));
    const outDir = await mkdtemp(join(tmpdir(), "zip-out-"));
    await mkdir(join(src, "nested"), { recursive: true });
    await writeFile(join(src, "a.md"), "hello");
    await writeFile(join(src, "nested/b.md"), "world");

    const zipPath = join(outDir, "out.zip");
    await createZip(src, zipPath);

    const listing = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .sort();
    expect(listing).toEqual(["a.md", "nested/b.md"].sort());

    const extracted = await mkdtemp(join(tmpdir(), "zip-ex-"));
    execFileSync("unzip", ["-q", zipPath, "-d", extracted]);
    expect(await readFile(join(extracted, "a.md"), "utf8")).toBe("hello");
    expect(await readFile(join(extracted, "nested/b.md"), "utf8")).toBe("world");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
cd /home/jonny/KnowledgeManagment && pnpm --filter @kmgmt/worker test -- zip.test
```

Expected: FAIL with missing module.

- [ ] **Step 3: Implement the wrapper**

Create `apps/worker/src/fs/zip.ts`:

```ts
import { createWriteStream } from "node:fs";
import archiver from "archiver";

export function createZip(srcDir: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => resolve());
    output.on("error", reject);
    archive.on("error", reject);
    archive.on("warning", (err) => {
      if (err.code !== "ENOENT") reject(err);
    });

    archive.pipe(output);
    archive.directory(srcDir, false);
    archive.finalize();
  });
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd /home/jonny/KnowledgeManagment && pnpm --filter @kmgmt/worker test -- zip.test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/jonny/KnowledgeManagment && git add apps/worker/src/fs/zip.ts apps/worker/test/zip.test.ts && git commit -m "feat(worker): add archiver-backed createZip helper"
```

---

## Task 5: Worker pg-boss singleton and queue helpers

**Files:**
- Create: `apps/worker/src/queue.ts`

- [ ] **Step 1: Implement the queue singleton**

Create `apps/worker/src/queue.ts`:

```ts
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
```

- [ ] **Step 2: Typecheck**

Run:

```bash
cd /home/jonny/KnowledgeManagment && pnpm --filter @kmgmt/worker typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /home/jonny/KnowledgeManagment && git add apps/worker/src/queue.ts && git commit -m "feat(worker): add pg-boss singleton helpers"
```

---

## Task 6: Web-side pg-boss enqueue client

**Files:**
- Create: `apps/web/src/lib/queue.ts`

- [ ] **Step 1: Implement the web client**

Create `apps/web/src/lib/queue.ts`:

```ts
import PgBoss from "pg-boss";
import { EXPORT_VAULT_QUEUE, type ExportVaultPayload } from "@kmgmt/worker/src/jobs/types";

let bossPromise: Promise<PgBoss> | null = null;

function getBoss(): Promise<PgBoss> {
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
```

- [ ] **Step 2: Add workspace reference so web can import the types file**

Verify `apps/web/package.json` has `"@kmgmt/worker": "workspace:*"` under `dependencies`. If absent, run:

```bash
cd /home/jonny/KnowledgeManagment && pnpm --filter @kmgmt/web add @kmgmt/worker@workspace:*
```

Expected: dependency added.

- [ ] **Step 3: Typecheck**

Run:

```bash
cd /home/jonny/KnowledgeManagment && pnpm --filter @kmgmt/web typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd /home/jonny/KnowledgeManagment && git add apps/web/src/lib/queue.ts apps/web/package.json pnpm-lock.yaml && git commit -m "feat(web): add pg-boss enqueue client for export jobs"
```

---

## Task 7: Export creation service in web

**Files:**
- Create: `apps/web/src/lib/exports/create.ts`

- [ ] **Step 1: Implement the service**

Create `apps/web/src/lib/exports/create.ts`:

```ts
import { prisma } from "@kmgmt/db";
import { assertCanAccessVault } from "@/lib/auth/access";
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
```

- [ ] **Step 2: Typecheck**

Run:

```bash
cd /home/jonny/KnowledgeManagment && pnpm --filter @kmgmt/web typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /home/jonny/KnowledgeManagment && git add apps/web/src/lib/exports/create.ts && git commit -m "feat(web): add createExport service using assertCanAccessVault"
```

---

## Task 8: Export API routes (POST trigger, GET status, GET download)

**Files:**
- Create: `apps/web/src/app/api/exports/[vaultId]/route.ts`
- Create: `apps/web/src/app/api/exports/job/[jobId]/route.ts`
- Create: `apps/web/src/app/api/exports/job/[jobId]/download/route.ts`

- [ ] **Step 1: Implement POST trigger**

Create `apps/web/src/app/api/exports/[vaultId]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createExport } from "@/lib/exports/create";

export async function POST(
  _req: Request,
  { params }: { params: { vaultId: string } },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const { jobId } = await createExport({
      userId: session.user.id,
      vaultId: params.vaultId,
    });
    return NextResponse.json({ jobId }, { status: 202 });
  } catch (err) {
    if (err instanceof Error && err.message === "FORBIDDEN") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    throw err;
  }
}
```

- [ ] **Step 2: Implement GET status**

Create `apps/web/src/app/api/exports/job/[jobId]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@kmgmt/db";
import { assertCanAccessVault } from "@/lib/auth/access";

export async function GET(
  _req: Request,
  { params }: { params: { jobId: string } },
) {
  const session = await auth();
  if (!session?.user?.id) {
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

  await assertCanAccessVault(session.user.id, job.vaultId, "MEMBER");

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
```

- [ ] **Step 3: Implement GET download**

Create `apps/web/src/app/api/exports/job/[jobId]/download/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@kmgmt/db";
import { assertCanAccessVault } from "@/lib/auth/access";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

export async function GET(
  _req: Request,
  { params }: { params: { jobId: string } },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const job = await prisma.exportJob.findUnique({
    where: { id: params.jobId },
    select: { id: true, vaultId: true, status: true, archivePath: true },
  });

  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });

  await assertCanAccessVault(session.user.id, job.vaultId, "MEMBER");

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
```

- [ ] **Step 4: Typecheck**

Run:

```bash
cd /home/jonny/KnowledgeManagment && pnpm --filter @kmgmt/web typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/jonny/KnowledgeManagment && git add apps/web/src/app/api/exports && git commit -m "feat(web): add export trigger, status, and download API routes"
```

---

## Task 9: Authz and integration tests for export endpoints

**Files:**
- Create: `apps/web/test/api/exports.int.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/api/exports.int.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb } from "@kmgmt/db/testing";
import { POST as triggerExport } from "@/app/api/exports/[vaultId]/route";
import { GET as getStatus } from "@/app/api/exports/job/[jobId]/route";

const enqueue = vi.fn().mockResolvedValue("queue-job-id");
vi.mock("@/lib/queue", () => ({ enqueueExportVault: enqueue }));

async function signedInAs(userId: string) {
  vi.doMock("@/lib/auth", () => ({
    auth: async () => ({ user: { id: userId } }),
  }));
}

describe("exports API", () => {
  beforeEach(async () => {
    await resetDb();
    enqueue.mockClear();
  });

  it("returns 401 when not signed in", async () => {
    vi.doMock("@/lib/auth", () => ({ auth: async () => null }));
    const res = await triggerExport(new Request("http://x"), { params: { vaultId: "v1" } });
    expect(res.status).toBe(401);
  });

  it("returns 403 when user cannot access vault", async () => {
    const owner = await prisma.user.create({ data: { email: "owner@x.test" } });
    const vault = await prisma.vault.create({
      data: { ownerType: "USER", ownerId: owner.id, name: "Owner vault" },
    });
    const intruder = await prisma.user.create({ data: { email: "other@x.test" } });
    await signedInAs(intruder.id);

    const res = await triggerExport(new Request("http://x"), {
      params: { vaultId: vault.id },
    });
    expect(res.status).toBe(403);
  });

  it("creates a PENDING ExportJob and enqueues when authorised", async () => {
    const user = await prisma.user.create({ data: { email: "u@x.test" } });
    const vault = await prisma.vault.create({
      data: { ownerType: "USER", ownerId: user.id, name: "Personal" },
    });
    await signedInAs(user.id);

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
    const user = await prisma.user.create({ data: { email: "u2@x.test" } });
    await signedInAs(user.id);
    const res = await getStatus(new Request("http://x"), {
      params: { jobId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.status).toBe(404);
  });

  it("GET status returns 403 when user cannot access the job's vault", async () => {
    const owner = await prisma.user.create({ data: { email: "o@x.test" } });
    const vault = await prisma.vault.create({
      data: { ownerType: "USER", ownerId: owner.id, name: "Owner" },
    });
    const job = await prisma.exportJob.create({
      data: { vaultId: vault.id, status: "PENDING", requestedByUserId: owner.id },
    });
    const intruder = await prisma.user.create({ data: { email: "i@x.test" } });
    await signedInAs(intruder.id);

    const res = await getStatus(new Request("http://x"), {
      params: { jobId: job.id },
    });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /home/jonny/KnowledgeManagment && pnpm --filter @kmgmt/web test:integration -- exports
```

Expected: FAIL (route exists but assertions may fail until queue mock wires up).

- [ ] **Step 3: Iterate until green**

If failures stem from route import order, adjust `vi.mock` positioning so mocks are hoisted before route imports (use top-of-file `vi.mock("@/lib/auth", ...)` with a mutable state module).

- [ ] **Step 4: Re-run**

Run:

```bash
cd /home/jonny/KnowledgeManagment && pnpm --filter @kmgmt/web test:integration -- exports
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
cd /home/jonny/KnowledgeManagment && git add apps/web/test/api/exports.int.test.ts && git commit -m "test(web): authz and integration tests for export endpoints"
```

---

## Task 10: Worker handler for export-vault

**Files:**
- Create: `apps/worker/src/jobs/export-vault.ts`

- [ ] **Step 1: Implement the handler**

Create `apps/worker/src/jobs/export-vault.ts`:

```ts
import { prisma } from "@kmgmt/db";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type PgBoss from "pg-boss";
import { renderVaultToDirectory } from "../fs/render";
import { createZip } from "../fs/zip";
import { isExportVaultPayload, type ExportVaultPayload } from "./types";

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
    const [folders, notes] = await Promise.all([
      prisma.folder.findMany({
        where: { vaultId: payload.vaultId },
        select: { id: true, path: true },
      }),
      prisma.note.findMany({
        where: { vaultId: payload.vaultId },
        select: { title: true, folderId: true, content: true },
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
```

- [ ] **Step 2: Typecheck**

Run:

```bash
cd /home/jonny/KnowledgeManagment && pnpm --filter @kmgmt/worker typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /home/jonny/KnowledgeManagment && git add apps/worker/src/jobs/export-vault.ts && git commit -m "feat(worker): implement export-vault job handler"
```

---

## Task 11: Integration test for the full export pipeline

**Files:**
- Create: `apps/worker/test/export-vault.int.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/worker/test/export-vault.int.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma, resetDb } from "@kmgmt/db/testing";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { runExport } from "../src/jobs/export-vault";

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

    await expect(
      runExport(
        { vaultId: vault.id, requestedByUserId: user.id, jobId: job.id },
        { dataDir: "/this/path/does/not/exist/and/cannot/be/created/\u0000" },
      ),
    ).rejects.toThrow();

    const updated = await prisma.exportJob.findUnique({ where: { id: job.id } });
    expect(updated?.status).toBe("FAILED");
    expect(updated?.errorMessage).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test**

Run:

```bash
cd /home/jonny/KnowledgeManagment && pnpm --filter @kmgmt/worker test:integration -- export-vault
```

Expected: PASS, 2 tests.

- [ ] **Step 3: Commit**

```bash
cd /home/jonny/KnowledgeManagment && git add apps/worker/test/export-vault.int.test.ts && git commit -m "test(worker): integration test for export pipeline"
```

---

## Task 12: Register handler and nightly schedule in worker boot

**Files:**
- Create: `apps/worker/src/schedule.ts`
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 1: Implement the schedule registrar**

Create `apps/worker/src/schedule.ts`:

```ts
import type PgBoss from "pg-boss";
import { prisma } from "@kmgmt/db";
import { EXPORT_VAULT_QUEUE } from "./jobs/types";

const NIGHTLY_CRON = "0 3 * * *";

export async function registerNightlyExports(boss: PgBoss): Promise<void> {
  const vaults = await prisma.vault.findMany({ select: { id: true, ownerId: true } });
  for (const vault of vaults) {
    const scheduleName = `nightly-export-${vault.id}`;
    await boss.schedule(
      scheduleName,
      NIGHTLY_CRON,
      {
        vaultId: vault.id,
        requestedByUserId: vault.ownerId,
        jobId: "scheduled",
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
```

Note: the scheduled pg-boss firing carries placeholder `jobId: "scheduled"`. The worker subscribes a separate handler for the scheduled queue name that translates the firing into a real `ExportJob` row and enqueues the normal `export-vault` job.

- [ ] **Step 2: Wire worker boot**

Replace `apps/worker/src/index.ts` with:

```ts
import { getBoss, stopBoss } from "./queue";
import { EXPORT_VAULT_QUEUE } from "./jobs/types";
import { makeExportHandler } from "./jobs/export-vault";
import { registerNightlyExports, handleScheduledExportPayload } from "./schedule";

const SCHEDULED_QUEUE = "export-vault-scheduled";

async function main() {
  const dataDir = process.env.DATA_DIR ?? "/data";

  const boss = await getBoss();

  await boss.work(EXPORT_VAULT_QUEUE, { teamSize: 2 }, makeExportHandler({ dataDir }));

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
```

- [ ] **Step 3: Update `registerNightlyExports` to post to the scheduled queue**

Edit `apps/worker/src/schedule.ts`, changing the schedule registration to target the scheduled queue:

```ts
import type PgBoss from "pg-boss";
import { prisma } from "@kmgmt/db";
import { EXPORT_VAULT_QUEUE } from "./jobs/types";

const NIGHTLY_CRON = "0 3 * * *";
const SCHEDULED_QUEUE = "export-vault-scheduled";

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
```

- [ ] **Step 4: Typecheck and build**

Run:

```bash
cd /home/jonny/KnowledgeManagment && pnpm --filter @kmgmt/worker typecheck && pnpm --filter @kmgmt/worker build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/jonny/KnowledgeManagment && git add apps/worker/src/schedule.ts apps/worker/src/index.ts && git commit -m "feat(worker): register handler and nightly export schedule"
```

---

## Task 13: Vault settings export panel UI

**Files:**
- Create: `apps/web/src/app/(app)/vaults/[vaultId]/settings/export-panel.tsx`
- Modify: `apps/web/src/app/(app)/vaults/[vaultId]/settings/page.tsx`

- [ ] **Step 1: Implement the client panel**

Create `apps/web/src/app/(app)/vaults/[vaultId]/settings/export-panel.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";

type Status = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

interface JobState {
  id: string;
  status: Status;
  downloadUrl: string | null;
  errorMessage: string | null;
}

export function ExportPanel({ vaultId }: { vaultId: string }) {
  const [job, setJob] = useState<JobState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const startExport = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/exports/${vaultId}`, { method: "POST" });
      if (!res.ok) throw new Error(`failed: ${res.status}`);
      const body = (await res.json()) as { jobId: string };
      setJob({ id: body.jobId, status: "PENDING", downloadUrl: null, errorMessage: null });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [vaultId]);

  useEffect(() => {
    if (!job) return;
    if (job.status === "COMPLETED" || job.status === "FAILED") return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/exports/job/${job.id}`);
      if (!res.ok) return;
      const body = (await res.json()) as JobState;
      setJob(body);
    }, 2000);
    return () => clearInterval(t);
  }, [job]);

  return (
    <section>
      <h2>Export vault</h2>
      <p>
        Download a zip of every note and folder as markdown files. Wiki-links are
        preserved so the archive is re-importable.
      </p>
      <button type="button" onClick={startExport} disabled={busy}>
        {busy ? "Starting..." : "Export vault"}
      </button>
      {err ? <p role="alert">{err}</p> : null}
      {job ? (
        <div>
          <p>Status: {job.status}</p>
          {job.status === "COMPLETED" && job.downloadUrl ? (
            <a href={job.downloadUrl}>Download zip</a>
          ) : null}
          {job.status === "FAILED" ? <p>{job.errorMessage}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 2: Mount it on the settings page**

Open `apps/web/src/app/(app)/vaults/[vaultId]/settings/page.tsx` and add the import and render:

```tsx
import { ExportPanel } from "./export-panel";

// inside the default export JSX:
<ExportPanel vaultId={params.vaultId} />
```

- [ ] **Step 3: Typecheck**

Run:

```bash
cd /home/jonny/KnowledgeManagment && pnpm --filter @kmgmt/web typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd /home/jonny/KnowledgeManagment && git add "apps/web/src/app/(app)/vaults/[vaultId]/settings" && git commit -m "feat(web): add export panel to vault settings"
```

---

## Task 14: Dockerfile for web

**Files:**
- Create: `infra/docker/Dockerfile.web`
- Create: `infra/docker/.dockerignore`

- [ ] **Step 1: Write .dockerignore**

Create `infra/docker/.dockerignore`:

```
node_modules
**/node_modules
.next
**/.next
dist
**/dist
.git
.github
.turbo
**/.turbo
coverage
**/coverage
.env
.env.*
!.env.example
docs
guides
playwright-report
test-results
```

- [ ] **Step 2: Write the Dockerfile**

Create `infra/docker/Dockerfile.web`:

```dockerfile
# syntax=docker/dockerfile:1.6

FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/editor/package.json packages/editor/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @kmgmt/db prisma generate
RUN pnpm --filter @kmgmt/web build

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data
WORKDIR /app

RUN groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app app
RUN mkdir -p /data && chown -R app:app /data

COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app:app /repo/apps/web/public ./apps/web/public
COPY --from=build --chown=app:app /repo/packages/db/prisma ./packages/db/prisma

USER app
EXPOSE 3000
VOLUME ["/data"]

CMD ["node", "apps/web/server.js"]
```

Note: this assumes `apps/web/next.config.mjs` sets `output: "standalone"`. If not, the base image Plan A shipped must be updated. Add the setting in Plan A; if missing at execution time, add it in a prerequisite step to this task.

- [ ] **Step 3: Build the image locally**

Run:

```bash
cd /home/jonny/KnowledgeManagment && docker build -f infra/docker/Dockerfile.web -t kmgmt-web:dev .
```

Expected: successful build, final image tagged `kmgmt-web:dev`.

- [ ] **Step 4: Commit**

```bash
cd /home/jonny/KnowledgeManagment && git add infra/docker/Dockerfile.web infra/docker/.dockerignore && git commit -m "feat(infra): multi-stage production Dockerfile for web"
```

---

## Task 15: Dockerfile for worker

**Files:**
- Create: `infra/docker/Dockerfile.worker`

- [ ] **Step 1: Write the Dockerfile**

Create `infra/docker/Dockerfile.worker`:

```dockerfile
# syntax=docker/dockerfile:1.6

FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/editor/package.json packages/editor/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @kmgmt/db prisma generate
RUN pnpm --filter @kmgmt/worker build
RUN pnpm deploy --filter @kmgmt/worker --prod /out

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV DATA_DIR=/data
WORKDIR /app

RUN groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app app
RUN mkdir -p /data && chown -R app:app /data

COPY --from=build --chown=app:app /out ./

USER app
VOLUME ["/data"]

CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Build the image locally**

Run:

```bash
cd /home/jonny/KnowledgeManagment && docker build -f infra/docker/Dockerfile.worker -t kmgmt-worker:dev .
```

Expected: successful build.

- [ ] **Step 3: Commit**

```bash
cd /home/jonny/KnowledgeManagment && git add infra/docker/Dockerfile.worker && git commit -m "feat(infra): production Dockerfile for worker"
```

---

## Task 16: Production docker-compose reference

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Write the compose file**

Create `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: kmgmt
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: kmgmt
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg-isready -U kmgmt -d kmgmt"]
      interval: 10s
      timeout: 5s
      retries: 10

  web:
    image: ${WEB_IMAGE:-ghcr.io/jonny/kmgmt-web:latest}
    build:
      context: .
      dockerfile: infra/docker/Dockerfile.web
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      NODE_ENV: production
      DATABASE_URL: postgres://kmgmt:${POSTGRES_PASSWORD}@postgres:5432/kmgmt
      NEXTAUTH_SECRET: ${NEXTAUTH_SECRET}
      NEXTAUTH_URL: ${NEXTAUTH_URL}
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET}
      GITHUB_CLIENT_ID: ${GITHUB_CLIENT_ID}
      GITHUB_CLIENT_SECRET: ${GITHUB_CLIENT_SECRET}
      DATA_DIR: /data
    volumes:
      - appdata:/data
    ports:
      - "3000:3000"

  worker:
    image: ${WORKER_IMAGE:-ghcr.io/jonny/kmgmt-worker:latest}
    build:
      context: .
      dockerfile: infra/docker/Dockerfile.worker
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      NODE_ENV: production
      DATABASE_URL: postgres://kmgmt:${POSTGRES_PASSWORD}@postgres:5432/kmgmt
      DATA_DIR: /data
    volumes:
      - appdata:/data

volumes:
  pgdata:
  appdata:
```

- [ ] **Step 2: Validate the compose file**

Run:

```bash
cd /home/jonny/KnowledgeManagment && docker compose config --quiet
```

Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
cd /home/jonny/KnowledgeManagment && git add docker-compose.yml && git commit -m "feat(infra): production docker-compose for web, worker, postgres"
```

---

## Task 17: Coolify deployment runbook and env template

**Files:**
- Create: `infra/coolify/README.md`
- Create: `infra/coolify/env.example`

- [ ] **Step 1: Write the env template**

Create `infra/coolify/env.example`:

```
# Postgres
POSTGRES_PASSWORD=change-me

# App
DATABASE_URL=postgres://kmgmt:change-me@postgres:5432/kmgmt
NEXTAUTH_SECRET=generate-with-openssl-rand-hex-32
NEXTAUTH_URL=https://knowledge.example.com
DATA_DIR=/data

# OAuth providers
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Image tags used in docker-compose.yml
WEB_IMAGE=ghcr.io/jonny/kmgmt-web:latest
WORKER_IMAGE=ghcr.io/jonny/kmgmt-worker:latest
```

- [ ] **Step 2: Write the runbook**

Create `infra/coolify/README.md`:

```markdown
# Coolify Deployment Runbook

This runbook covers deploying the knowledge management platform to the Coria Coolify instance at https://coolify.daveys.xyz/. Per the team's global rule, services run over HTTP inside Coolify and HTTPS is terminated by the Cloudflare proxy in front.

## Prerequisites

- Access to the Coolify dashboard with the Coria team selected.
- A Cloudflare zone that will host the public domain (for example knowledge.example.com). API access is managed outside Coolify; a DNS record pointing at the Coolify host with the proxy enabled is required.
- A GitHub repository that Coolify can pull from, with the `main` branch up to date.
- The operator exports the Coolify API token as the environment variable `COOLIFY_API_TOKEN` locally if they want to script actions. The token is never committed to the repo.

## One-time project setup

1. Sign in to https://coolify.daveys.xyz/ and pick the Coria team.
2. Create a new Project named `knowledge-management`.
3. Inside the project create an Environment named `production`.
4. Add a new Resource of type `Docker Compose`:
   - Source: the GitHub repository containing this codebase.
   - Branch: `main`.
   - Compose file path: `docker-compose.yml`.
5. Coolify will parse the compose file and show three services: `postgres`, `web`, `worker`.

## Environment variables

Copy `infra/coolify/env.example` into the Coolify environment UI. Fill in the blank values:

- `POSTGRES_PASSWORD`: generate a long random string. Store it in your password manager.
- `NEXTAUTH_SECRET`: generate with `openssl rand -hex 32`.
- `NEXTAUTH_URL`: the public HTTPS URL of the web service (Cloudflare in front).
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: from the Google Cloud console OAuth credentials. Redirect URI is `${NEXTAUTH_URL}/api/auth/callback/google`.
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`: from GitHub Developer Settings. Redirect URI is `${NEXTAUTH_URL}/api/auth/callback/github`.
- `DATABASE_URL`: leave pointing at the compose-internal `postgres` hostname.
- `DATA_DIR`: leave at `/data`.
- `WEB_IMAGE` and `WORKER_IMAGE`: leave at the GHCR tags if using the release pipeline. For source builds, leave blank and Coolify will build from the Dockerfiles.

## Volumes

Coolify surfaces two named volumes from the compose file:

- `pgdata`: persists Postgres data.
- `appdata`: mounted at `/data` in both `web` and `worker`. Holds attachments under `/data/vaults/<vaultId>/attachments/` and export archives under `/data/exports/`.

Confirm both volumes are marked Persistent in the Coolify UI. Do not let Coolify re-create them between deploys.

## Domain and Cloudflare

1. In Coolify, attach a domain to the `web` service. Use the public hostname, for example `knowledge.example.com`.
2. Disable TLS termination in Coolify. The service listens on HTTP port 3000.
3. In Cloudflare, create a proxied `A` record pointing at the Coolify host's public IP.
4. Set Cloudflare SSL mode to Full (strict is not required because Coolify speaks HTTP inside the tunnel and Cloudflare treats the proxy as the TLS boundary per the team's global policy).
5. Update `NEXTAUTH_URL` to the HTTPS URL and redeploy.

## First deploy

1. Click Deploy in Coolify. It will build the images (or pull if image tags are set), run migrations as part of the `web` container start, and boot all three services.
2. Watch logs for `web` until you see `Ready on http://0.0.0.0:3000`. Watch `worker` until you see `[worker] ready`.
3. Run database migrations explicitly the first time:

   ```bash
   docker exec -it $(docker ps -qf "name=web") pnpm --filter @kmgmt/db prisma migrate deploy
   ```

4. Visit the public URL and register the first user. That user becomes the implicit administrator by virtue of being first.

## Updating

Tag a release in GitHub (for example `v0.1.0`). The release workflow in `.github/workflows/release.yml` builds and pushes `ghcr.io/jonny/kmgmt-web:v0.1.0` and `ghcr.io/jonny/kmgmt-worker:v0.1.0`. In Coolify set the image tags via the env vars and redeploy.

Between tagged releases, pushing to `main` triggers CI only; no images are published. Deploy from source by pointing Coolify at `main` and clicking Deploy.

## Rollback

Set `WEB_IMAGE` and `WORKER_IMAGE` to the previous tag in the Coolify env and redeploy. Postgres data is untouched. Exports produced by the newer code remain downloadable because they are plain zip files.

## Backups

Back up the `pgdata` and `appdata` volumes on a nightly schedule through Coolify's backup integration or a host-level `restic` cron. The nightly export job also writes a fresh markdown zip of every vault to `/data/exports/`, giving a secondary human-readable backup format.

## Troubleshooting

- `worker` restarts in a loop: check `DATABASE_URL` reachability and that the pg-boss schema has been created. pg-boss provisions its own schema on first run; if the Postgres user lacks `CREATE` permission, grant it.
- Exports stuck at `PENDING`: confirm the `worker` container is running and not blocked by a failing handler. Inspect `pgboss.job` and `pgboss.archive` tables.
- 401 from OAuth callbacks: check `NEXTAUTH_URL` matches the exact public hostname, including protocol, no trailing slash.
```

- [ ] **Step 3: Commit**

```bash
cd /home/jonny/KnowledgeManagment && git add infra/coolify/README.md infra/coolify/env.example && git commit -m "docs(infra): Coolify deployment runbook and env template"
```

---

## Task 18: GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  static:
    name: Lint and typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9.12.0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @kmgmt/db prisma generate
      - run: pnpm -r lint
      - run: pnpm -r typecheck

  unit:
    name: Unit tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9.12.0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @kmgmt/db prisma generate
      - run: pnpm -r test

  integration:
    name: Integration tests
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: kmgmt
          POSTGRES_PASSWORD: kmgmt
          POSTGRES_DB: kmgmt_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd="pg-isready -U kmgmt -d kmgmt_test"
          --health-interval=5s
          --health-timeout=3s
          --health-retries=20
    env:
      DATABASE_URL: postgres://kmgmt:kmgmt@localhost:5432/kmgmt_test
      DATA_DIR: /tmp/kmgmt-data
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9.12.0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: sudo apt-get update && sudo apt-get install -y unzip
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @kmgmt/db prisma migrate deploy
      - run: pnpm -r test:integration
```

- [ ] **Step 2: Validate YAML syntax**

Run:

```bash
cd /home/jonny/KnowledgeManagment && python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"
```

Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
cd /home/jonny/KnowledgeManagment && git add .github/workflows/ci.yml && git commit -m "ci: lint, typecheck, unit, and integration tests on PR"
```

---

## Task 19: GitHub Actions E2E workflow

**Files:**
- Create: `.github/workflows/e2e.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/e2e.yml`:

```yaml
name: E2E

on:
  push:
    branches: [main]

concurrency:
  group: e2e-${{ github.ref }}
  cancel-in-progress: true

jobs:
  playwright:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: kmgmt
          POSTGRES_PASSWORD: kmgmt
          POSTGRES_DB: kmgmt_e2e
        ports:
          - 5432:5432
        options: >-
          --health-cmd="pg-isready -U kmgmt -d kmgmt_e2e"
          --health-interval=5s
          --health-timeout=3s
          --health-retries=20
    env:
      DATABASE_URL: postgres://kmgmt:kmgmt@localhost:5432/kmgmt_e2e
      NEXTAUTH_SECRET: e2e-secret
      NEXTAUTH_URL: http://localhost:3000
      DATA_DIR: /tmp/kmgmt-e2e
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9.12.0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @kmgmt/db prisma migrate deploy
      - run: pnpm --filter @kmgmt/web build
      - run: pnpm --filter @kmgmt/web exec playwright install --with-deps chromium
      - run: pnpm --filter @kmgmt/web test:e2e
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: apps/web/playwright-report
```

- [ ] **Step 2: Validate**

Run:

```bash
cd /home/jonny/KnowledgeManagment && python3 -c "import yaml; yaml.safe_load(open('.github/workflows/e2e.yml'))"
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd /home/jonny/KnowledgeManagment && git add .github/workflows/e2e.yml && git commit -m "ci: Playwright E2E workflow on main"
```

---

## Task 20: GitHub Actions release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - "v*.*.*"

permissions:
  contents: read
  packages: write

jobs:
  images:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        include:
          - name: web
            dockerfile: infra/docker/Dockerfile.web
          - name: worker
            dockerfile: infra/docker/Dockerfile.worker
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository_owner }}/kmgmt-${{ matrix.name }}
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=raw,value=latest
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: ${{ matrix.dockerfile }}
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 2: Validate**

Run:

```bash
cd /home/jonny/KnowledgeManagment && python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd /home/jonny/KnowledgeManagment && git add .github/workflows/release.yml && git commit -m "ci: build and push Docker images on semver tags"
```

---

## Task 21: Architecture, data model, and deployment docs

**Files:**
- Create: `docs/architecture.md`
- Create: `docs/data-model.md`
- Create: `docs/deployment.md`

- [ ] **Step 1: Write `docs/architecture.md`**

Create `docs/architecture.md`:

```markdown
# Architecture

The platform is a Next.js application backed by Postgres. A second Node service consumes background jobs from the same database. All persistent state, including queue state, lives in Postgres.

```
           Cloudflare (HTTPS)
                  |
                  v
              web (Next.js) ----+------> Postgres
                  |             |
                  |             |
                  +---> pg-boss queue
                                |
                                v
                          worker (Node)
                                |
                                v
                         /data volume
                       (attachments, exports)
```

Services and responsibilities:

- web: serves the UI and all API routes. Enqueues export jobs through pg-boss. Reads and writes attachments directly from the shared `/data` volume. Terminates its own session checks via NextAuth against the shared database.
- worker: long-running Node process that subscribes to the `export-vault` queue and the `export-vault-scheduled` queue. Renders vault contents to a filesystem directory, zips the result, and updates the `ExportJob` row.
- postgres: single Postgres instance that holds application data, NextAuth sessions, and pg-boss queue state.
- /data volume: Docker named volume mounted in both web and worker. Attachments live at `/data/vaults/<vaultId>/attachments/`. Exports live at `/data/exports/<jobId>.zip`.

The web and worker deploy independently but are built from the same monorepo so they always share types and the Prisma client.
```

- [ ] **Step 2: Write `docs/data-model.md`**

Create `docs/data-model.md`:

```markdown
# Data model

Postgres, managed by Prisma in `packages/db`. Mirrors the foundation spec.

- User, Account, Session, VerificationToken: NextAuth-standard tables plus our own `User` fields for `name` and `image`.
- Workspace, Membership, Invite: team containers, role-based memberships (OWNER, ADMIN, MEMBER), email invites with one-time tokens.
- Vault: polymorphic owner via `ownerType` (USER or WORKSPACE) and `ownerId`. One personal vault per user, one per workspace.
- Folder: hierarchical, with a denormalised `path` column such as `Projects/Acme/Notes` for fast tree rendering.
- Note: source-of-truth markdown content, belongs to a vault and optionally a folder, records `createdById` and `updatedById`.
- Attachment: metadata only, bytes live on the `/data` volume at `/data/vaults/<vaultId>/attachments/<id>-<filename>`.
- Link: sourceNoteId, targetNoteId (nullable for unresolved), targetTitle, resolved. Recomputed inside the same transaction that updates a note.
- ExportJob: id, vaultId, status (PENDING, RUNNING, COMPLETED, FAILED), startedAt, finishedAt, archivePath, errorMessage, requestedByUserId. Created by the web API, consumed by the worker.

Authorisation goes through a single helper `assertCanAccessVault(userId, vaultId, requiredRole)` exported from `apps/web/src/lib/auth/access.ts`. Every route and server action that touches vault-scoped data calls it.
```

- [ ] **Step 3: Write `docs/deployment.md`**

Create `docs/deployment.md`:

```markdown
# Deployment

The detailed operator runbook lives at `infra/coolify/README.md`. This page summarises the pieces.

- Two container images built from `infra/docker/Dockerfile.web` and `infra/docker/Dockerfile.worker`.
- Postgres provided by Coolify as a managed service in the same compose project.
- Shared Docker named volume mounted at `/data` in both web and worker, used for attachments and export archives.
- Services are exposed over HTTP inside Coolify. Cloudflare provides HTTPS via its proxy.
- CI runs on every pull request: lint, typecheck, unit, and integration tests.
- Playwright E2E runs on pushes to main.
- Semver tags (`v0.1.0` style) trigger the release workflow which publishes the web and worker images to GitHub Container Registry.

Environment variables the runtime requires: `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `DATA_DIR=/data`. See `infra/coolify/env.example` for the canonical template.
```

- [ ] **Step 4: Commit**

```bash
cd /home/jonny/KnowledgeManagment && git add docs/architecture.md docs/data-model.md docs/deployment.md && git commit -m "docs: architecture, data model, and deployment references"
```

---

## Task 22: End-user guides

**Files:**
- Create: `guides/getting-started.md`
- Create: `guides/creating-vaults.md`
- Create: `guides/inviting-members.md`
- Create: `guides/exporting.md`

- [ ] **Step 1: Write `guides/getting-started.md`**

Create `guides/getting-started.md`:

```markdown
# Getting started

Sign up with email and password, or with your Google or GitHub account. The first time you sign in the platform creates a personal vault for you automatically. That vault is private to you and cannot be shared with other users.

From the main screen you can create your first note by clicking New note in the sidebar. Type markdown the way you would in any other editor. The app saves your changes a second or two after you stop typing, and again when you click away from the note.

To link to another note, type two opening square brackets and start typing the target note's title. A short list of suggestions appears. Press Enter to insert the link. If the target does not exist yet, pressing Enter offers to create it. Links are preserved exactly in the markdown source, so an export of your vault is a faithful copy you can open in any other markdown tool.

If you want to share a set of notes with other people, move on to the guide on creating vaults and inviting members.
```

- [ ] **Step 2: Write `guides/creating-vaults.md`**

Create `guides/creating-vaults.md`:

```markdown
# Creating vaults

Every account starts with a private personal vault. To share notes with others, create a workspace. A workspace has exactly one vault that all of its members can read and write.

Open the vault switcher at the top of the sidebar and pick Create workspace. Give the workspace a name. You become its owner, and a shared vault is created for you at the same time. Switch to the new vault using the same switcher. Anything you write there is visible to every member of the workspace.

A single account can belong to any number of workspaces. The switcher lists them together with your personal vault, and the currently selected vault is what the sidebar, file tree, and editor operate on.
```

- [ ] **Step 3: Write `guides/inviting-members.md`**

Create `guides/inviting-members.md`:

```markdown
# Inviting members

Open the settings page for a workspace you own or administer. Find the Members section and enter the email address of the person you want to invite. Pick a role. Admins can manage members and invites. Members can read and write every note in the workspace vault.

The platform generates a one-time invite link tied to that email address. The recipient clicks the link, signs in (or creates an account if they do not have one), and is added to the workspace. Invites expire after a short period; you can revoke or resend them from the same settings page.

In this phase, membership grants full read and write access to everything in the workspace vault. Per-note sharing and finer-grained permissions are planned for a later phase.
```

- [ ] **Step 4: Write `guides/exporting.md`**

Create `guides/exporting.md`:

```markdown
# Exporting a vault

Every vault you can access, personal or shared, can be exported as a zip of markdown files. Open the vault's settings page and click Export vault. The platform queues a background job, and the page shows the status as the job runs.

When the job finishes, a Download zip link appears. The archive contains one `.md` file per note, arranged into folders that mirror the structure inside the vault. Wiki-links are written into the markdown exactly as you typed them. If you open the archive in Obsidian or any other tool that understands wiki-links, the links resolve again.

The platform also runs an automatic export every night for every vault. These nightly exports are kept on the server and can be retrieved by contacting the operator. Triggering a manual export does not disturb the nightly schedule.

If an export fails, the page shows an error message. Try again a few minutes later. If it keeps failing, contact the operator with the job id shown on the page.
```

- [ ] **Step 5: Commit**

```bash
cd /home/jonny/KnowledgeManagment && git add guides/getting-started.md guides/creating-vaults.md guides/inviting-members.md guides/exporting.md && git commit -m "docs(guides): getting started, vaults, members, exporting"
```

---

## Task 23: Final sanity check against CI locally

- [ ] **Step 1: Run the full pipeline**

Run:

```bash
cd /home/jonny/KnowledgeManagment && pnpm install --frozen-lockfile && pnpm --filter @kmgmt/db prisma generate && pnpm -r lint && pnpm -r typecheck && pnpm -r test && DATABASE_URL=postgres://kmgmt:kmgmt@localhost:5432/kmgmt_test pnpm -r test:integration
```

Expected: all steps pass. If the integration step fails because Postgres is not running locally, start one with `docker run --rm -d --name pg -e POSTGRES_USER=kmgmt -e POSTGRES_PASSWORD=kmgmt -e POSTGRES_DB=kmgmt_test -p 5432:5432 postgres:16-alpine` and retry.

- [ ] **Step 2: Build both production images**

Run:

```bash
cd /home/jonny/KnowledgeManagment && docker build -f infra/docker/Dockerfile.web -t kmgmt-web:dev . && docker build -f infra/docker/Dockerfile.worker -t kmgmt-worker:dev .
```

Expected: both images build.

- [ ] **Step 3: Commit if anything drifted**

```bash
cd /home/jonny/KnowledgeManagment && git status
```

Commit any leftover lockfile updates under `chore: lockfile sync` if necessary.

---

## Self-Review

The following checks were run against the spec after drafting:

- Spec coverage:
  - pg-boss in web and worker: Tasks 1, 5, 6.
  - `export-vault` job with required payload shape: Task 2, Task 10.
  - Worker handler reads folders and notes, writes markdown mirroring `Folder.path`, zips to `${DATA_DIR}/exports/<jobId>.zip`, updates `ExportJob` to COMPLETED with archivePath or FAILED with error: Task 10 and Task 11.
  - Wiki-links preserved verbatim and re-importable: Task 3 tests, Task 11 tests.
  - Nightly scheduled export per vault via pg-boss: Task 12.
  - API `POST /api/exports/:vaultId` using `assertCanAccessVault` MEMBER, creates PENDING `ExportJob`, enqueues: Tasks 7, 8, verified in Task 9.
  - API `GET /api/exports/:jobId` status plus download URL: Task 8, Task 9.
  - API download route streaming the zip after authz: Task 8.
  - Export UI on vault settings: Task 13.
  - Integration test for full pipeline and authz tests: Tasks 9 and 11.
  - `infra/docker/Dockerfile.web` multi-stage Next.js production: Task 14.
  - `infra/docker/Dockerfile.worker` Node production: Task 15.
  - Production `docker-compose.yml` with web, worker, postgres, named volume at `/data`: Task 16.
  - `infra/coolify/README.md` runbook including HTTP behind Cloudflare: Task 17.
  - Env var documentation including `DATA_DIR=/data`: Task 17 env.example and docs/deployment.md in Task 21.
  - GitHub Actions CI (lint, typecheck, unit, integration on PR), E2E on main, image build and push on tag: Tasks 18, 19, 20.
  - `docs/` architecture, data model, deployment: Task 21.
  - `guides/` getting started, creating vaults, inviting members, exporting: Task 22.

- Placeholder scan: no "TBD", "implement later", "add validation" entries. Every test has concrete code and every step has concrete commands.

- Type consistency check: `ExportVaultPayload` fields `vaultId`, `requestedByUserId`, `jobId` are used identically in Tasks 2, 6, 7, 8, 10, 11, 12. `assertCanAccessVault(userId, vaultId, requiredRole)` signature matches the spec and is called consistently in Tasks 7, 8. `ExportJob` fields `status`, `startedAt`, `finishedAt`, `archivePath`, `errorMessage`, `requestedByUserId` are the same across creation, update, and selection. `Vault` columns used (`ownerType`, `ownerId`, `name`) match the spec. `Folder.path` is the denormalised path per the spec and is consumed unchanged by the renderer.

No drift found during review.
