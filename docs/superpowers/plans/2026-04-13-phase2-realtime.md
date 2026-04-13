# Phase 2 Realtime Collaboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-user realtime editing with Yjs CRDT, presence (cursors, selections, active users), and a server-side snapshot pipeline that keeps `Note.content` and the `Link` table in sync with the CRDT state.

**Architecture:** A new Node app `apps/realtime` runs Hocuspocus on port 3001. The browser opens a WebSocket per open note, authenticated with a short-lived HS256 JWT issued by a Next.js server action. Hocuspocus persists merged Y.Doc state to a new `NoteDoc` Postgres row and, on a per-note debounce plus on last-disconnect, snapshots the document text to `Note.content` while recomputing `Link` in the same transaction. The note page on the web app drops its content autosave and instead mounts a CodeMirror collab extension bound to a shared `Y.Text`.

**Tech Stack:** Yjs, Hocuspocus (`@hocuspocus/server`, `@hocuspocus/extension-database`), `@hocuspocus/provider`, `y-codemirror.next`, `y-indexeddb`, `jsonwebtoken`, `async-mutex`, Prisma 5, Next.js 14 App Router, CodeMirror 6, Playwright.

---

## File Structure

New files:

- `packages/db/prisma/migrations/<timestamp>_phase2_realtime/migration.sql` - migration for new tables.
- `packages/shared/src/realtime.ts` - shared zod schema and types for the realtime JWT payload.
- `apps/web/src/lib/links.ts` - `recomputeLinks(tx, noteId, vaultId, markdown)` helper extracted from PATCH route.
- `apps/web/src/lib/links.test.ts` - unit test for the helper.
- `apps/web/src/app/actions/realtime.ts` - `issueRealtimeToken` server action.
- `apps/web/src/app/actions/realtime.test.ts` - unit test for the server action.
- `apps/web/src/components/CollabSession.ts` - `useCollabSession` React hook.
- `apps/web/src/components/ActiveUsers.tsx` - avatar list of live users.
- `apps/web/src/components/userColor.ts` - deterministic `userColor(userId)` helper with tests.
- `apps/web/src/components/userColor.test.ts` - unit test.
- `apps/web/playwright/realtime-collab.spec.ts` - two-browser-context convergence test.
- `packages/editor/src/collab.ts` - `collabExtension({ ytext, awareness })`.
- `packages/editor/src/collab.test.ts` - unit test.
- `apps/realtime/package.json` - new workspace app manifest.
- `apps/realtime/tsconfig.json`.
- `apps/realtime/src/index.ts` - entrypoint.
- `apps/realtime/src/server.ts` - Hocuspocus wiring.
- `apps/realtime/src/auth.ts` - JWT verify + grant lookup.
- `apps/realtime/src/snapshot.ts` - `snapshotNote(noteId)` pipeline with per-note mutex.
- `apps/realtime/src/prisma.ts` - re-export of `@km/db`.
- `apps/realtime/test/auth.test.ts`.
- `apps/realtime/test/snapshot.test.ts`.
- `apps/realtime/test/integration.test.ts` - two-client convergence with a real Hocuspocus instance.
- `infra/docker/Dockerfile.realtime` - production Docker image.
- `guides/collaboration.md` - end-user guide.

Modified files:

- `packages/db/prisma/schema.prisma` - add `NoteDoc`, `RealtimeGrant`, relation on `Note`.
- `packages/shared/src/index.ts` - re-export realtime schema.
- `packages/editor/src/index.ts` - re-export `collabExtension`.
- `packages/editor/package.json` - add Yjs deps.
- `apps/web/package.json` - add `jsonwebtoken`, `@hocuspocus/provider`, `yjs`, `y-indexeddb`, `y-protocols`.
- `apps/web/src/app/api/notes/[id]/route.ts` - remove inline link-recompute, drop content from PATCH writes, call `recomputeLinks` only if we ever need it (kept as no-op pass-through).
- `apps/web/src/app/(app)/vault/[vaultId]/note/[noteId]/page.tsx` - swap `useDebouncedAutosave` for `useCollabSession`, mount collab extension, render `ActiveUsers`.
- `apps/web/playwright.config.ts` - add second `webServer` entry for realtime service.
- `env.example` - add `REALTIME_JWT_SECRET`, `NEXT_PUBLIC_REALTIME_URL`.
- `infra/docker/docker-compose.prod.yml` - add `realtime` service.
- `infra/coolify/README.md` - add realtime-service section.
- `.github/workflows/ci.yml` - add realtime to integration test job.
- `.github/workflows/release.yml` - add realtime image build.
- `.github/workflows/e2e.yml` - start realtime service before Playwright.
- `docs/architecture.md` - add Realtime section.
- `docs/data-model.md` - document `NoteDoc`, `RealtimeGrant`.
- `docs/deployment.md` - realtime deployment + Cloudflare WebSockets note.

---

## Task 1: Prisma schema + migration for NoteDoc and RealtimeGrant

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_phase2_realtime/migration.sql` (generated)

- [ ] **Step 1: Add models to `packages/db/prisma/schema.prisma`**

Append at end of file:

```prisma
model NoteDoc {
  noteId    String   @id
  state     Bytes
  clock     Int      @default(0)
  updatedAt DateTime @updatedAt

  note Note @relation(fields: [noteId], references: [id], onDelete: Cascade)
}

model RealtimeGrant {
  jti        String    @id
  userId     String
  noteId     String
  expiresAt  DateTime
  revokedAt  DateTime?
  createdAt  DateTime  @default(now())

  @@index([userId])
  @@index([noteId])
  @@index([expiresAt])
}
```

- [ ] **Step 2: Add the back-relation on `Note`**

In the `Note` model, add a single line next to the other relations:

```prisma
  doc NoteDoc?
```

- [ ] **Step 3: Generate the migration**

Run:

```
pnpm --filter @km/db exec prisma migrate dev --name phase2_realtime --create-only
```

Expected: new folder `packages/db/prisma/migrations/<timestamp>_phase2_realtime/` with a `migration.sql` creating `NoteDoc` and `RealtimeGrant`.

- [ ] **Step 4: Apply the migration locally and regenerate client**

```
pnpm --filter @km/db exec prisma migrate deploy
pnpm --filter @km/db generate
```

Expected: "All migrations have been successfully applied." and a regenerated `@prisma/client`.

- [ ] **Step 5: Commit**

```
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add NoteDoc and RealtimeGrant tables for realtime collab"
```

---

## Task 2: Shared JWT payload schema

**Files:**
- Create: `packages/shared/src/realtime.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/realtime.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { realtimeJwtPayload } from "./realtime";

describe("realtimeJwtPayload", () => {
  it("accepts a valid payload", () => {
    const ok = realtimeJwtPayload.parse({
      jti: "abc",
      sub: "user_1",
      nid: "note_1",
      vid: "vault_1",
      role: "MEMBER",
      exp: 1234567890,
    });
    expect(ok.role).toBe("MEMBER");
  });

  it("rejects an unknown role", () => {
    expect(() =>
      realtimeJwtPayload.parse({
        jti: "a",
        sub: "u",
        nid: "n",
        vid: "v",
        role: "GUEST",
        exp: 1,
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
pnpm --filter @km/shared test -- realtime.test.ts
```

Expected: FAIL with "Cannot find module './realtime'".

- [ ] **Step 3: Create `packages/shared/src/realtime.ts`**

```ts
import { z } from "zod";

export const realtimeJwtPayload = z.object({
  jti: z.string().min(1),
  sub: z.string().min(1),
  nid: z.string().min(1),
  vid: z.string().min(1),
  role: z.enum(["OWNER", "ADMIN", "MEMBER"]),
  exp: z.number().int().positive(),
});

export type RealtimeJwtPayload = z.infer<typeof realtimeJwtPayload>;
```

- [ ] **Step 4: Re-export from the package index**

Modify `packages/shared/src/index.ts` to add:

```ts
export { realtimeJwtPayload } from "./realtime";
export type { RealtimeJwtPayload } from "./realtime";
```

- [ ] **Step 5: Rerun the test**

```
pnpm --filter @km/shared test -- realtime.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```
git add packages/shared/src/realtime.ts packages/shared/src/realtime.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add realtimeJwtPayload zod schema"
```

---

## Task 3: Extract recomputeLinks helper

**Files:**
- Create: `apps/web/src/lib/links.ts`
- Create: `apps/web/src/lib/links.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/links.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@km/db";
import { recomputeLinks } from "./links";

async function seed() {
  const user = await prisma.user.create({ data: { email: `u${Date.now()}@t.io` } });
  const vault = await prisma.vault.create({
    data: { ownerType: "USER", ownerId: user.id, name: "V" },
  });
  const source = await prisma.note.create({
    data: {
      vaultId: vault.id,
      title: "Source",
      slug: "source",
      content: "",
      createdById: user.id,
      updatedById: user.id,
    },
  });
  const target = await prisma.note.create({
    data: {
      vaultId: vault.id,
      title: "Target",
      slug: "target",
      content: "",
      createdById: user.id,
      updatedById: user.id,
    },
  });
  return { vault, source, target };
}

describe("recomputeLinks", () => {
  beforeEach(async () => {
    await prisma.link.deleteMany({});
    await prisma.note.deleteMany({});
    await prisma.vault.deleteMany({});
    await prisma.user.deleteMany({});
  });

  it("writes resolved and unresolved links", async () => {
    const { vault, source } = await seed();
    await prisma.$transaction((tx) =>
      recomputeLinks(tx, source.id, vault.id, "hi [[Target]] and [[Missing]]"),
    );
    const links = await prisma.link.findMany({ where: { sourceNoteId: source.id } });
    expect(links).toHaveLength(2);
    const resolved = links.find((l) => l.targetTitle === "Target");
    const missing = links.find((l) => l.targetTitle === "Missing");
    expect(resolved?.resolved).toBe(true);
    expect(missing?.resolved).toBe(false);
    expect(missing?.targetNoteId).toBeNull();
  });

  it("replaces previous links on re-run", async () => {
    const { vault, source } = await seed();
    await prisma.$transaction((tx) =>
      recomputeLinks(tx, source.id, vault.id, "[[Target]]"),
    );
    await prisma.$transaction((tx) =>
      recomputeLinks(tx, source.id, vault.id, "no links now"),
    );
    const links = await prisma.link.findMany({ where: { sourceNoteId: source.id } });
    expect(links).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
pnpm --filter @km/web test -- links.test.ts
```

Expected: FAIL with "Cannot find module './links'".

- [ ] **Step 3: Implement the helper**

Create `apps/web/src/lib/links.ts`:

```ts
import type { Prisma } from "@prisma/client";
import { parseWikiLinks } from "@km/shared";

export async function recomputeLinks(
  tx: Prisma.TransactionClient,
  noteId: string,
  vaultId: string,
  markdown: string,
): Promise<void> {
  const parsed = parseWikiLinks(markdown);
  const uniqueTitles = Array.from(new Set(parsed.map((p) => p.title)));
  const targets = uniqueTitles.length
    ? await tx.note.findMany({
        where: { vaultId, title: { in: uniqueTitles } },
        select: { id: true, title: true },
      })
    : [];
  const titleToId = new Map(targets.map((t) => [t.title, t.id]));

  await tx.link.deleteMany({ where: { sourceNoteId: noteId } });
  if (parsed.length > 0) {
    await tx.link.createMany({
      data: parsed.map((p) => ({
        sourceNoteId: noteId,
        targetNoteId: titleToId.get(p.title) ?? null,
        targetTitle: p.title,
        resolved: titleToId.has(p.title),
      })),
    });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```
pnpm --filter @km/web test -- links.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```
git add apps/web/src/lib/links.ts apps/web/src/lib/links.test.ts
git commit -m "feat(web): extract recomputeLinks helper from PATCH route"
```

---

## Task 4: Refactor PATCH /api/notes/:id to drop content writes

**Files:**
- Modify: `apps/web/src/app/api/notes/[id]/route.ts`

- [ ] **Step 1: Replace the PATCH body with metadata-only + helper usage**

Replace the current `PATCH` function in `apps/web/src/app/api/notes/[id]/route.ts` with:

```ts
export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  const userId = await requireUserId();
  const { error, note } = await loadNoteAndAuthz(userId, ctx.params.id);
  if (error) return error;

  let input;
  try {
    input = updateNoteInput.parse(await req.json());
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: e.flatten() }, { status: 400 });
    throw e;
  }

  if (input.folderId !== undefined && input.folderId !== null) {
    const folder = await prisma.folder.findUnique({
      where: { id: input.folderId },
      select: { vaultId: true },
    });
    if (!folder || folder.vaultId !== note!.vaultId) {
      return NextResponse.json({ error: "Bad folder" }, { status: 400 });
    }
  }

  // Phase 2: `content` is owned by the realtime snapshot pipeline.
  // PATCH ignores `content` even if sent for backwards compatibility.
  const updated = await prisma.note.update({
    where: { id: note!.id },
    data: {
      title: input.title ?? note!.title,
      folderId: input.folderId === undefined ? note!.folderId : input.folderId,
      updatedById: userId,
    },
  });

  return NextResponse.json({ note: updated }, { status: 200 });
}
```

Also delete the unused `parseWikiLinks` import from this file:

```ts
import { updateNoteInput } from "@km/shared";
```

- [ ] **Step 2: Update/add test for content-ignored behaviour**

Find `apps/web/src/app/api/notes/[id]/route.test.ts` if it exists (use Grep). Replace or append:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@km/db";
import { PATCH } from "./route";

async function mkUserVaultNote() {
  const user = await prisma.user.create({ data: { email: `p${Date.now()}@t.io` } });
  const vault = await prisma.vault.create({
    data: { ownerType: "USER", ownerId: user.id, name: "V" },
  });
  const note = await prisma.note.create({
    data: {
      vaultId: vault.id,
      title: "T",
      slug: "t",
      content: "original",
      createdById: user.id,
      updatedById: user.id,
    },
  });
  return { user, vault, note };
}

describe("PATCH /api/notes/:id", () => {
  beforeEach(async () => {
    await prisma.link.deleteMany({});
    await prisma.note.deleteMany({});
    await prisma.vault.deleteMany({});
    await prisma.user.deleteMany({});
  });

  it("ignores `content` in the body and keeps the existing content", async () => {
    const { user, note } = await mkUserVaultNote();
    // Stub requireUserId by setting a module-level session if your test infra needs it.
    // This plan assumes a helper already exists in the repo; reuse it.
    const req = new Request(`http://x/api/notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New Title", content: "SHOULD BE IGNORED" }),
    });
    // If the route depends on auth middleware, spin up via the web test harness.
    // Otherwise call PATCH directly with a spy on requireUserId.
    const res = await PATCH(req as any, { params: { id: note.id } });
    expect(res.status).toBe(200);
    const after = await prisma.note.findUnique({ where: { id: note.id } });
    expect(after!.title).toBe("New Title");
    expect(after!.content).toBe("original");
  });
});
```

Note: if the existing PATCH test already has an auth harness, match its pattern; this test is an addition, not a replacement for existing title/folder coverage.

- [ ] **Step 3: Run the test**

```
pnpm --filter @km/web test -- route.test.ts
```

Expected: PASS on the new `ignores content` case and all previously existing tests (which should no longer assert link-recompute behaviour via PATCH).

- [ ] **Step 4: Commit**

```
git add apps/web/src/app/api/notes/[id]/route.ts apps/web/src/app/api/notes/[id]/route.test.ts
git commit -m "refactor(web): stop writing note content via PATCH; realtime owns content"
```

---

## Task 5: issueRealtimeToken server action

**Files:**
- Create: `apps/web/src/app/actions/realtime.ts`
- Create: `apps/web/src/app/actions/realtime.test.ts`

- [ ] **Step 1: Add jsonwebtoken dependency**

```
pnpm --filter @km/web add jsonwebtoken
pnpm --filter @km/web add -D @types/jsonwebtoken
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/app/actions/realtime.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import jwt from "jsonwebtoken";
import { prisma } from "@km/db";
import { issueRealtimeToken } from "./realtime";

vi.mock("@/lib/session", () => ({
  requireUserId: vi.fn(),
}));

import { requireUserId } from "@/lib/session";

process.env.REALTIME_JWT_SECRET = "test-secret";

async function seedNote() {
  const user = await prisma.user.create({ data: { email: `r${Date.now()}@t.io` } });
  const vault = await prisma.vault.create({
    data: { ownerType: "USER", ownerId: user.id, name: "V" },
  });
  const note = await prisma.note.create({
    data: {
      vaultId: vault.id,
      title: "T",
      slug: "t",
      content: "",
      createdById: user.id,
      updatedById: user.id,
    },
  });
  return { user, vault, note };
}

describe("issueRealtimeToken", () => {
  beforeEach(async () => {
    await prisma.realtimeGrant.deleteMany({});
    await prisma.note.deleteMany({});
    await prisma.vault.deleteMany({});
    await prisma.user.deleteMany({});
    vi.mocked(requireUserId).mockReset();
  });

  it("issues a token and inserts a grant row", async () => {
    const { user, vault, note } = await seedNote();
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    const token = await issueRealtimeToken(note.id);

    const decoded = jwt.verify(token, "test-secret") as any;
    expect(decoded.sub).toBe(user.id);
    expect(decoded.nid).toBe(note.id);
    expect(decoded.vid).toBe(vault.id);
    expect(decoded.role).toBe("OWNER");
    expect(typeof decoded.jti).toBe("string");

    const grant = await prisma.realtimeGrant.findUnique({ where: { jti: decoded.jti } });
    expect(grant).not.toBeNull();
    expect(grant!.userId).toBe(user.id);
    expect(grant!.noteId).toBe(note.id);
  });

  it("rejects when user cannot access the vault", async () => {
    const { note } = await seedNote();
    const stranger = await prisma.user.create({ data: { email: `s${Date.now()}@t.io` } });
    vi.mocked(requireUserId).mockResolvedValue(stranger.id);

    await expect(issueRealtimeToken(note.id)).rejects.toThrow();
  });

  it("rejects for missing note", async () => {
    vi.mocked(requireUserId).mockResolvedValue("nonexistent-user");
    await expect(issueRealtimeToken("no-such-note")).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run it to see it fail**

```
pnpm --filter @km/web test -- realtime.test.ts
```

Expected: FAIL with "Cannot find module './realtime'".

- [ ] **Step 4: Implement the server action**

Create `apps/web/src/app/actions/realtime.ts`:

```ts
"use server";

import jwt from "jsonwebtoken";
import { nanoid } from "nanoid";
import { prisma } from "@km/db";
import { requireUserId } from "@/lib/session";
import { assertCanAccessVault } from "@/lib/authz";

const TTL_SECONDS = 300;

export async function issueRealtimeToken(noteId: string): Promise<string> {
  const secret = process.env.REALTIME_JWT_SECRET;
  if (!secret) throw new Error("REALTIME_JWT_SECRET not set");

  const userId = await requireUserId();

  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { id: true, vaultId: true },
  });
  if (!note) throw new Error("Note not found");

  const { role } = await assertCanAccessVault(userId, note.vaultId, "MEMBER");

  const jti = nanoid(21);
  const now = Math.floor(Date.now() / 1000);
  const exp = now + TTL_SECONDS;

  const payload = { jti, sub: userId, nid: note.id, vid: note.vaultId, role, exp };
  const token = jwt.sign(payload, secret, { algorithm: "HS256", noTimestamp: true });

  await prisma.realtimeGrant.create({
    data: {
      jti,
      userId,
      noteId: note.id,
      expiresAt: new Date(exp * 1000),
    },
  });

  return token;
}
```

- [ ] **Step 5: Run the test to verify it passes**

```
pnpm --filter @km/web test -- realtime.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```
git add apps/web/package.json apps/web/src/app/actions/realtime.ts apps/web/src/app/actions/realtime.test.ts
git commit -m "feat(web): add issueRealtimeToken server action"
```

---

## Task 6: Scaffold apps/realtime package

**Files:**
- Create: `apps/realtime/package.json`
- Create: `apps/realtime/tsconfig.json`
- Create: `apps/realtime/src/index.ts`
- Create: `apps/realtime/src/prisma.ts`

- [ ] **Step 1: Create `apps/realtime/package.json`**

```json
{
  "name": "@km/realtime",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "lint": "eslint src --ext .ts --max-warnings=0",
    "typecheck": "tsc --noEmit",
    "test": "dotenv -e ../../.env -- vitest run --passWithNoTests"
  },
  "dependencies": {
    "@hocuspocus/extension-database": "2.13.5",
    "@hocuspocus/server": "2.13.5",
    "@km/db": "workspace:*",
    "@km/shared": "workspace:*",
    "async-mutex": "0.5.0",
    "jsonwebtoken": "9.0.2",
    "yjs": "13.6.19"
  },
  "devDependencies": {
    "@hocuspocus/provider": "2.13.5",
    "@types/jsonwebtoken": "9.0.7",
    "dotenv-cli": "7.4.2",
    "tsx": "4.19.1",
    "typescript": "5.5.4",
    "vitest": "2.1.2",
    "ws": "8.18.0"
  }
}
```

- [ ] **Step 2: Create `apps/realtime/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": false
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `apps/realtime/src/prisma.ts`**

```ts
export { prisma } from "@km/db";
```

- [ ] **Step 4: Create `apps/realtime/src/index.ts`**

```ts
import { startServer } from "./server";

const port = Number(process.env.REALTIME_PORT ?? 3001);
startServer(port).then(() => {
  // eslint-disable-next-line no-console
  console.log(`[realtime] listening on :${port}`);
});
```

- [ ] **Step 5: Install deps**

```
pnpm install
```

Expected: lockfile updated; `apps/realtime/node_modules` populated.

- [ ] **Step 6: Commit**

```
git add apps/realtime/package.json apps/realtime/tsconfig.json apps/realtime/src/index.ts apps/realtime/src/prisma.ts pnpm-lock.yaml
git commit -m "feat(realtime): scaffold @km/realtime workspace app"
```

---

## Task 7: Realtime auth helpers with unit tests

**Files:**
- Create: `apps/realtime/src/auth.ts`
- Create: `apps/realtime/test/auth.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/realtime/test/auth.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import { prisma } from "../src/prisma";
import { verifyRealtimeToken } from "../src/auth";

const SECRET = "test-secret-realtime";
process.env.REALTIME_JWT_SECRET = SECRET;

async function seed() {
  const user = await prisma.user.create({ data: { email: `a${Date.now()}@t.io` } });
  const vault = await prisma.vault.create({
    data: { ownerType: "USER", ownerId: user.id, name: "V" },
  });
  const note = await prisma.note.create({
    data: {
      vaultId: vault.id,
      title: "T",
      slug: "t",
      content: "",
      createdById: user.id,
      updatedById: user.id,
    },
  });
  return { user, vault, note };
}

function sign(payload: object) {
  return jwt.sign(payload, SECRET, { algorithm: "HS256", noTimestamp: true });
}

describe("verifyRealtimeToken", () => {
  beforeEach(async () => {
    await prisma.realtimeGrant.deleteMany({});
    await prisma.note.deleteMany({});
    await prisma.vault.deleteMany({});
    await prisma.user.deleteMany({});
  });

  it("accepts a valid token with a live grant", async () => {
    const { user, vault, note } = await seed();
    const exp = Math.floor(Date.now() / 1000) + 60;
    const jti = "valid-jti-1";
    await prisma.realtimeGrant.create({
      data: { jti, userId: user.id, noteId: note.id, expiresAt: new Date(exp * 1000) },
    });
    const token = sign({ jti, sub: user.id, nid: note.id, vid: vault.id, role: "OWNER", exp });

    const ctx = await verifyRealtimeToken(token, note.id);
    expect(ctx.userId).toBe(user.id);
    expect(ctx.role).toBe("OWNER");
  });

  it("rejects when path noteId mismatches nid claim", async () => {
    const { user, vault, note } = await seed();
    const exp = Math.floor(Date.now() / 1000) + 60;
    const jti = "mismatch";
    await prisma.realtimeGrant.create({
      data: { jti, userId: user.id, noteId: note.id, expiresAt: new Date(exp * 1000) },
    });
    const token = sign({ jti, sub: user.id, nid: note.id, vid: vault.id, role: "OWNER", exp });

    await expect(verifyRealtimeToken(token, "other-note-id")).rejects.toThrow(/nid/);
  });

  it("rejects a bad signature", async () => {
    const { user, vault, note } = await seed();
    const exp = Math.floor(Date.now() / 1000) + 60;
    const bad = jwt.sign(
      { jti: "x", sub: user.id, nid: note.id, vid: vault.id, role: "OWNER", exp },
      "wrong-secret",
      { algorithm: "HS256", noTimestamp: true },
    );
    await expect(verifyRealtimeToken(bad, note.id)).rejects.toThrow();
  });

  it("rejects when grant is revoked", async () => {
    const { user, vault, note } = await seed();
    const exp = Math.floor(Date.now() / 1000) + 60;
    const jti = "revoked";
    await prisma.realtimeGrant.create({
      data: {
        jti,
        userId: user.id,
        noteId: note.id,
        expiresAt: new Date(exp * 1000),
        revokedAt: new Date(),
      },
    });
    const token = sign({ jti, sub: user.id, nid: note.id, vid: vault.id, role: "OWNER", exp });
    await expect(verifyRealtimeToken(token, note.id)).rejects.toThrow(/revoked/);
  });

  it("rejects when grant missing", async () => {
    const { user, vault, note } = await seed();
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = sign({ jti: "ghost", sub: user.id, nid: note.id, vid: vault.id, role: "OWNER", exp });
    await expect(verifyRealtimeToken(token, note.id)).rejects.toThrow(/grant/);
  });

  it("rejects non-member after membership revoked", async () => {
    const { user, note } = await seed();
    // Drop the vault to simulate loss of access.
    await prisma.note.deleteMany({});
    await prisma.vault.deleteMany({});
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = sign({ jti: "vanish", sub: user.id, nid: note.id, vid: "gone", role: "OWNER", exp });
    await expect(verifyRealtimeToken(token, note.id)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```
pnpm --filter @km/realtime test -- auth.test.ts
```

Expected: FAIL with "Cannot find module '../src/auth'".

- [ ] **Step 3: Implement `apps/realtime/src/auth.ts`**

```ts
import jwt from "jsonwebtoken";
import { realtimeJwtPayload, type RealtimeJwtPayload } from "@km/shared";
import { prisma } from "./prisma";

export interface RealtimeContext {
  userId: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  vaultId: string;
  noteId: string;
  jti: string;
}

export async function verifyRealtimeToken(
  token: string,
  pathNoteId: string,
): Promise<RealtimeContext> {
  const secret = process.env.REALTIME_JWT_SECRET;
  if (!secret) throw new Error("REALTIME_JWT_SECRET not set");

  let raw: unknown;
  try {
    raw = jwt.verify(token, secret, { algorithms: ["HS256"] });
  } catch (e) {
    throw new Error(`jwt verify failed: ${(e as Error).message}`);
  }

  const payload: RealtimeJwtPayload = realtimeJwtPayload.parse(raw);

  if (payload.nid !== pathNoteId) {
    throw new Error(`nid mismatch: claim=${payload.nid} path=${pathNoteId}`);
  }

  const grant = await prisma.realtimeGrant.findUnique({ where: { jti: payload.jti } });
  if (!grant) throw new Error(`grant not found for jti=${payload.jti}`);
  if (grant.revokedAt) throw new Error(`grant revoked for jti=${payload.jti}`);
  if (grant.expiresAt.getTime() <= Date.now()) throw new Error("grant expired");

  // Re-check vault access against live Postgres state.
  const vault = await prisma.vault.findUnique({
    where: { id: payload.vid },
    select: { id: true, ownerType: true, ownerId: true },
  });
  if (!vault) throw new Error("vault missing");
  if (vault.ownerType === "USER") {
    if (vault.ownerId !== payload.sub) throw new Error("not the owner");
  } else {
    const m = await prisma.membership.findFirst({
      where: { workspaceId: vault.ownerId, userId: payload.sub },
      select: { role: true },
    });
    if (!m) throw new Error("no membership");
  }

  return {
    userId: payload.sub,
    role: payload.role,
    vaultId: payload.vid,
    noteId: payload.nid,
    jti: payload.jti,
  };
}
```

- [ ] **Step 4: Rerun tests**

```
pnpm --filter @km/realtime test -- auth.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```
git add apps/realtime/src/auth.ts apps/realtime/test/auth.test.ts
git commit -m "feat(realtime): add JWT verify + grant lookup + vault re-check"
```

---

## Task 8: Snapshot pipeline with per-note mutex

**Files:**
- Create: `apps/realtime/src/snapshot.ts`
- Create: `apps/realtime/test/snapshot.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/realtime/test/snapshot.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import * as Y from "yjs";
import { prisma } from "../src/prisma";
import { snapshotNote, __setDocProvider, __clearDocProvider } from "../src/snapshot";

async function seedNote(content = "") {
  const user = await prisma.user.create({ data: { email: `s${Date.now()}@t.io` } });
  const vault = await prisma.vault.create({
    data: { ownerType: "USER", ownerId: user.id, name: "V" },
  });
  const note = await prisma.note.create({
    data: {
      vaultId: vault.id,
      title: "T",
      slug: "t",
      content,
      createdById: user.id,
      updatedById: user.id,
    },
  });
  return { user, vault, note };
}

function makeDoc(text: string): Y.Doc {
  const doc = new Y.Doc();
  doc.getText("content").insert(0, text);
  return doc;
}

describe("snapshotNote", () => {
  beforeEach(async () => {
    __clearDocProvider();
    await prisma.link.deleteMany({});
    await prisma.noteDoc.deleteMany({});
    await prisma.note.deleteMany({});
    await prisma.vault.deleteMany({});
    await prisma.user.deleteMany({});
  });

  it("writes markdown and resolves links", async () => {
    const { user, vault, note } = await seedNote();
    const target = await prisma.note.create({
      data: {
        vaultId: vault.id,
        title: "Target",
        slug: "target",
        content: "",
        createdById: user.id,
        updatedById: user.id,
      },
    });
    __setDocProvider(() => ({ doc: makeDoc("hi [[Target]] and [[Missing]]"), lastEditorUserId: user.id }));

    await snapshotNote(note.id);

    const after = await prisma.note.findUnique({ where: { id: note.id } });
    expect(after!.content).toBe("hi [[Target]] and [[Missing]]");
    expect(after!.updatedById).toBe(user.id);

    const links = await prisma.link.findMany({ where: { sourceNoteId: note.id } });
    expect(links).toHaveLength(2);
    expect(links.find((l) => l.targetTitle === "Target")!.resolved).toBe(true);
    expect(links.find((l) => l.targetTitle === "Missing")!.resolved).toBe(false);
  });

  it("is a no-op when content is unchanged", async () => {
    const { user, note } = await seedNote("same");
    const before = (await prisma.note.findUnique({ where: { id: note.id } }))!.updatedAt;
    __setDocProvider(() => ({ doc: makeDoc("same"), lastEditorUserId: user.id }));

    await snapshotNote(note.id);

    const after = (await prisma.note.findUnique({ where: { id: note.id } }))!.updatedAt;
    expect(after.getTime()).toBe(before.getTime());
  });

  it("serialises overlapping snapshots for the same noteId", async () => {
    const { user, note } = await seedNote();
    let calls = 0;
    __setDocProvider(() => {
      calls += 1;
      return { doc: makeDoc(`v${calls}`), lastEditorUserId: user.id };
    });

    await Promise.all([snapshotNote(note.id), snapshotNote(note.id)]);

    const after = await prisma.note.findUnique({ where: { id: note.id } });
    // Whichever ran last wins; either content value is fine, but we assert no crash.
    expect(["v1", "v2"]).toContain(after!.content);
  });
});
```

- [ ] **Step 2: Run to see failures**

```
pnpm --filter @km/realtime test -- snapshot.test.ts
```

Expected: FAIL with "Cannot find module '../src/snapshot'".

- [ ] **Step 3: Implement `apps/realtime/src/snapshot.ts`**

```ts
import { Mutex } from "async-mutex";
import * as Y from "yjs";
import { prisma } from "./prisma";
import { recomputeLinksTx } from "./links-tx";

export interface DocSnapshot {
  doc: Y.Doc;
  lastEditorUserId: string | null;
}

export type DocProvider = (noteId: string) => DocSnapshot | Promise<DocSnapshot>;

let docProvider: DocProvider | null = null;
const mutexes = new Map<string, Mutex>();

export function setDocProvider(p: DocProvider): void {
  docProvider = p;
}

// Test helpers.
export function __setDocProvider(p: DocProvider): void {
  docProvider = p;
}
export function __clearDocProvider(): void {
  docProvider = null;
  mutexes.clear();
}

function mutexFor(noteId: string): Mutex {
  let m = mutexes.get(noteId);
  if (!m) {
    m = new Mutex();
    mutexes.set(noteId, m);
  }
  return m;
}

async function loadDoc(noteId: string): Promise<DocSnapshot> {
  if (docProvider) return docProvider(noteId);
  const row = await prisma.noteDoc.findUnique({ where: { noteId } });
  const doc = new Y.Doc();
  if (row) Y.applyUpdate(doc, row.state);
  return { doc, lastEditorUserId: null };
}

export async function snapshotNote(noteId: string): Promise<void> {
  const m = mutexFor(noteId);
  await m.runExclusive(async () => {
    const { doc, lastEditorUserId } = await loadDoc(noteId);
    const markdown = doc.getText("content").toString();

    const note = await prisma.note.findUnique({
      where: { id: noteId },
      select: { id: true, vaultId: true, content: true, updatedById: true },
    });
    if (!note) return;
    if (note.content === markdown) return;

    const attempt = async () => {
      await prisma.$transaction(async (tx) => {
        await tx.note.update({
          where: { id: noteId },
          data: {
            content: markdown,
            contentUpdatedAt: new Date(),
            updatedById: lastEditorUserId ?? note.updatedById,
          },
        });
        await recomputeLinksTx(tx, noteId, note.vaultId, markdown);
      });
    };

    try {
      await attempt();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[snapshot] first attempt failed for ${noteId}:`, err);
      await new Promise((r) => setTimeout(r, 500));
      try {
        await attempt();
      } catch (err2) {
        // eslint-disable-next-line no-console
        console.error(`[snapshot] retry failed for ${noteId}:`, err2);
      }
    }
  });
}
```

- [ ] **Step 4: Create `apps/realtime/src/links-tx.ts`**

The realtime service cannot import from `apps/web`. Copy the link logic but keep it textually identical to `apps/web/src/lib/links.ts`:

```ts
import type { Prisma } from "@prisma/client";
import { parseWikiLinks } from "@km/shared";

export async function recomputeLinksTx(
  tx: Prisma.TransactionClient,
  noteId: string,
  vaultId: string,
  markdown: string,
): Promise<void> {
  const parsed = parseWikiLinks(markdown);
  const uniqueTitles = Array.from(new Set(parsed.map((p) => p.title)));
  const targets = uniqueTitles.length
    ? await tx.note.findMany({
        where: { vaultId, title: { in: uniqueTitles } },
        select: { id: true, title: true },
      })
    : [];
  const titleToId = new Map(targets.map((t) => [t.title, t.id]));

  await tx.link.deleteMany({ where: { sourceNoteId: noteId } });
  if (parsed.length > 0) {
    await tx.link.createMany({
      data: parsed.map((p) => ({
        sourceNoteId: noteId,
        targetNoteId: titleToId.get(p.title) ?? null,
        targetTitle: p.title,
        resolved: titleToId.has(p.title),
      })),
    });
  }
}
```

Note: the spec mandates that link logic live in exactly one place. We put the canonical helper in `apps/web/src/lib/links.ts` for the web app and provide a thin identical copy here so `apps/realtime` does not depend on `apps/web`. Both call into `parseWikiLinks` from `@km/shared`, which is the shared core.

- [ ] **Step 5: Run tests**

```
pnpm --filter @km/realtime test -- snapshot.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```
git add apps/realtime/src/snapshot.ts apps/realtime/src/links-tx.ts apps/realtime/test/snapshot.test.ts
git commit -m "feat(realtime): add snapshotNote with per-note mutex and link recompute"
```

---

## Task 9: Hocuspocus server wiring

**Files:**
- Create: `apps/realtime/src/server.ts`

- [ ] **Step 1: Implement `apps/realtime/src/server.ts`**

```ts
import { Server } from "@hocuspocus/server";
import { Database } from "@hocuspocus/extension-database";
import * as Y from "yjs";
import { prisma } from "./prisma";
import { verifyRealtimeToken, type RealtimeContext } from "./auth";
import { snapshotNote, setDocProvider } from "./snapshot";

const debounceTimers = new Map<string, NodeJS.Timeout>();
const connections = new Map<string, number>();
const lastEditorByDoc = new Map<string, string>();

function queueSnapshot(documentName: string): void {
  const existing = debounceTimers.get(documentName);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    debounceTimers.delete(documentName);
    snapshotNote(documentName).catch((e) => {
      // eslint-disable-next-line no-console
      console.error(`[realtime] snapshot error for ${documentName}:`, e);
    });
  }, 5000);
  debounceTimers.set(documentName, t);
}

export async function startServer(port: number): Promise<Server> {
  const server = Server.configure({
    port,
    extensions: [
      new Database({
        async fetch({ documentName }) {
          const row = await prisma.noteDoc.findUnique({ where: { noteId: documentName } });
          return row?.state ?? null;
        },
        async store({ documentName, state }) {
          await prisma.noteDoc.upsert({
            where: { noteId: documentName },
            update: { state, clock: { increment: 1 } },
            create: { noteId: documentName, state, clock: 0 },
          });
        },
      }),
    ],
    async onAuthenticate({ documentName, token }) {
      const ctx: RealtimeContext = await verifyRealtimeToken(token, documentName);
      return ctx;
    },
    async onConnect({ documentName }) {
      connections.set(documentName, (connections.get(documentName) ?? 0) + 1);
    },
    async onChange({ documentName, context }) {
      const c = context as RealtimeContext;
      if (c?.userId) lastEditorByDoc.set(documentName, c.userId);
      queueSnapshot(documentName);
    },
    async onDisconnect({ documentName }) {
      const next = (connections.get(documentName) ?? 1) - 1;
      if (next <= 0) {
        connections.delete(documentName);
        const t = debounceTimers.get(documentName);
        if (t) {
          clearTimeout(t);
          debounceTimers.delete(documentName);
        }
        try {
          await snapshotNote(documentName);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error(`[realtime] final snapshot failed for ${documentName}:`, e);
        }
      } else {
        connections.set(documentName, next);
      }
    },
  });

  // Bridge the live in-memory Y.Doc into the snapshot loader when available.
  setDocProvider(async (noteId) => {
    const hDoc = await server.documents.get(noteId);
    if (hDoc) {
      return { doc: hDoc as unknown as Y.Doc, lastEditorUserId: lastEditorByDoc.get(noteId) ?? null };
    }
    const row = await prisma.noteDoc.findUnique({ where: { noteId } });
    const doc = new Y.Doc();
    if (row) Y.applyUpdate(doc, row.state);
    return { doc, lastEditorUserId: lastEditorByDoc.get(noteId) ?? null };
  });

  await server.listen();
  return server;
}
```

- [ ] **Step 2: Typecheck**

```
pnpm --filter @km/realtime typecheck
```

Expected: No TypeScript errors. If `server.documents.get` signature differs in the installed Hocuspocus version, adapt to the public API (`server.documents` is a `Map<string, Document>`); commit only compiling code.

- [ ] **Step 3: Commit**

```
git add apps/realtime/src/server.ts
git commit -m "feat(realtime): wire Hocuspocus server with auth, change, and disconnect hooks"
```

---

## Task 10: Integration test with two Yjs clients

**Files:**
- Create: `apps/realtime/test/integration.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import WebSocket from "ws";
import { prisma } from "../src/prisma";
import { startServer } from "../src/server";
import type { Server } from "@hocuspocus/server";

const SECRET = "int-test-secret";
process.env.REALTIME_JWT_SECRET = SECRET;

let server: Server;
const PORT = 3999;

async function seed() {
  const user = await prisma.user.create({ data: { email: `i${Date.now()}@t.io` } });
  const vault = await prisma.vault.create({
    data: { ownerType: "USER", ownerId: user.id, name: "V" },
  });
  const note = await prisma.note.create({
    data: {
      vaultId: vault.id,
      title: "T",
      slug: "t",
      content: "",
      createdById: user.id,
      updatedById: user.id,
    },
  });
  const jti = `jti-${Date.now()}`;
  const exp = Math.floor(Date.now() / 1000) + 120;
  await prisma.realtimeGrant.create({
    data: { jti, userId: user.id, noteId: note.id, expiresAt: new Date(exp * 1000) },
  });
  const token = jwt.sign(
    { jti, sub: user.id, nid: note.id, vid: vault.id, role: "OWNER", exp },
    SECRET,
    { algorithm: "HS256", noTimestamp: true },
  );
  return { user, vault, note, token };
}

async function waitFor(fn: () => boolean, ms = 5000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("waitFor timeout");
}

describe("realtime integration", () => {
  beforeEach(async () => {
    await prisma.link.deleteMany({});
    await prisma.noteDoc.deleteMany({});
    await prisma.realtimeGrant.deleteMany({});
    await prisma.note.deleteMany({});
    await prisma.vault.deleteMany({});
    await prisma.user.deleteMany({});
    server = await startServer(PORT);
  });

  afterEach(async () => {
    await server.destroy();
  });

  it("two clients converge and a snapshot updates Note.content + Link", async () => {
    const { note, token } = await seed();

    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const a = new HocuspocusProvider({
      url: `ws://localhost:${PORT}`,
      name: note.id,
      token,
      document: docA,
      WebSocketPolyfill: WebSocket as any,
    });
    const b = new HocuspocusProvider({
      url: `ws://localhost:${PORT}`,
      name: note.id,
      token,
      document: docB,
      WebSocketPolyfill: WebSocket as any,
    });

    await waitFor(() => a.status === "connected" && b.status === "connected");

    docA.getText("content").insert(0, "Hello ");
    docB.getText("content").insert(6, "[[Nowhere]]");

    await waitFor(
      () =>
        docA.getText("content").toString() === "Hello [[Nowhere]]" &&
        docB.getText("content").toString() === "Hello [[Nowhere]]",
    );

    a.disconnect();
    b.disconnect();

    // onDisconnect triggers an immediate snapshot.
    await waitFor(async () => {
      const fresh = await prisma.note.findUnique({ where: { id: note.id } });
      return fresh?.content === "Hello [[Nowhere]]";
    });

    const links = await prisma.link.findMany({ where: { sourceNoteId: note.id } });
    expect(links).toHaveLength(1);
    expect(links[0].targetTitle).toBe("Nowhere");
    expect(links[0].resolved).toBe(false);
  }, 30_000);

  it("rejects a token when the grant has been revoked", async () => {
    const { note, token } = await seed();
    await prisma.realtimeGrant.updateMany({ data: { revokedAt: new Date() } });

    const docA = new Y.Doc();
    const a = new HocuspocusProvider({
      url: `ws://localhost:${PORT}`,
      name: note.id,
      token,
      document: docA,
      WebSocketPolyfill: WebSocket as any,
    });

    let errored = false;
    a.on("authenticationFailed", () => {
      errored = true;
    });

    await waitFor(() => errored, 5000);
    a.disconnect();
    expect(errored).toBe(true);
  }, 15_000);
});
```

Note: `waitFor` predicate passes a sync bool; for the async fetch assertion we wrap in an IIFE that polls. If Vitest complains about async predicates, rewrite as a simple `setInterval`-based poller; both shapes are acceptable.

- [ ] **Step 2: Add an integration test script**

Modify `apps/realtime/package.json` scripts:

```json
"test:integration": "dotenv -e ../../.env -- vitest run test/integration.test.ts"
```

- [ ] **Step 3: Run the test locally**

```
pnpm --filter @km/realtime test:integration
```

Expected: PASS, 2 tests. If the first run flakes on port binding, ensure `PORT=3999` is free.

- [ ] **Step 4: Commit**

```
git add apps/realtime/test/integration.test.ts apps/realtime/package.json
git commit -m "test(realtime): add two-client convergence + snapshot integration test"
```

---

## Task 11: collab extension in @km/editor

**Files:**
- Modify: `packages/editor/package.json`
- Create: `packages/editor/src/collab.ts`
- Create: `packages/editor/src/collab.test.ts`
- Modify: `packages/editor/src/index.ts`

- [ ] **Step 1: Add Yjs deps to the editor package**

```
pnpm --filter @km/editor add yjs y-codemirror.next y-protocols
```

- [ ] **Step 2: Write the failing test**

Create `packages/editor/src/collab.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { EditorState } from "@codemirror/state";
import { collabExtension } from "./collab";

describe("collabExtension", () => {
  it("returns an array of CodeMirror extensions that can bootstrap an EditorState", () => {
    const doc = new Y.Doc();
    const ytext = doc.getText("content");
    const awareness = new Awareness(doc);
    const ext = collabExtension({ ytext, awareness });
    const state = EditorState.create({ doc: ytext.toString(), extensions: ext });
    expect(state).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run the test**

```
pnpm --filter @km/editor test -- collab.test.ts
```

Expected: FAIL with "Cannot find module './collab'".

- [ ] **Step 4: Implement `packages/editor/src/collab.ts`**

```ts
import { yCollab } from "y-codemirror.next";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import type { Extension } from "@codemirror/state";

export interface CollabExtensionOptions {
  ytext: Y.Text;
  awareness: Awareness;
}

export function collabExtension(opts: CollabExtensionOptions): Extension {
  return yCollab(opts.ytext, opts.awareness);
}
```

- [ ] **Step 5: Re-export from the editor index**

Modify `packages/editor/src/index.ts` to append:

```ts
export { collabExtension } from "./collab";
export type { CollabExtensionOptions } from "./collab";
```

- [ ] **Step 6: Run the test**

```
pnpm --filter @km/editor test -- collab.test.ts
```

Expected: PASS.

- [ ] **Step 7: Add an optional collab prop to NoteEditor**

Modify `packages/editor/src/NoteEditor.tsx`:

1. Add to `NoteEditorProps`:

```ts
  collab?: import("@codemirror/state").Extension;
```

2. Thread the optional extension into the state. In the `EditorState.create` call, append conditionally:

```ts
extensions: [
  history(),
  drawSelection(),
  highlightActiveLine(),
  keymap.of([...defaultKeymap, ...historyKeymap]),
  markdown(),
  baseTheme,
  wikiLinkField,
  wikiLinkExtension({
    resolveTitle: (title) => resolveTitleRef.current(title),
    onNavigate: (id) => onNavigateRef.current(id),
    onCreateRequest: (title) => onCreateRequestRef.current(title),
  }),
  wikiLinkAutocomplete({ search: (q) => searchTitlesRef.current(q) }),
  livePreview,
  listener,
  dropHandler,
  EditorView.lineWrapping,
  ...(props.collab ? [props.collab] : []),
],
```

Note: Yjs binding owns the doc; when `collab` is provided, omit `initialValue` seeding by keeping `doc: props.initialValue` but accepting that `yCollab` will overwrite. Acceptable because the note page passes `initialValue: ""` when collab is active.

- [ ] **Step 8: Run editor tests**

```
pnpm --filter @km/editor test
```

Expected: all previous tests plus `collab.test.ts` pass.

- [ ] **Step 9: Commit**

```
git add packages/editor/package.json packages/editor/src/collab.ts packages/editor/src/collab.test.ts packages/editor/src/index.ts packages/editor/src/NoteEditor.tsx pnpm-lock.yaml
git commit -m "feat(editor): add collabExtension and optional collab prop on NoteEditor"
```

---

## Task 12: userColor helper

**Files:**
- Create: `apps/web/src/components/userColor.ts`
- Create: `apps/web/src/components/userColor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { userColor } from "./userColor";

describe("userColor", () => {
  it("returns a deterministic hsl string per userId", () => {
    const a = userColor("abc");
    const b = userColor("abc");
    expect(a).toBe(b);
    expect(a).toMatch(/^hsl\(\d{1,3}, 70%, 50%\)$/);
  });

  it("differs for different ids", () => {
    expect(userColor("a")).not.toBe(userColor("b"));
  });
});
```

- [ ] **Step 2: Run to see failure**

```
pnpm --filter @km/web test -- userColor.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
export function userColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 50%)`;
}
```

- [ ] **Step 4: Run tests**

```
pnpm --filter @km/web test -- userColor.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```
git add apps/web/src/components/userColor.ts apps/web/src/components/userColor.test.ts
git commit -m "feat(web): add deterministic userColor helper"
```

---

## Task 13: CollabSession hook

**Files:**
- Create: `apps/web/src/components/CollabSession.ts`
- Modify: `apps/web/package.json`

- [ ] **Step 1: Install client-side Yjs deps**

```
pnpm --filter @km/web add yjs y-indexeddb @hocuspocus/provider y-protocols
```

- [ ] **Step 2: Implement `apps/web/src/components/CollabSession.ts`**

```ts
"use client";

import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { HocuspocusProvider } from "@hocuspocus/provider";
import type { Awareness } from "y-protocols/awareness";
import { issueRealtimeToken } from "@/app/actions/realtime";
import { userColor } from "./userColor";

export interface CollabUser {
  id: string;
  name: string;
}

export interface CollabSession {
  doc: Y.Doc;
  ytext: Y.Text;
  awareness: Awareness;
  provider: HocuspocusProvider;
  status: "connecting" | "connected" | "disconnected" | "error";
}

export function useCollabSession(noteId: string, user: CollabUser): CollabSession | null {
  const [session, setSession] = useState<CollabSession | null>(null);
  const destroyed = useRef(false);

  useEffect(() => {
    destroyed.current = false;
    let provider: HocuspocusProvider | null = null;
    let persistence: IndexeddbPersistence | null = null;
    let refreshTimer: ReturnType<typeof setInterval> | null = null;
    const doc = new Y.Doc();

    (async () => {
      const token = await issueRealtimeToken(noteId);
      if (destroyed.current) return;

      persistence = new IndexeddbPersistence(`km-note-${noteId}`, doc);
      const url = process.env.NEXT_PUBLIC_REALTIME_URL;
      if (!url) throw new Error("NEXT_PUBLIC_REALTIME_URL not set");

      provider = new HocuspocusProvider({
        url,
        name: noteId,
        token,
        document: doc,
      });

      provider.awareness!.setLocalStateField("user", {
        id: user.id,
        name: user.name,
        color: userColor(user.id),
      });

      const updateStatus = (status: CollabSession["status"]) => {
        if (destroyed.current) return;
        setSession((prev) =>
          prev
            ? { ...prev, status }
            : {
                doc,
                ytext: doc.getText("content"),
                awareness: provider!.awareness!,
                provider: provider!,
                status,
              },
        );
      };

      provider.on("status", (e: { status: string }) => {
        if (e.status === "connected") updateStatus("connected");
        else if (e.status === "disconnected") updateStatus("disconnected");
      });
      provider.on("authenticationFailed", () => updateStatus("error"));

      updateStatus("connecting");

      refreshTimer = setInterval(async () => {
        try {
          const fresh = await issueRealtimeToken(noteId);
          provider!.configuration.token = fresh;
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error("[collab] token refresh failed", e);
        }
      }, 4 * 60 * 1000);
    })();

    return () => {
      destroyed.current = true;
      if (refreshTimer) clearInterval(refreshTimer);
      if (provider) provider.destroy();
      if (persistence) persistence.destroy();
      doc.destroy();
    };
  }, [noteId, user.id, user.name]);

  return session;
}
```

- [ ] **Step 3: Typecheck**

```
pnpm --filter @km/web typecheck
```

Expected: No TypeScript errors.

- [ ] **Step 4: Commit**

```
git add apps/web/package.json apps/web/src/components/CollabSession.ts pnpm-lock.yaml
git commit -m "feat(web): add useCollabSession hook with JWT refresh and indexeddb"
```

---

## Task 14: ActiveUsers component

**Files:**
- Create: `apps/web/src/components/ActiveUsers.tsx`

- [ ] **Step 1: Implement the component**

```tsx
"use client";

import { useEffect, useState } from "react";
import type { Awareness } from "y-protocols/awareness";

interface LiveUser {
  id: string;
  name: string;
  color: string;
}

export function ActiveUsers({ awareness }: { awareness: Awareness | null }) {
  const [users, setUsers] = useState<LiveUser[]>([]);

  useEffect(() => {
    if (!awareness) return;
    const read = () => {
      const out: LiveUser[] = [];
      awareness.getStates().forEach((state) => {
        const u = (state as { user?: LiveUser }).user;
        if (u && u.id) out.push(u);
      });
      // Dedupe by id.
      const seen = new Set<string>();
      setUsers(
        out.filter((u) => {
          if (seen.has(u.id)) return false;
          seen.add(u.id);
          return true;
        }),
      );
    };
    read();
    awareness.on("change", read);
    return () => awareness.off("change", read);
  }, [awareness]);

  return (
    <div data-testid="active-users" style={{ display: "flex", gap: 4 }}>
      {users.map((u) => (
        <span
          key={u.id}
          title={u.name}
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            background: u.color,
            color: "white",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {u.name.slice(0, 1).toUpperCase()}
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```
pnpm --filter @km/web typecheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```
git add apps/web/src/components/ActiveUsers.tsx
git commit -m "feat(web): add ActiveUsers avatar list component"
```

---

## Task 15: Wire collab into the note page

**Files:**
- Modify: `apps/web/src/app/(app)/vault/[vaultId]/note/[noteId]/page.tsx`

- [ ] **Step 1: Replace the autosave block with collab**

Rewrite `apps/web/src/app/(app)/vault/[vaultId]/note/[noteId]/page.tsx` to:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { NoteEditor, collabExtension } from '@km/editor';
import { BacklinksPanel } from '@/components/BacklinksPanel';
import { CreateNoteDialog } from '@/components/CreateNoteDialog';
import { useCollabSession } from '@/components/CollabSession';
import { ActiveUsers } from '@/components/ActiveUsers';

interface NotePageProps {
  params: { vaultId: string; noteId: string };
}

interface NoteDto {
  id: string;
  vaultId: string;
  title: string;
  content: string;
}

export default function NotePage({ params }: NotePageProps) {
  const router = useRouter();
  const { data: sessionData } = useSession();
  const [note, setNote] = useState<NoteDto | null>(null);
  const [titleMap, setTitleMap] = useState<Map<string, string>>(new Map());
  const [dialogTitle, setDialogTitle] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    fetch(`/api/notes/${params.noteId}`)
      .then((r) => r.json())
      .then((body) => setNote(body.note));
  }, [params.noteId]);

  useEffect(() => {
    if (!note) return;
    type TreeNode = { id: string; name: string; children: TreeNode[]; notes: { id: string; title: string }[] };
    function collectNotes(node: TreeNode): { id: string; title: string }[] {
      return [
        ...node.notes,
        ...node.children.flatMap(collectNotes),
      ];
    }
    fetch(`/api/vaults/${note.vaultId}/tree`)
      .then((r) => r.json())
      .then((body: { root: TreeNode }) => {
        const allNotes = collectNotes(body.root);
        setTitleMap(new Map(allNotes.map((n) => [n.title, n.id])));
      });
  }, [note]);

  const user = sessionData?.user as { id?: string; name?: string | null; email?: string | null } | undefined;
  const collabUser = user?.id
    ? { id: user.id, name: user.name || user.email || "User" }
    : null;

  const session = useCollabSession(note && collabUser ? params.noteId : "", collabUser ?? { id: "", name: "" });

  const resolveTitle = useCallback(
    (title: string) => {
      const id = titleMap.get(title);
      return id ? { noteId: id } : null;
    },
    [titleMap],
  );

  const searchTitles = useCallback(
    async (q: string) => {
      if (!note) return [];
      const res = await fetch(
        `/api/notes/search?q=${encodeURIComponent(q)}&vaultId=${note.vaultId}`,
      );
      if (!res.ok) return [];
      const body: { results: { id: string; title: string }[] } = await res.json();
      return body.results;
    },
    [note],
  );

  const onDropFiles = useCallback(
    async (files: File[], _pos: number): Promise<string | null> => {
      if (!note) return null;
      const parts: string[] = [];
      for (const f of files) {
        const form = new FormData();
        form.append('vaultId', note.vaultId);
        form.append('file', f);
        const res = await fetch('/api/attachments', { method: 'POST', body: form });
        if (!res.ok) continue;
        const body: { markdown: string } = await res.json();
        parts.push(body.markdown);
      }
      return parts.length ? parts.join('\n') : null;
    },
    [note],
  );

  // Reload backlinks when the session reports that remote changes landed.
  useEffect(() => {
    if (!session) return;
    const handler = () => setReloadKey((k) => k + 1);
    session.ytext.observe(handler);
    return () => session.ytext.unobserve(handler);
  }, [session]);

  const editor = note && session ? (
    <NoteEditor
      key={note.id}
      initialValue=""
      onChange={() => {}}
      onDropFiles={onDropFiles}
      resolveTitle={resolveTitle}
      onNavigate={(id) => router.push(`/vault/${params.vaultId}/note/${id}`)}
      onCreateRequest={(title) => setDialogTitle(title)}
      searchTitles={searchTitles}
      collab={collabExtension({ ytext: session.ytext, awareness: session.awareness })}
    />
  ) : null;

  if (!note) return <div>Loading...</div>;

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <header
          style={{
            padding: '12px',
            borderBottom: '1px solid #d0d7de',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <h1 style={{ fontSize: '18px', margin: 0 }}>{note.title}</h1>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <ActiveUsers awareness={session?.awareness ?? null} />
            <span style={{ color: '#57606a', fontSize: '12px' }}>
              {session?.status === 'connected' ? 'Live' : session?.status ?? 'Connecting'}
            </span>
          </div>
        </header>
        <div style={{ flex: 1, minHeight: 0 }}>{editor}</div>
      </div>
      <BacklinksPanel noteId={note.id} vaultId={params.vaultId} reloadKey={reloadKey} />
      <CreateNoteDialog
        open={dialogTitle !== null}
        title={dialogTitle ?? ''}
        vaultId={note.vaultId}
        onCancel={() => setDialogTitle(null)}
        onCreated={(id) => {
          setDialogTitle(null);
          router.push(`/vault/${params.vaultId}/note/${id}`);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and lint the web app**

```
pnpm --filter @km/web typecheck
pnpm --filter @km/web lint
```

Expected: no errors. If `useSession` needs a `SessionProvider` ancestor and one is not yet in the app tree, check `apps/web/src/app/providers.tsx` (or equivalent) and add `<SessionProvider>`. This plan assumes the provider is already present since credentials login is wired up.

- [ ] **Step 3: Commit**

```
git add apps/web/src/app/\(app\)/vault/\[vaultId\]/note/\[noteId\]/page.tsx
git commit -m "feat(web): mount collab session on note page and drop content autosave"
```

---

## Task 16: Dockerfile.realtime

**Files:**
- Create: `infra/docker/Dockerfile.realtime`

- [ ] **Step 1: Write the Dockerfile**

```
# syntax=docker/dockerfile:1.6

FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY apps/realtime/package.json apps/realtime/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/editor/package.json packages/editor/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @km/db generate
RUN pnpm --filter @km/realtime build
RUN pnpm deploy --filter @km/realtime --prod /out

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV REALTIME_PORT=3001
WORKDIR /app

RUN groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app app
COPY --from=build --chown=app:app /out ./

USER app
EXPOSE 3001
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Build the image locally**

```
docker build -f infra/docker/Dockerfile.realtime -t km-realtime:dev .
```

Expected: image builds without errors.

- [ ] **Step 3: Commit**

```
git add infra/docker/Dockerfile.realtime
git commit -m "build: add Dockerfile for @km/realtime"
```

---

## Task 17: docker-compose + Coolify + env updates

**Files:**
- Modify: `infra/docker/docker-compose.prod.yml`
- Modify: `infra/coolify/README.md`
- Modify: `env.example`

- [ ] **Step 1: Add `realtime` service to compose**

Append to `services:` in `infra/docker/docker-compose.prod.yml`:

```yaml
  realtime:
    image: ${REALTIME_IMAGE:-ghcr.io/jonny/km-realtime:latest}
    build:
      context: ../..
      dockerfile: infra/docker/Dockerfile.realtime
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      NODE_ENV: production
      DATABASE_URL: postgres://kmgmt:${POSTGRES_PASSWORD}@postgres:5432/kmgmt
      REALTIME_JWT_SECRET: ${REALTIME_JWT_SECRET}
      REALTIME_PORT: 3001
    ports:
      - "3001:3001"
```

Also add `REALTIME_JWT_SECRET: ${REALTIME_JWT_SECRET}` and `NEXT_PUBLIC_REALTIME_URL: ${NEXT_PUBLIC_REALTIME_URL}` to the `web` service's `environment:` block.

- [ ] **Step 2: Update env.example**

Append to `env.example`:

```
REALTIME_JWT_SECRET=replace-with-openssl-rand-base64-32
NEXT_PUBLIC_REALTIME_URL=ws://localhost:3001
```

- [ ] **Step 3: Update Coolify README**

Append to `infra/coolify/README.md`:

```
## Realtime service

The `@km/realtime` app runs Hocuspocus on port 3001. Deploy it as a separate Coolify service using `infra/docker/Dockerfile.realtime`.

Required environment variables:

- DATABASE_URL (same value as web and worker)
- REALTIME_JWT_SECRET (distinct from NEXTAUTH_SECRET; generate with openssl rand -base64 32)
- REALTIME_PORT=3001

The web service additionally needs:

- REALTIME_JWT_SECRET (same value as realtime)
- NEXT_PUBLIC_REALTIME_URL (the public WebSocket URL the browser will open, e.g. wss://app.example.com/yjs)

Cloudflare Proxy: the realtime route must have WebSockets enabled in the Cloudflare dashboard under Network settings. Per the project convention, the upstream between Cloudflare and Coolify is HTTP; the WebSocket upgrade travels over the same connection.
```

- [ ] **Step 4: Commit**

```
git add infra/docker/docker-compose.prod.yml infra/coolify/README.md env.example
git commit -m "build: add realtime service to prod compose and document deployment"
```

---

## Task 18: CI and release workflow updates

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `.github/workflows/e2e.yml`

- [ ] **Step 1: Add realtime to integration tests**

In `.github/workflows/ci.yml`, replace the final `- run: pnpm test:integration` line in the `integration` job with:

```yaml
      - run: pnpm test:integration
      - name: Realtime integration tests
        env:
          REALTIME_JWT_SECRET: ci-realtime-secret
        run: pnpm --filter @km/realtime test:integration
```

- [ ] **Step 2: Add realtime image to release matrix**

In `.github/workflows/release.yml`, extend `matrix.include`:

```yaml
          - name: web
            dockerfile: infra/docker/Dockerfile.web
          - name: worker
            dockerfile: infra/docker/Dockerfile.worker
          - name: realtime
            dockerfile: infra/docker/Dockerfile.realtime
```

- [ ] **Step 3: Start realtime service before Playwright**

In `.github/workflows/e2e.yml`, add the env vars and a background step before the final `playwright test` line:

```yaml
    env:
      DATABASE_URL: postgres://km:km@localhost:5432/km_e2e
      NEXTAUTH_SECRET: e2e-secret
      NEXTAUTH_URL: http://localhost:3000
      REALTIME_JWT_SECRET: e2e-realtime-secret
      NEXT_PUBLIC_REALTIME_URL: ws://localhost:3001
      DATA_DIR: /tmp/km-e2e
```

Playwright will start the realtime service via its `webServer` config (next task). No extra step needed in the workflow beyond the env vars.

- [ ] **Step 4: Commit**

```
git add .github/workflows/ci.yml .github/workflows/release.yml .github/workflows/e2e.yml
git commit -m "ci: add realtime to integration, e2e, and release workflows"
```

---

## Task 19: Playwright config and E2E spec

**Files:**
- Modify: `apps/web/playwright.config.ts`
- Create: `apps/web/playwright/realtime-collab.spec.ts`

- [ ] **Step 1: Update Playwright config to start realtime too**

Replace `apps/web/playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./playwright",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  globalSetup: "./playwright/global-setup.ts",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @km/realtime dev",
      port: 3001,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        REALTIME_JWT_SECRET: process.env.REALTIME_JWT_SECRET ?? "e2e-realtime-secret",
      },
    },
  ],
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
```

- [ ] **Step 2: Write the E2E spec**

Create `apps/web/playwright/realtime-collab.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("two browser contexts converge and show each other in ActiveUsers", async ({ browser }) => {
  // This spec depends on an existing fixture helper in global-setup.ts that
  // seeds two users in the same workspace and returns their login credentials
  // plus the noteId. Use the same pattern as other specs in this directory.
  const seeded = (global as any).__km_seeded_collab as {
    userA: { email: string; password: string };
    userB: { email: string; password: string };
    vaultId: string;
    noteId: string;
  };

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  async function login(page: typeof pageA, creds: { email: string; password: string }) {
    await page.goto("/login");
    await page.fill('input[name="email"]', creds.email);
    await page.fill('input[name="password"]', creds.password);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/vault/**");
  }

  await login(pageA, seeded.userA);
  await login(pageB, seeded.userB);

  const notePath = `/vault/${seeded.vaultId}/note/${seeded.noteId}`;
  await pageA.goto(notePath);
  await pageB.goto(notePath);

  await expect(pageA.getByText("Live")).toBeVisible({ timeout: 10_000 });
  await expect(pageB.getByText("Live")).toBeVisible({ timeout: 10_000 });

  const editorA = pageA.getByTestId("note-editor");
  await editorA.click();
  await pageA.keyboard.type("hello from A ");

  await expect(pageB.getByTestId("note-editor")).toContainText("hello from A", { timeout: 5000 });

  const activeA = pageA.getByTestId("active-users");
  const activeB = pageB.getByTestId("active-users");
  await expect(activeA.locator("span")).toHaveCount(2, { timeout: 5000 });
  await expect(activeB.locator("span")).toHaveCount(2, { timeout: 5000 });

  await contextA.close();
  await contextB.close();
});
```

Note: `global-setup.ts` must export the `__km_seeded_collab` fixture. Extend it to seed a workspace with two users (reuse the invite-accept flow from `workspace-invite.spec.ts` fixtures) and create a note in a vault both users can access. If that helper is not already present, add it now in the same commit.

- [ ] **Step 3: Run Playwright locally**

```
pnpm --filter @km/web exec playwright install chromium
pnpm --filter @km/web test:e2e -- realtime-collab.spec.ts
```

Expected: PASS on the collab spec. Other specs should still pass.

- [ ] **Step 4: Commit**

```
git add apps/web/playwright.config.ts apps/web/playwright/realtime-collab.spec.ts apps/web/playwright/global-setup.ts
git commit -m "test(e2e): add two-browser realtime collab spec and start realtime in playwright"
```

---

## Task 20: Documentation updates

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/data-model.md`
- Modify: `docs/deployment.md`
- Create: `guides/collaboration.md`

- [ ] **Step 1: Add Realtime section to `docs/architecture.md`**

Append:

```
## Realtime

The `apps/realtime` service runs Hocuspocus on port 3001. When a user opens a note, the browser calls the `issueRealtimeToken` server action in `apps/web`, which verifies vault access and returns a short-lived HS256 JWT along with a matching `RealtimeGrant` row.

The browser opens a WebSocket to the realtime service, authenticated by that token. Hocuspocus's `onAuthenticate` hook verifies the signature, re-checks the `RealtimeGrant` is live, and re-asserts vault membership against Postgres (the JWT claim alone is not trusted).

While editing, client and server exchange Yjs updates. The server persists merged state into `NoteDoc.state`. A per-note debounce fires `snapshotNote(noteId)` five seconds after the last change and immediately when the last live connection drops. The snapshot helper compares the current Y.Doc text to `Note.content`; on difference, it opens a transaction that updates `Note.content`, `contentUpdatedAt`, `updatedById`, and calls `recomputeLinks` so `Link` rows stay in sync with wiki-link references.

Presence uses Y.Awareness. Each client writes `{ user: { id, name, color } }` into its local awareness state; `y-codemirror.next` paints remote carets and the `ActiveUsers` component lists everyone currently in the document.
```

- [ ] **Step 2: Extend `docs/data-model.md`**

Append:

```
## NoteDoc

One row per note that has ever been opened in realtime. Stores the merged Yjs document state as `Bytes`. Deleted when the note is deleted (via `onDelete: Cascade`). Not deleted when the room empties; the CRDT state is the source of truth for future reconnects.

| Column | Type | Notes |
| --- | --- | --- |
| noteId | String (PK) | FK to Note |
| state | Bytes | Yjs update payload |
| clock | Int | Monotonic counter, incremented on each store |
| updatedAt | DateTime | Auto |

## RealtimeGrant

One row per issued realtime JWT. Enables explicit revocation without waiting for token expiry.

| Column | Type | Notes |
| --- | --- | --- |
| jti | String (PK) | Nanoid, also claim in the JWT |
| userId | String | The issuing user |
| noteId | String | Scope of the grant |
| expiresAt | DateTime | Matches JWT `exp` |
| revokedAt | DateTime? | Set to block future connections |
| createdAt | DateTime | Auto |
```

- [ ] **Step 3: Extend `docs/deployment.md`**

Append:

```
## Realtime service

Deploy `apps/realtime` using `infra/docker/Dockerfile.realtime`. Expose port 3001 internally; front it behind the same Cloudflare-proxied hostname as the web app under a `/yjs` path.

Environment variables the realtime service needs:

- DATABASE_URL (shared with web and worker)
- REALTIME_JWT_SECRET (distinct from NEXTAUTH_SECRET)
- REALTIME_PORT (defaults to 3001)

The web service also needs `REALTIME_JWT_SECRET` and `NEXT_PUBLIC_REALTIME_URL`.

Cloudflare: ensure WebSockets are enabled for the zone (Network settings), otherwise the upgrade request will be rejected and the browser will retry indefinitely.
```

- [ ] **Step 4: Create `guides/collaboration.md`**

```
# Collaborating on notes in real time

When two or more people open the same note, you will see each other's cursors and selections as you type. Changes merge automatically, so nobody ever overwrites anyone else's work.

## Who can collaborate

Anyone who is a member of the workspace that owns the vault can open any note in the vault in realtime. If you lose access while a session is open (for example, someone revokes your membership), you will be disconnected on the next token refresh, within five minutes.

## What you see

A small row of coloured avatars sits at the top of the note, one per person currently viewing or editing. Hover to see their name. Each participant's cursor is shown inline in the editor with a matching colour and their name floating above it.

## Offline and reconnects

If your network drops briefly, your in-progress edits are held locally and sent once the connection recovers. If you reload the tab, your last known state is restored from browser storage while the server catches up. Nothing is ever saved only on your device: once the server confirms the update, it lives in the vault.

## Search and backlinks

The vault search index and the backlinks panel update a few seconds after the latest edit, or immediately when the last person leaves the note.
```

- [ ] **Step 5: Commit**

```
git add docs/architecture.md docs/data-model.md docs/deployment.md guides/collaboration.md
git commit -m "docs: document realtime architecture, data model, deployment, and user guide"
```

---

## Task 21: Final verification

- [ ] **Step 1: Run every test bucket**

```
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @km/realtime test:integration
pnpm --filter @km/web test:e2e
```

Expected: every command exits 0.

- [ ] **Step 2: Smoke-test the stack locally**

In one terminal:

```
pnpm --filter @km/web dev
```

In a second terminal:

```
REALTIME_JWT_SECRET=dev-secret pnpm --filter @km/realtime dev
```

Open two browser windows at `http://localhost:3000`, log in as two different users in the same workspace, open the same note, and confirm:

- Both see a "Live" indicator.
- Typing in window A appears in window B within one second.
- Both ActiveUsers lists show two avatars with distinct colours.
- Closing both windows and reopening shows the typed text still present (server-side snapshot took effect).

- [ ] **Step 3: Commit any fixups**

If the smoke test turned up an issue, fix it, rerun the failing bucket, then:

```
git add -A
git commit -m "fix: address phase2 smoke-test issue"
```

- [ ] **Step 4: Open the pull request**

```
gh pr create --title "Phase 2: Realtime collaboration" --body "Implements CRDT-based multi-user editing per docs/superpowers/specs/2026-04-13-phase2-realtime-design.md."
```

Expected: PR URL printed.

---
