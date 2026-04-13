# Plan B: Vaults, Folders, Notes, Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver vault/folder/note CRUD, workspace creation and invites, and a basic file-tree UI with textarea-based autosave on top of the Plan A foundation.

**Architecture:** All vault-touching API routes and server actions call a single `assertCanAccessVault(userId, vaultId, requiredRole)` helper that resolves personal-vault ownership or workspace membership and throws on denial. Workspace flows use server actions for form mutations, route handlers for editor/sidebar traffic. `Folder.path` is kept in sync in the same transaction as rename or move operations. Note search uses Postgres `ILIKE` prefix match for v1. The editor is a plain textarea with debounced autosave via `PATCH /api/notes/:id`.

**Tech Stack:** Next.js App Router, TypeScript, Prisma, PostgreSQL, NextAuth (session), Vitest (integration + unit, real Postgres), Playwright (E2E), Tailwind + shadcn/ui components, Zod for input validation.

---

## File Structure

**New files:**

- `apps/web/lib/authz.ts` — `assertCanAccessVault` helper and `AuthzError` class
- `apps/web/lib/authz.test.ts` — unit tests for the helper
- `apps/web/lib/session.ts` — `getCurrentUserId` helper wrapping NextAuth server session
- `packages/shared/src/roles.ts` — `Role` type and role-rank helpers
- `packages/shared/src/schemas.ts` — Zod schemas for note/folder/workspace/invite inputs
- `packages/shared/src/slug.ts` — `slugify` helper for notes and workspaces
- `apps/web/lib/invite-token.ts` — generates and hashes one-time invite tokens
- `apps/web/lib/email.ts` — `sendInviteEmail` stub that logs to console
- `apps/web/lib/folder-path.ts` — recomputes descendant `Folder.path` values on rename/move
- `apps/web/app/api/vaults/route.ts` — `GET /api/vaults`
- `apps/web/app/api/vaults/[id]/tree/route.ts` — `GET /api/vaults/:id/tree`
- `apps/web/app/api/workspaces/route.ts` — `POST /api/workspaces`
- `apps/web/app/api/workspaces/[id]/invites/route.ts` — `POST /api/workspaces/:id/invites`
- `apps/web/app/api/invites/[token]/accept/route.ts` — `POST /api/invites/:token/accept`
- `apps/web/app/api/folders/route.ts` — `POST /api/folders`
- `apps/web/app/api/folders/[id]/route.ts` — `PATCH` / `DELETE /api/folders/:id`
- `apps/web/app/api/notes/route.ts` — `POST /api/notes`
- `apps/web/app/api/notes/[id]/route.ts` — `GET` / `PATCH` / `DELETE /api/notes/:id`
- `apps/web/app/api/notes/search/route.ts` — `GET /api/notes/search`
- `apps/web/app/api/notes/[id]/backlinks/route.ts` — `GET /api/notes/:id/backlinks`
- `apps/web/app/(app)/workspaces/page.tsx` — workspaces list
- `apps/web/app/(app)/workspaces/new/page.tsx` — create workspace form
- `apps/web/app/(app)/workspaces/[id]/members/page.tsx` — members + invite form
- `apps/web/app/(app)/invites/[token]/page.tsx` — accept-invite landing page
- `apps/web/app/(app)/vault/[vaultId]/page.tsx` — vault shell (sidebar + editor)
- `apps/web/app/(app)/vault/[vaultId]/note/[noteId]/page.tsx` — note editor route
- `apps/web/components/VaultSwitcher.tsx`
- `apps/web/components/FileTree.tsx`
- `apps/web/components/FileTreeItem.tsx`
- `apps/web/components/NoteEditor.tsx`
- `apps/web/components/ContextMenu.tsx`
- `apps/web/app/actions/workspaces.ts` — `createWorkspace` server action
- `apps/web/app/actions/invites.ts` — `acceptInvite` server action
- `apps/web/tests/integration/authz.test.ts`
- `apps/web/tests/integration/vaults.test.ts`
- `apps/web/tests/integration/workspaces.test.ts`
- `apps/web/tests/integration/invites.test.ts`
- `apps/web/tests/integration/folders.test.ts`
- `apps/web/tests/integration/notes.test.ts`
- `apps/web/tests/integration/notes-search.test.ts`
- `apps/web/tests/integration/backlinks.test.ts`
- `apps/web/tests/integration/tree.test.ts`
- `apps/web/tests/helpers/db.ts` — per-test DB reset + factory helpers
- `apps/web/tests/helpers/http.ts` — invoke Next route handlers with a mocked session
- `apps/web/e2e/workspace-invite.spec.ts`

**Modified files:**

- `packages/shared/src/index.ts` — re-export new modules
- `apps/web/package.json` — add `zod`, `nanoid`
- `apps/web/app/layout.tsx` — add link to `/workspaces`

---

## Task 1: Role helpers in packages/shared

**Files:**
- Create: `packages/shared/src/roles.ts`
- Create: `packages/shared/src/roles.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write failing test**

Create `packages/shared/src/roles.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { roleAtLeast, ROLE_RANK } from "./roles";

describe("roleAtLeast", () => {
  it("OWNER satisfies every requirement", () => {
    expect(roleAtLeast("OWNER", "OWNER")).toBe(true);
    expect(roleAtLeast("OWNER", "ADMIN")).toBe(true);
    expect(roleAtLeast("OWNER", "MEMBER")).toBe(true);
  });

  it("ADMIN satisfies ADMIN and MEMBER but not OWNER", () => {
    expect(roleAtLeast("ADMIN", "OWNER")).toBe(false);
    expect(roleAtLeast("ADMIN", "ADMIN")).toBe(true);
    expect(roleAtLeast("ADMIN", "MEMBER")).toBe(true);
  });

  it("MEMBER only satisfies MEMBER", () => {
    expect(roleAtLeast("MEMBER", "OWNER")).toBe(false);
    expect(roleAtLeast("MEMBER", "ADMIN")).toBe(false);
    expect(roleAtLeast("MEMBER", "MEMBER")).toBe(true);
  });

  it("ROLE_RANK orders OWNER > ADMIN > MEMBER", () => {
    expect(ROLE_RANK.OWNER).toBeGreaterThan(ROLE_RANK.ADMIN);
    expect(ROLE_RANK.ADMIN).toBeGreaterThan(ROLE_RANK.MEMBER);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @km/shared test roles`
Expected: FAIL with module not found `./roles`.

- [ ] **Step 3: Implement roles helper**

Create `packages/shared/src/roles.ts`:

```ts
export type Role = "OWNER" | "ADMIN" | "MEMBER";

export const ROLE_RANK: Record<Role, number> = {
  OWNER: 3,
  ADMIN: 2,
  MEMBER: 1,
};

export function roleAtLeast(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}
```

- [ ] **Step 4: Re-export from shared index**

Edit `packages/shared/src/index.ts`, append:

```ts
export * from "./roles";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @km/shared test roles`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/roles.ts packages/shared/src/roles.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add Role type and roleAtLeast helper"
```

---

## Task 2: Slug helper

**Files:**
- Create: `packages/shared/src/slug.ts`
- Create: `packages/shared/src/slug.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write failing test**

Create `packages/shared/src/slug.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("My First Note")).toBe("my-first-note");
  });
  it("strips punctuation", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
  });
  it("collapses whitespace and trims dashes", () => {
    expect(slugify("  spaced   out  ")).toBe("spaced-out");
  });
  it("falls back to 'untitled' for empty result", () => {
    expect(slugify("!!!")).toBe("untitled");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @km/shared test slug`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement slug**

Create `packages/shared/src/slug.ts`:

```ts
export function slugify(input: string): string {
  const cleaned = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : "untitled";
}
```

- [ ] **Step 4: Re-export**

Edit `packages/shared/src/index.ts`, append:

```ts
export * from "./slug";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @km/shared test slug`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/slug.ts packages/shared/src/slug.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add slugify helper"
```

---

## Task 3: Zod input schemas

**Files:**
- Create: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/package.json`

- [ ] **Step 1: Add zod dependency to shared**

Run: `pnpm --filter @km/shared add zod@^3.23.0`
Expected: `zod` appears in `packages/shared/package.json` `dependencies`.

- [ ] **Step 2: Implement schemas**

Create `packages/shared/src/schemas.ts`:

```ts
import { z } from "zod";

export const createWorkspaceInput = z.object({
  name: z.string().min(1).max(80),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInput>;

export const createInviteInput = z.object({
  email: z.string().email(),
  role: z.enum(["ADMIN", "MEMBER"]),
});
export type CreateInviteInput = z.infer<typeof createInviteInput>;

export const createFolderInput = z.object({
  vaultId: z.string().cuid(),
  parentId: z.string().cuid().nullable().optional(),
  name: z.string().min(1).max(120),
});
export type CreateFolderInput = z.infer<typeof createFolderInput>;

export const updateFolderInput = z.object({
  name: z.string().min(1).max(120).optional(),
  parentId: z.string().cuid().nullable().optional(),
});
export type UpdateFolderInput = z.infer<typeof updateFolderInput>;

export const createNoteInput = z.object({
  vaultId: z.string().cuid(),
  folderId: z.string().cuid().nullable().optional(),
  title: z.string().min(1).max(200),
  content: z.string().default(""),
});
export type CreateNoteInput = z.infer<typeof createNoteInput>;

export const updateNoteInput = z.object({
  title: z.string().min(1).max(200).optional(),
  folderId: z.string().cuid().nullable().optional(),
  content: z.string().optional(),
});
export type UpdateNoteInput = z.infer<typeof updateNoteInput>;

export const searchNotesQuery = z.object({
  vaultId: z.string().cuid(),
  q: z.string().min(1).max(200),
});
export type SearchNotesQuery = z.infer<typeof searchNotesQuery>;
```

- [ ] **Step 3: Re-export**

Edit `packages/shared/src/index.ts`, append:

```ts
export * from "./schemas";
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @km/shared typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas.ts packages/shared/src/index.ts packages/shared/package.json pnpm-lock.yaml
git commit -m "feat(shared): add zod input schemas for workspaces, folders, notes"
```

---

## Task 4: Test DB helpers

**Files:**
- Create: `apps/web/tests/helpers/db.ts`
- Create: `apps/web/tests/helpers/http.ts`
- Modify: `apps/web/vitest.config.ts`

- [ ] **Step 1: Implement db helper**

Create `apps/web/tests/helpers/db.ts`:

```ts
import { prisma } from "@km/db";
import { randomUUID } from "node:crypto";

export async function resetDb() {
  await prisma.$transaction([
    prisma.link.deleteMany(),
    prisma.attachment.deleteMany(),
    prisma.note.deleteMany(),
    prisma.folder.deleteMany(),
    prisma.vault.deleteMany(),
    prisma.invite.deleteMany(),
    prisma.membership.deleteMany(),
    prisma.workspace.deleteMany(),
    prisma.session.deleteMany(),
    prisma.account.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

export async function createUser(overrides: { email?: string; name?: string } = {}) {
  const email = overrides.email ?? `user-${randomUUID()}@test.local`;
  const user = await prisma.user.create({
    data: { email, name: overrides.name ?? "Test User" },
  });
  const vault = await prisma.vault.create({
    data: { ownerType: "USER", ownerId: user.id, name: "Personal" },
  });
  const root = await prisma.folder.create({
    data: { vaultId: vault.id, parentId: null, name: "", path: "" },
  });
  return { user, vault, rootFolder: root };
}

export async function createWorkspaceFixture(ownerId: string, name = "Acme") {
  const ws = await prisma.workspace.create({
    data: { name, slug: name.toLowerCase(), ownerId },
  });
  await prisma.membership.create({
    data: { workspaceId: ws.id, userId: ownerId, role: "OWNER" },
  });
  const vault = await prisma.vault.create({
    data: { ownerType: "WORKSPACE", ownerId: ws.id, name },
  });
  const root = await prisma.folder.create({
    data: { vaultId: vault.id, parentId: null, name: "", path: "" },
  });
  return { workspace: ws, vault, rootFolder: root };
}
```

- [ ] **Step 2: Implement http helper**

Create `apps/web/tests/helpers/http.ts`:

```ts
import { vi } from "vitest";

export function mockSession(userId: string | null) {
  vi.doMock("next-auth", async () => {
    const actual = await vi.importActual<any>("next-auth");
    return {
      ...actual,
      getServerSession: async () =>
        userId ? { user: { id: userId } } : null,
    };
  });
}

export async function callHandler<T extends (req: Request, ctx: any) => Promise<Response>>(
  handler: T,
  init: { method: string; url: string; body?: unknown; params?: Record<string, string> }
) {
  const req = new Request(init.url, {
    method: init.method,
    headers: { "content-type": "application/json" },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const res = await handler(req, { params: init.params ?? {} });
  const text = await res.text();
  const json = text.length > 0 ? JSON.parse(text) : null;
  return { status: res.status, body: json };
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @km/web typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/tests/helpers/db.ts apps/web/tests/helpers/http.ts
git commit -m "test(web): add per-test DB reset and handler-invocation helpers"
```

---

## Task 5: Session helper

**Files:**
- Create: `apps/web/lib/session.ts`

- [ ] **Step 1: Implement**

Create `apps/web/lib/session.ts`:

```ts
import { getServerSession } from "next-auth";
import { authOptions } from "./auth";

export async function getCurrentUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.id ?? null;
}

export async function requireUserId(): Promise<string> {
  const id = await getCurrentUserId();
  if (!id) {
    throw new Response("Unauthorized", { status: 401 });
  }
  return id;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @km/web typecheck`
Expected: no errors. If `authOptions` is not exported from `./auth`, export it from whatever Plan A called the NextAuth config file and adjust the import.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/session.ts
git commit -m "feat(web): add getCurrentUserId/requireUserId session helpers"
```

---

## Task 6: assertCanAccessVault — unit tests

**Files:**
- Create: `apps/web/lib/authz.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/web/lib/authz.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, createUser, createWorkspaceFixture } from "../tests/helpers/db";
import { assertCanAccessVault, AuthzError } from "./authz";
import { prisma } from "@km/db";

describe("assertCanAccessVault", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("allows the owner of a personal vault", async () => {
    const { user, vault } = await createUser();
    const result = await assertCanAccessVault(user.id, vault.id, "MEMBER");
    expect(result.vault.id).toBe(vault.id);
    expect(result.role).toBe("OWNER");
  });

  it("rejects a non-owner on a personal vault", async () => {
    const { vault } = await createUser();
    const { user: other } = await createUser();
    await expect(
      assertCanAccessVault(other.id, vault.id, "MEMBER")
    ).rejects.toBeInstanceOf(AuthzError);
  });

  it("allows a workspace MEMBER on their workspace vault", async () => {
    const { user: owner } = await createUser();
    const { workspace, vault } = await createWorkspaceFixture(owner.id);
    const { user: member } = await createUser();
    await prisma.membership.create({
      data: { workspaceId: workspace.id, userId: member.id, role: "MEMBER" },
    });
    const result = await assertCanAccessVault(member.id, vault.id, "MEMBER");
    expect(result.role).toBe("MEMBER");
  });

  it("rejects MEMBER when ADMIN is required", async () => {
    const { user: owner } = await createUser();
    const { workspace, vault } = await createWorkspaceFixture(owner.id);
    const { user: member } = await createUser();
    await prisma.membership.create({
      data: { workspaceId: workspace.id, userId: member.id, role: "MEMBER" },
    });
    await expect(
      assertCanAccessVault(member.id, vault.id, "ADMIN")
    ).rejects.toBeInstanceOf(AuthzError);
  });

  it("rejects a non-member on a workspace vault", async () => {
    const { user: owner } = await createUser();
    const { vault } = await createWorkspaceFixture(owner.id);
    const { user: stranger } = await createUser();
    await expect(
      assertCanAccessVault(stranger.id, vault.id, "MEMBER")
    ).rejects.toBeInstanceOf(AuthzError);
  });

  it("throws on missing vault", async () => {
    const { user } = await createUser();
    await expect(
      assertCanAccessVault(user.id, "clnonexistent00000000000", "MEMBER")
    ).rejects.toBeInstanceOf(AuthzError);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @km/web test authz`
Expected: FAIL with `Cannot find module './authz'`.

- [ ] **Step 3: Commit the failing test**

```bash
git add apps/web/lib/authz.test.ts
git commit -m "test(web): add failing tests for assertCanAccessVault"
```

---

## Task 7: assertCanAccessVault — implementation

**Files:**
- Create: `apps/web/lib/authz.ts`

- [ ] **Step 1: Implement helper**

Create `apps/web/lib/authz.ts`:

```ts
import { prisma } from "@km/db";
import { Role, roleAtLeast } from "@km/shared";

export class AuthzError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.name = "AuthzError";
    this.status = status;
  }
}

export interface VaultAccess {
  vault: { id: string; ownerType: "USER" | "WORKSPACE"; ownerId: string; name: string };
  role: Role;
}

export async function assertCanAccessVault(
  userId: string,
  vaultId: string,
  requiredRole: Role
): Promise<VaultAccess> {
  if (!userId) throw new AuthzError("Not authenticated", 401);

  const vault = await prisma.vault.findUnique({
    where: { id: vaultId },
    select: { id: true, ownerType: true, ownerId: true, name: true },
  });
  if (!vault) throw new AuthzError("Vault not found", 404);

  if (vault.ownerType === "USER") {
    if (vault.ownerId !== userId) {
      throw new AuthzError("Forbidden");
    }
    return { vault, role: "OWNER" };
  }

  const membership = await prisma.membership.findFirst({
    where: { workspaceId: vault.ownerId, userId },
    select: { role: true },
  });
  if (!membership) throw new AuthzError("Forbidden");
  if (!roleAtLeast(membership.role as Role, requiredRole)) {
    throw new AuthzError("Insufficient role");
  }
  return { vault, role: membership.role as Role };
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm --filter @km/web test authz`
Expected: PASS, 6 tests.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/authz.ts
git commit -m "feat(web): implement assertCanAccessVault authorization helper"
```

---

## Task 8: Invite token helper

**Files:**
- Create: `apps/web/lib/invite-token.ts`
- Modify: `apps/web/package.json`

- [ ] **Step 1: Add nanoid**

Run: `pnpm --filter @km/web add nanoid@^5.0.0`
Expected: `nanoid` in `apps/web/package.json`.

- [ ] **Step 2: Implement token helper**

Create `apps/web/lib/invite-token.ts`:

```ts
import { nanoid } from "nanoid";
import { createHash } from "node:crypto";

export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = nanoid(32);
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return { token, tokenHash };
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/invite-token.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): add invite-token generator"
```

---

## Task 9: Email stub

**Files:**
- Create: `apps/web/lib/email.ts`

- [ ] **Step 1: Implement**

Create `apps/web/lib/email.ts`:

```ts
export interface InviteEmailPayload {
  to: string;
  workspaceName: string;
  acceptUrl: string;
  inviterName: string | null;
}

export async function sendInviteEmail(p: InviteEmailPayload): Promise<void> {
  // v1: log to console. A later phase wires this to a real provider.
  console.log(
    `[invite] to=${p.to} workspace=${p.workspaceName} inviter=${p.inviterName ?? "unknown"} url=${p.acceptUrl}`
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/email.ts
git commit -m "feat(web): add console-logging invite email stub"
```

---

## Task 10: Folder-path recompute helper

**Files:**
- Create: `apps/web/lib/folder-path.ts`
- Create: `apps/web/lib/folder-path.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/web/lib/folder-path.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, createUser } from "../tests/helpers/db";
import { prisma } from "@km/db";
import { computeChildPath, recomputeDescendantPaths } from "./folder-path";

describe("folder-path", () => {
  beforeEach(async () => { await resetDb(); });

  it("computeChildPath joins parent path with child name", () => {
    expect(computeChildPath("", "Projects")).toBe("Projects");
    expect(computeChildPath("Projects", "Acme")).toBe("Projects/Acme");
  });

  it("recomputeDescendantPaths rewrites nested folder paths after rename", async () => {
    const { vault } = await createUser();
    const a = await prisma.folder.create({ data: { vaultId: vault.id, name: "A", path: "A" } });
    const b = await prisma.folder.create({ data: { vaultId: vault.id, parentId: a.id, name: "B", path: "A/B" } });
    const c = await prisma.folder.create({ data: { vaultId: vault.id, parentId: b.id, name: "C", path: "A/B/C" } });

    await prisma.folder.update({ where: { id: a.id }, data: { name: "AA", path: "AA" } });
    await recomputeDescendantPaths(prisma, a.id);

    const refreshed = await prisma.folder.findMany({ where: { vaultId: vault.id }, orderBy: { path: "asc" } });
    const paths = refreshed.map((f) => f.path).filter((p) => p !== "");
    expect(paths).toEqual(["AA", "AA/B", "AA/B/C"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @km/web test folder-path`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `apps/web/lib/folder-path.ts`:

```ts
import type { PrismaClient, Prisma } from "@prisma/client";

export function computeChildPath(parentPath: string, childName: string): string {
  return parentPath.length === 0 ? childName : `${parentPath}/${childName}`;
}

type Tx = PrismaClient | Prisma.TransactionClient;

export async function recomputeDescendantPaths(tx: Tx, folderId: string): Promise<void> {
  const root = await tx.folder.findUnique({
    where: { id: folderId },
    select: { id: true, path: true, vaultId: true },
  });
  if (!root) return;

  const queue: Array<{ id: string; path: string }> = [{ id: root.id, path: root.path }];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = await tx.folder.findMany({
      where: { parentId: current.id },
      select: { id: true, name: true },
    });
    for (const child of children) {
      const newPath = computeChildPath(current.path, child.name);
      await tx.folder.update({ where: { id: child.id }, data: { path: newPath } });
      queue.push({ id: child.id, path: newPath });
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @km/web test folder-path`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/folder-path.ts apps/web/lib/folder-path.test.ts
git commit -m "feat(web): add folder-path recompute helper"
```

---

## Task 11: GET /api/vaults (integration test first)

**Files:**
- Create: `apps/web/tests/integration/vaults.test.ts`
- Create: `apps/web/app/api/vaults/route.ts`

- [ ] **Step 1: Write failing test**

Create `apps/web/tests/integration/vaults.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, createUser, createWorkspaceFixture } from "../helpers/db";
import { prisma } from "@km/db";

vi.mock("../../lib/session", () => ({
  getCurrentUserId: vi.fn(),
  requireUserId: vi.fn(),
}));

import { getCurrentUserId, requireUserId } from "../../lib/session";
import { GET } from "../../app/api/vaults/route";

describe("GET /api/vaults", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(getCurrentUserId).mockReset();
    vi.mocked(requireUserId).mockReset();
  });

  it("returns personal vault plus workspace vaults the user belongs to", async () => {
    const { user, vault: personal } = await createUser();
    const { vault: wsVault, workspace } = await createWorkspaceFixture(user.id, "Team");
    const { user: other } = await createUser();
    await createWorkspaceFixture(other.id, "Other");

    vi.mocked(requireUserId).mockResolvedValue(user.id);
    const res = await GET(new Request("http://t/api/vaults"));
    const body = await res.json();

    expect(res.status).toBe(200);
    const ids = body.vaults.map((v: any) => v.id).sort();
    expect(ids).toEqual([personal.id, wsVault.id].sort());
    const team = body.vaults.find((v: any) => v.id === wsVault.id);
    expect(team.ownerType).toBe("WORKSPACE");
    expect(team.workspaceId).toBe(workspace.id);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireUserId).mockRejectedValue(new Response("Unauthorized", { status: 401 }));
    try {
      await GET(new Request("http://t/api/vaults"));
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Response).status).toBe(401);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @km/web test vaults`
Expected: FAIL, module not found for route.

- [ ] **Step 3: Implement route**

Create `apps/web/app/api/vaults/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@km/db";
import { requireUserId } from "../../../lib/session";

export async function GET(_req: Request) {
  const userId = await requireUserId();

  const personal = await prisma.vault.findMany({
    where: { ownerType: "USER", ownerId: userId },
    select: { id: true, name: true, ownerType: true, ownerId: true },
  });

  const memberships = await prisma.membership.findMany({
    where: { userId },
    select: { workspaceId: true, role: true },
  });
  const workspaceIds = memberships.map((m) => m.workspaceId);

  const workspaceVaults = await prisma.vault.findMany({
    where: { ownerType: "WORKSPACE", ownerId: { in: workspaceIds } },
    select: { id: true, name: true, ownerType: true, ownerId: true },
  });

  const vaults = [
    ...personal.map((v) => ({ ...v, workspaceId: null, role: "OWNER" as const })),
    ...workspaceVaults.map((v) => ({
      ...v,
      workspaceId: v.ownerId,
      role: memberships.find((m) => m.workspaceId === v.ownerId)!.role,
    })),
  ];

  return NextResponse.json({ vaults });
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm --filter @km/web test vaults`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/tests/integration/vaults.test.ts apps/web/app/api/vaults/route.ts
git commit -m "feat(web): add GET /api/vaults listing personal and workspace vaults"
```

---

## Task 12: Workspace creation server action and POST /api/workspaces

**Files:**
- Create: `apps/web/app/actions/workspaces.ts`
- Create: `apps/web/app/api/workspaces/route.ts`
- Create: `apps/web/tests/integration/workspaces.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/web/tests/integration/workspaces.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, createUser } from "../helpers/db";
import { prisma } from "@km/db";

vi.mock("../../lib/session", () => ({
  getCurrentUserId: vi.fn(),
  requireUserId: vi.fn(),
}));

import { requireUserId } from "../../lib/session";
import { POST } from "../../app/api/workspaces/route";

describe("POST /api/workspaces", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
  });

  it("creates workspace, OWNER membership, vault, and root folder", async () => {
    const { user } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    const res = await POST(
      new Request("http://t/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Acme Corp" }),
      })
    );
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.workspace.name).toBe("Acme Corp");

    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: body.workspace.id } });
    expect(ws.ownerId).toBe(user.id);
    expect(ws.slug).toBe("acme-corp");

    const m = await prisma.membership.findFirst({ where: { workspaceId: ws.id, userId: user.id } });
    expect(m?.role).toBe("OWNER");

    const vault = await prisma.vault.findFirstOrThrow({
      where: { ownerType: "WORKSPACE", ownerId: ws.id },
    });
    expect(vault.name).toBe("Acme Corp");

    const root = await prisma.folder.findFirstOrThrow({
      where: { vaultId: vault.id, parentId: null },
    });
    expect(root.path).toBe("");
  });

  it("rejects empty name with 400", async () => {
    const { user } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    const res = await POST(
      new Request("http://t/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "" }),
      })
    );
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @km/web test workspaces`
Expected: FAIL, module not found for `app/api/workspaces/route`.

- [ ] **Step 3: Implement server action**

Create `apps/web/app/actions/workspaces.ts`:

```ts
"use server";

import { prisma } from "@km/db";
import { createWorkspaceInput, slugify } from "@km/shared";

export async function createWorkspace(userId: string, rawInput: unknown) {
  const input = createWorkspaceInput.parse(rawInput);
  const baseSlug = slugify(input.name);

  return prisma.$transaction(async (tx) => {
    let slug = baseSlug;
    let suffix = 1;
    while (await tx.workspace.findUnique({ where: { slug } })) {
      suffix += 1;
      slug = `${baseSlug}-${suffix}`;
    }

    const ws = await tx.workspace.create({
      data: { name: input.name, slug, ownerId: userId },
    });
    await tx.membership.create({
      data: { workspaceId: ws.id, userId, role: "OWNER" },
    });
    const vault = await tx.vault.create({
      data: { ownerType: "WORKSPACE", ownerId: ws.id, name: input.name },
    });
    await tx.folder.create({
      data: { vaultId: vault.id, parentId: null, name: "", path: "" },
    });
    return { workspace: ws, vault };
  });
}
```

- [ ] **Step 4: Implement route handler**

Create `apps/web/app/api/workspaces/route.ts`:

```ts
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireUserId } from "../../../lib/session";
import { createWorkspace } from "../../actions/workspaces";

export async function POST(req: Request) {
  const userId = await requireUserId();
  try {
    const body = await req.json();
    const { workspace, vault } = await createWorkspace(userId, body);
    return NextResponse.json({ workspace, vault }, { status: 201 });
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    throw e;
  }
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @km/web test workspaces`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/actions/workspaces.ts apps/web/app/api/workspaces/route.ts apps/web/tests/integration/workspaces.test.ts
git commit -m "feat(web): create workspace with OWNER membership, vault, and root folder"
```

---

## Task 13: POST /api/workspaces/:id/invites

**Files:**
- Create: `apps/web/tests/integration/invites.test.ts`
- Create: `apps/web/app/api/workspaces/[id]/invites/route.ts`

- [ ] **Step 1: Write failing test**

Create `apps/web/tests/integration/invites.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, createUser, createWorkspaceFixture } from "../helpers/db";
import { prisma } from "@km/db";

vi.mock("../../lib/session", () => ({
  getCurrentUserId: vi.fn(),
  requireUserId: vi.fn(),
}));

const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

import { requireUserId } from "../../lib/session";
import { POST as createInvite } from "../../app/api/workspaces/[id]/invites/route";

describe("POST /api/workspaces/:id/invites", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
    logSpy.mockClear();
  });

  it("OWNER can invite; token is generated and email is logged", async () => {
    const { user: owner } = await createUser();
    const { workspace } = await createWorkspaceFixture(owner.id);
    vi.mocked(requireUserId).mockResolvedValue(owner.id);

    const res = await createInvite(
      new Request(`http://t/api/workspaces/${workspace.id}/invites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "friend@test.local", role: "MEMBER" }),
      }),
      { params: { id: workspace.id } }
    );
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.invite.email).toBe("friend@test.local");
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThanOrEqual(32);

    const rows = await prisma.invite.findMany({ where: { workspaceId: workspace.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(body.token);

    expect(logSpy).toHaveBeenCalled();
    const logged = logSpy.mock.calls.flat().join(" ");
    expect(logged).toContain("friend@test.local");
  });

  it("MEMBER cannot invite (403)", async () => {
    const { user: owner } = await createUser();
    const { workspace } = await createWorkspaceFixture(owner.id);
    const { user: member } = await createUser();
    await prisma.membership.create({
      data: { workspaceId: workspace.id, userId: member.id, role: "MEMBER" },
    });
    vi.mocked(requireUserId).mockResolvedValue(member.id);

    const res = await createInvite(
      new Request(`http://t/api/workspaces/${workspace.id}/invites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "x@test.local", role: "MEMBER" }),
      }),
      { params: { id: workspace.id } }
    );
    expect(res.status).toBe(403);
  });

  it("non-member cannot invite (403)", async () => {
    const { user: owner } = await createUser();
    const { workspace } = await createWorkspaceFixture(owner.id);
    const { user: stranger } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(stranger.id);

    const res = await createInvite(
      new Request(`http://t/api/workspaces/${workspace.id}/invites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "x@test.local", role: "MEMBER" }),
      }),
      { params: { id: workspace.id } }
    );
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @km/web test invites`
Expected: FAIL.

- [ ] **Step 3: Implement route**

Create `apps/web/app/api/workspaces/[id]/invites/route.ts`:

```ts
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@km/db";
import { createInviteInput, roleAtLeast, Role } from "@km/shared";
import { requireUserId } from "../../../../../lib/session";
import { generateInviteToken } from "../../../../../lib/invite-token";
import { sendInviteEmail } from "../../../../../lib/email";

export async function POST(req: Request, ctx: { params: { id: string } }) {
  const userId = await requireUserId();
  const workspaceId = ctx.params.id;

  const membership = await prisma.membership.findFirst({
    where: { workspaceId, userId },
    select: { role: true },
  });
  if (!membership || !roleAtLeast(membership.role as Role, "ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let parsed;
  try {
    parsed = createInviteInput.parse(await req.json());
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: e.flatten() }, { status: 400 });
    throw e;
  }

  const { token, tokenHash } = generateInviteToken();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days

  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { name: true },
  });
  const inviter = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });

  const invite = await prisma.invite.create({
    data: {
      workspaceId,
      email: parsed.email,
      tokenHash,
      role: parsed.role,
      expiresAt,
    },
  });

  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  await sendInviteEmail({
    to: parsed.email,
    workspaceName: workspace.name,
    acceptUrl: `${baseUrl}/invites/${token}`,
    inviterName: inviter?.name ?? null,
  });

  return NextResponse.json({ invite, token }, { status: 201 });
}
```

- [ ] **Step 4: Update Prisma schema if needed**

Open `packages/db/prisma/schema.prisma`. Ensure the `Invite` model has a `tokenHash String @unique` field rather than `token`. If Plan A used `token`, rename it to `tokenHash`:

```prisma
model Invite {
  id          String   @id @default(cuid())
  workspaceId String
  email       String
  tokenHash   String   @unique
  role        Role
  expiresAt   DateTime
  acceptedAt  DateTime?
  createdAt   DateTime @default(now())

  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId])
  @@index([email])
}
```

If a rename is required, add a migration:

Run: `pnpm --filter @km/db exec prisma migrate dev --name invite-token-hash`
Expected: migration created, DB updated.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @km/web test invites`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/workspaces/[id]/invites/route.ts apps/web/tests/integration/invites.test.ts packages/db/prisma
git commit -m "feat(web): POST /api/workspaces/:id/invites with OWNER/ADMIN gate"
```

---

## Task 14: POST /api/invites/:token/accept

**Files:**
- Modify: `apps/web/tests/integration/invites.test.ts`
- Create: `apps/web/app/actions/invites.ts`
- Create: `apps/web/app/api/invites/[token]/accept/route.ts`

- [ ] **Step 1: Append failing tests**

Append to `apps/web/tests/integration/invites.test.ts`:

```ts
import { POST as acceptInvite } from "../../app/api/invites/[token]/accept/route";
import { generateInviteToken } from "../../lib/invite-token";

describe("POST /api/invites/:token/accept", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
  });

  it("accepts an invite and creates membership at the invite's role", async () => {
    const { user: owner } = await createUser();
    const { workspace } = await createWorkspaceFixture(owner.id);
    const { user: invitee } = await createUser({ email: "friend@test.local" });
    const { token, tokenHash } = generateInviteToken();
    await prisma.invite.create({
      data: {
        workspaceId: workspace.id,
        email: "friend@test.local",
        tokenHash,
        role: "MEMBER",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    vi.mocked(requireUserId).mockResolvedValue(invitee.id);
    const res = await acceptInvite(
      new Request(`http://t/api/invites/${token}/accept`, { method: "POST" }),
      { params: { token } }
    );
    expect(res.status).toBe(200);

    const m = await prisma.membership.findFirst({
      where: { workspaceId: workspace.id, userId: invitee.id },
    });
    expect(m?.role).toBe("MEMBER");

    const inv = await prisma.invite.findUniqueOrThrow({ where: { tokenHash } });
    expect(inv.acceptedAt).not.toBeNull();
  });

  it("rejects expired invite with 410", async () => {
    const { user: owner } = await createUser();
    const { workspace } = await createWorkspaceFixture(owner.id);
    const { user: invitee } = await createUser({ email: "friend@test.local" });
    const { token, tokenHash } = generateInviteToken();
    await prisma.invite.create({
      data: {
        workspaceId: workspace.id,
        email: "friend@test.local",
        tokenHash,
        role: "MEMBER",
        expiresAt: new Date(Date.now() - 1),
      },
    });

    vi.mocked(requireUserId).mockResolvedValue(invitee.id);
    const res = await acceptInvite(
      new Request(`http://t/api/invites/${token}/accept`, { method: "POST" }),
      { params: { token } }
    );
    expect(res.status).toBe(410);
  });

  it("rejects already-accepted invite with 409", async () => {
    const { user: owner } = await createUser();
    const { workspace } = await createWorkspaceFixture(owner.id);
    const { user: invitee } = await createUser({ email: "friend@test.local" });
    const { token, tokenHash } = generateInviteToken();
    await prisma.invite.create({
      data: {
        workspaceId: workspace.id,
        email: "friend@test.local",
        tokenHash,
        role: "MEMBER",
        expiresAt: new Date(Date.now() + 60_000),
        acceptedAt: new Date(),
      },
    });

    vi.mocked(requireUserId).mockResolvedValue(invitee.id);
    const res = await acceptInvite(
      new Request(`http://t/api/invites/${token}/accept`, { method: "POST" }),
      { params: { token } }
    );
    expect(res.status).toBe(409);
  });

  it("rejects unknown token with 404", async () => {
    const { user: invitee } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(invitee.id);
    const res = await acceptInvite(
      new Request(`http://t/api/invites/bogus/accept`, { method: "POST" }),
      { params: { token: "bogus" } }
    );
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @km/web test invites`
Expected: FAIL.

- [ ] **Step 3: Implement server action**

Create `apps/web/app/actions/invites.ts`:

```ts
"use server";

import { prisma } from "@km/db";
import { hashInviteToken } from "../../lib/invite-token";

export type AcceptResult =
  | { ok: true; workspaceId: string }
  | { ok: false; reason: "not_found" | "expired" | "already_accepted" };

export async function acceptInvite(userId: string, token: string): Promise<AcceptResult> {
  const tokenHash = hashInviteToken(token);
  const invite = await prisma.invite.findUnique({ where: { tokenHash } });
  if (!invite) return { ok: false, reason: "not_found" };
  if (invite.acceptedAt) return { ok: false, reason: "already_accepted" };
  if (invite.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };

  await prisma.$transaction(async (tx) => {
    await tx.membership.upsert({
      where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId } },
      update: {},
      create: { workspaceId: invite.workspaceId, userId, role: invite.role },
    });
    await tx.invite.update({
      where: { tokenHash },
      data: { acceptedAt: new Date() },
    });
  });
  return { ok: true, workspaceId: invite.workspaceId };
}
```

- [ ] **Step 4: Ensure Membership has composite unique**

Open `packages/db/prisma/schema.prisma` and confirm:

```prisma
model Membership {
  id          String  @id @default(cuid())
  workspaceId String
  userId      String
  role        Role

  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, userId])
  @@index([userId])
}
```

If the `@@unique` was missing, run: `pnpm --filter @km/db exec prisma migrate dev --name membership-unique`

- [ ] **Step 5: Implement route**

Create `apps/web/app/api/invites/[token]/accept/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireUserId } from "../../../../../lib/session";
import { acceptInvite } from "../../../../actions/invites";

export async function POST(_req: Request, ctx: { params: { token: string } }) {
  const userId = await requireUserId();
  const result = await acceptInvite(userId, ctx.params.token);
  if (result.ok) return NextResponse.json({ workspaceId: result.workspaceId }, { status: 200 });
  if (result.reason === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (result.reason === "expired") return NextResponse.json({ error: "Expired" }, { status: 410 });
  return NextResponse.json({ error: "Already accepted" }, { status: 409 });
}
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @km/web test invites`
Expected: PASS, 7 tests total in the file.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/actions/invites.ts apps/web/app/api/invites/[token]/accept/route.ts apps/web/tests/integration/invites.test.ts packages/db/prisma
git commit -m "feat(web): POST /api/invites/:token/accept creates membership"
```

---

## Task 15: POST /api/folders

**Files:**
- Create: `apps/web/tests/integration/folders.test.ts`
- Create: `apps/web/app/api/folders/route.ts`

- [ ] **Step 1: Write failing test**

Create `apps/web/tests/integration/folders.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, createUser, createWorkspaceFixture } from "../helpers/db";
import { prisma } from "@km/db";

vi.mock("../../lib/session", () => ({
  getCurrentUserId: vi.fn(),
  requireUserId: vi.fn(),
}));

import { requireUserId } from "../../lib/session";
import { POST as createFolder } from "../../app/api/folders/route";

describe("POST /api/folders", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
  });

  it("creates top-level folder with path equal to name", async () => {
    const { user, vault, rootFolder } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    const res = await createFolder(
      new Request("http://t/api/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vaultId: vault.id, parentId: rootFolder.id, name: "Projects" }),
      })
    );
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.folder.path).toBe("Projects");
    expect(body.folder.parentId).toBe(rootFolder.id);
  });

  it("creates nested folder with composed path", async () => {
    const { user, vault, rootFolder } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    const projects = await prisma.folder.create({
      data: { vaultId: vault.id, parentId: rootFolder.id, name: "Projects", path: "Projects" },
    });
    const res = await createFolder(
      new Request("http://t/api/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vaultId: vault.id, parentId: projects.id, name: "Acme" }),
      })
    );
    const body = await res.json();
    expect(body.folder.path).toBe("Projects/Acme");
  });

  it("rejects non-members with 403", async () => {
    const { user: owner } = await createUser();
    const { vault } = await createWorkspaceFixture(owner.id);
    const { user: stranger } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(stranger.id);

    const res = await createFolder(
      new Request("http://t/api/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vaultId: vault.id, parentId: null, name: "X" }),
      })
    );
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @km/web test folders`
Expected: FAIL.

- [ ] **Step 3: Implement route**

Create `apps/web/app/api/folders/route.ts`:

```ts
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@km/db";
import { createFolderInput } from "@km/shared";
import { requireUserId } from "../../../lib/session";
import { assertCanAccessVault, AuthzError } from "../../../lib/authz";
import { computeChildPath } from "../../../lib/folder-path";

export async function POST(req: Request) {
  const userId = await requireUserId();
  let input;
  try {
    input = createFolderInput.parse(await req.json());
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: e.flatten() }, { status: 400 });
    throw e;
  }

  try {
    await assertCanAccessVault(userId, input.vaultId, "MEMBER");
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  let parentPath = "";
  if (input.parentId) {
    const parent = await prisma.folder.findUnique({
      where: { id: input.parentId },
      select: { vaultId: true, path: true },
    });
    if (!parent || parent.vaultId !== input.vaultId) {
      return NextResponse.json({ error: "Bad parent" }, { status: 400 });
    }
    parentPath = parent.path;
  }

  const folder = await prisma.folder.create({
    data: {
      vaultId: input.vaultId,
      parentId: input.parentId ?? null,
      name: input.name,
      path: computeChildPath(parentPath, input.name),
    },
  });
  return NextResponse.json({ folder }, { status: 201 });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @km/web test folders`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/folders/route.ts apps/web/tests/integration/folders.test.ts
git commit -m "feat(web): POST /api/folders with authz and path denormalization"
```

---

## Task 16: PATCH / DELETE /api/folders/:id

**Files:**
- Modify: `apps/web/tests/integration/folders.test.ts`
- Create: `apps/web/app/api/folders/[id]/route.ts`

- [ ] **Step 1: Append failing tests**

Append to `apps/web/tests/integration/folders.test.ts`:

```ts
import { PATCH as patchFolder, DELETE as deleteFolder } from "../../app/api/folders/[id]/route";

describe("PATCH /api/folders/:id", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
  });

  it("rename updates own path and descendant paths", async () => {
    const { user, vault } = await createUser();
    const a = await prisma.folder.create({ data: { vaultId: vault.id, name: "A", path: "A" } });
    const b = await prisma.folder.create({ data: { vaultId: vault.id, parentId: a.id, name: "B", path: "A/B" } });
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    const res = await patchFolder(
      new Request(`http://t/api/folders/${a.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "AA" }),
      }),
      { params: { id: a.id } }
    );
    expect(res.status).toBe(200);
    const refreshedB = await prisma.folder.findUniqueOrThrow({ where: { id: b.id } });
    expect(refreshedB.path).toBe("AA/B");
  });

  it("move updates parentId and path", async () => {
    const { user, vault } = await createUser();
    const a = await prisma.folder.create({ data: { vaultId: vault.id, name: "A", path: "A" } });
    const b = await prisma.folder.create({ data: { vaultId: vault.id, name: "B", path: "B" } });
    const c = await prisma.folder.create({ data: { vaultId: vault.id, parentId: a.id, name: "C", path: "A/C" } });
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    const res = await patchFolder(
      new Request(`http://t/api/folders/${c.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parentId: b.id }),
      }),
      { params: { id: c.id } }
    );
    expect(res.status).toBe(200);
    const refreshed = await prisma.folder.findUniqueOrThrow({ where: { id: c.id } });
    expect(refreshed.parentId).toBe(b.id);
    expect(refreshed.path).toBe("B/C");
  });
});

describe("DELETE /api/folders/:id", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
  });

  it("deletes folder and cascades via Prisma", async () => {
    const { user, vault } = await createUser();
    const f = await prisma.folder.create({ data: { vaultId: vault.id, name: "X", path: "X" } });
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    const res = await deleteFolder(
      new Request(`http://t/api/folders/${f.id}`, { method: "DELETE" }),
      { params: { id: f.id } }
    );
    expect(res.status).toBe(204);
    expect(await prisma.folder.findUnique({ where: { id: f.id } })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @km/web test folders`
Expected: FAIL.

- [ ] **Step 3: Implement route**

Create `apps/web/app/api/folders/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@km/db";
import { updateFolderInput } from "@km/shared";
import { requireUserId } from "../../../../lib/session";
import { assertCanAccessVault, AuthzError } from "../../../../lib/authz";
import { computeChildPath, recomputeDescendantPaths } from "../../../../lib/folder-path";

export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  const userId = await requireUserId();
  const folderId = ctx.params.id;

  let input;
  try {
    input = updateFolderInput.parse(await req.json());
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: e.flatten() }, { status: 400 });
    throw e;
  }

  const current = await prisma.folder.findUnique({ where: { id: folderId } });
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    await assertCanAccessVault(userId, current.vaultId, "MEMBER");
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  let parentPath = "";
  let newParentId: string | null = current.parentId;
  if (input.parentId !== undefined) {
    newParentId = input.parentId;
    if (newParentId) {
      const parent = await prisma.folder.findUnique({
        where: { id: newParentId },
        select: { vaultId: true, path: true, id: true },
      });
      if (!parent || parent.vaultId !== current.vaultId) {
        return NextResponse.json({ error: "Bad parent" }, { status: 400 });
      }
      if (parent.id === current.id) {
        return NextResponse.json({ error: "Cannot parent to self" }, { status: 400 });
      }
      parentPath = parent.path;
    }
  } else if (current.parentId) {
    const parent = await prisma.folder.findUnique({
      where: { id: current.parentId },
      select: { path: true },
    });
    parentPath = parent?.path ?? "";
  }

  const newName = input.name ?? current.name;
  const newPath = computeChildPath(parentPath, newName);

  const folder = await prisma.$transaction(async (tx) => {
    const updated = await tx.folder.update({
      where: { id: folderId },
      data: { name: newName, parentId: newParentId, path: newPath },
    });
    await recomputeDescendantPaths(tx, folderId);
    return updated;
  });

  return NextResponse.json({ folder }, { status: 200 });
}

export async function DELETE(_req: Request, ctx: { params: { id: string } }) {
  const userId = await requireUserId();
  const folderId = ctx.params.id;
  const current = await prisma.folder.findUnique({ where: { id: folderId } });
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    await assertCanAccessVault(userId, current.vaultId, "MEMBER");
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  await prisma.folder.delete({ where: { id: folderId } });
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 4: Verify Folder cascade in Prisma**

Open `packages/db/prisma/schema.prisma` and confirm `Folder` relations use `onDelete: Cascade` for self-ref and for owned `Note` relations. If missing, add:

```prisma
model Folder {
  id       String  @id @default(cuid())
  vaultId  String
  parentId String?
  name     String
  path     String

  vault    Vault    @relation(fields: [vaultId], references: [id], onDelete: Cascade)
  parent   Folder?  @relation("FolderChildren", fields: [parentId], references: [id], onDelete: Cascade)
  children Folder[] @relation("FolderChildren")
  notes    Note[]

  @@index([vaultId])
  @@index([parentId])
}
```

Run: `pnpm --filter @km/db exec prisma migrate dev --name folder-cascade` if changed.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @km/web test folders`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/folders/[id]/route.ts apps/web/tests/integration/folders.test.ts packages/db/prisma
git commit -m "feat(web): PATCH/DELETE /api/folders/:id with path sync"
```

---

## Task 17: POST /api/notes

**Files:**
- Create: `apps/web/tests/integration/notes.test.ts`
- Create: `apps/web/app/api/notes/route.ts`

- [ ] **Step 1: Write failing test**

Create `apps/web/tests/integration/notes.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, createUser, createWorkspaceFixture } from "../helpers/db";
import { prisma } from "@km/db";

vi.mock("../../lib/session", () => ({
  getCurrentUserId: vi.fn(),
  requireUserId: vi.fn(),
}));

import { requireUserId } from "../../lib/session";
import { POST as createNote } from "../../app/api/notes/route";

describe("POST /api/notes", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
  });

  it("creates a note in the personal vault with slug derived from title", async () => {
    const { user, vault, rootFolder } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(user.id);
    const res = await createNote(
      new Request("http://t/api/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vaultId: vault.id, folderId: rootFolder.id, title: "My First" }),
      })
    );
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.note.slug).toBe("my-first");
    expect(body.note.vaultId).toBe(vault.id);
    expect(body.note.createdById).toBe(user.id);
  });

  it("rejects non-member on workspace vault", async () => {
    const { user: owner } = await createUser();
    const { vault } = await createWorkspaceFixture(owner.id);
    const { user: stranger } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(stranger.id);
    const res = await createNote(
      new Request("http://t/api/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vaultId: vault.id, folderId: null, title: "X" }),
      })
    );
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @km/web test notes`
Expected: FAIL.

- [ ] **Step 3: Implement route**

Create `apps/web/app/api/notes/route.ts`:

```ts
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@km/db";
import { createNoteInput, slugify } from "@km/shared";
import { requireUserId } from "../../../lib/session";
import { assertCanAccessVault, AuthzError } from "../../../lib/authz";

export async function POST(req: Request) {
  const userId = await requireUserId();
  let input;
  try {
    input = createNoteInput.parse(await req.json());
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: e.flatten() }, { status: 400 });
    throw e;
  }

  try {
    await assertCanAccessVault(userId, input.vaultId, "MEMBER");
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  if (input.folderId) {
    const folder = await prisma.folder.findUnique({
      where: { id: input.folderId },
      select: { vaultId: true },
    });
    if (!folder || folder.vaultId !== input.vaultId) {
      return NextResponse.json({ error: "Bad folder" }, { status: 400 });
    }
  }

  const baseSlug = slugify(input.title);
  let slug = baseSlug;
  let suffix = 1;
  while (await prisma.note.findFirst({ where: { vaultId: input.vaultId, slug } })) {
    suffix += 1;
    slug = `${baseSlug}-${suffix}`;
  }

  const now = new Date();
  const note = await prisma.note.create({
    data: {
      vaultId: input.vaultId,
      folderId: input.folderId ?? null,
      title: input.title,
      slug,
      content: input.content ?? "",
      contentUpdatedAt: now,
      createdById: userId,
      updatedById: userId,
    },
  });

  return NextResponse.json({ note }, { status: 201 });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @km/web test notes`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/notes/route.ts apps/web/tests/integration/notes.test.ts
git commit -m "feat(web): POST /api/notes with vault authz and unique slug"
```

---

## Task 18: GET / PATCH / DELETE /api/notes/:id

**Files:**
- Modify: `apps/web/tests/integration/notes.test.ts`
- Create: `apps/web/app/api/notes/[id]/route.ts`

- [ ] **Step 1: Append failing tests**

Append to `apps/web/tests/integration/notes.test.ts`:

```ts
import { GET as getNote, PATCH as patchNote, DELETE as deleteNote } from "../../app/api/notes/[id]/route";

describe("/api/notes/:id", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
  });

  it("GET returns note for authorized user", async () => {
    const { user, vault } = await createUser();
    const n = await prisma.note.create({
      data: { vaultId: vault.id, title: "T", slug: "t", content: "hello", contentUpdatedAt: new Date(), createdById: user.id, updatedById: user.id },
    });
    vi.mocked(requireUserId).mockResolvedValue(user.id);
    const res = await getNote(new Request(`http://t/api/notes/${n.id}`), { params: { id: n.id } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.note.content).toBe("hello");
  });

  it("PATCH updates content and stamps updatedById", async () => {
    const { user, vault } = await createUser();
    const n = await prisma.note.create({
      data: { vaultId: vault.id, title: "T", slug: "t", content: "a", contentUpdatedAt: new Date(), createdById: user.id, updatedById: user.id },
    });
    vi.mocked(requireUserId).mockResolvedValue(user.id);
    const res = await patchNote(
      new Request(`http://t/api/notes/${n.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "b" }),
      }),
      { params: { id: n.id } }
    );
    expect(res.status).toBe(200);
    const refreshed = await prisma.note.findUniqueOrThrow({ where: { id: n.id } });
    expect(refreshed.content).toBe("b");
    expect(refreshed.updatedById).toBe(user.id);
  });

  it("DELETE removes note", async () => {
    const { user, vault } = await createUser();
    const n = await prisma.note.create({
      data: { vaultId: vault.id, title: "T", slug: "t", content: "", contentUpdatedAt: new Date(), createdById: user.id, updatedById: user.id },
    });
    vi.mocked(requireUserId).mockResolvedValue(user.id);
    const res = await deleteNote(new Request(`http://t/api/notes/${n.id}`, { method: "DELETE" }), { params: { id: n.id } });
    expect(res.status).toBe(204);
    expect(await prisma.note.findUnique({ where: { id: n.id } })).toBeNull();
  });

  it("GET returns 403 for unrelated user on workspace note", async () => {
    const { user: owner } = await createUser();
    const { vault } = await createWorkspaceFixture(owner.id);
    const n = await prisma.note.create({
      data: { vaultId: vault.id, title: "T", slug: "t", content: "", contentUpdatedAt: new Date(), createdById: owner.id, updatedById: owner.id },
    });
    const { user: stranger } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(stranger.id);
    const res = await getNote(new Request(`http://t/api/notes/${n.id}`), { params: { id: n.id } });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @km/web test notes`
Expected: FAIL.

- [ ] **Step 3: Implement route**

Create `apps/web/app/api/notes/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@km/db";
import { updateNoteInput } from "@km/shared";
import { requireUserId } from "../../../../lib/session";
import { assertCanAccessVault, AuthzError } from "../../../../lib/authz";

async function loadNoteAndAuthz(userId: string, noteId: string) {
  const note = await prisma.note.findUnique({ where: { id: noteId } });
  if (!note) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  try {
    await assertCanAccessVault(userId, note.vaultId, "MEMBER");
  } catch (e) {
    if (e instanceof AuthzError) return { error: NextResponse.json({ error: e.message }, { status: e.status }) };
    throw e;
  }
  return { note };
}

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const userId = await requireUserId();
  const { error, note } = await loadNoteAndAuthz(userId, ctx.params.id);
  if (error) return error;
  return NextResponse.json({ note }, { status: 200 });
}

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

  const contentChanged = typeof input.content === "string" && input.content !== note!.content;
  const updated = await prisma.note.update({
    where: { id: note!.id },
    data: {
      title: input.title ?? note!.title,
      content: input.content ?? note!.content,
      folderId: input.folderId === undefined ? note!.folderId : input.folderId,
      contentUpdatedAt: contentChanged ? new Date() : note!.contentUpdatedAt,
      updatedById: userId,
    },
  });
  return NextResponse.json({ note: updated }, { status: 200 });
}

export async function DELETE(_req: Request, ctx: { params: { id: string } }) {
  const userId = await requireUserId();
  const { error } = await loadNoteAndAuthz(userId, ctx.params.id);
  if (error) return error;
  await prisma.note.delete({ where: { id: ctx.params.id } });
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @km/web test notes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/notes/[id]/route.ts apps/web/tests/integration/notes.test.ts
git commit -m "feat(web): GET/PATCH/DELETE /api/notes/:id with authz"
```

---

## Task 19: GET /api/notes/search

**Files:**
- Create: `apps/web/tests/integration/notes-search.test.ts`
- Create: `apps/web/app/api/notes/search/route.ts`

- [ ] **Step 1: Write failing test**

Create `apps/web/tests/integration/notes-search.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, createUser } from "../helpers/db";
import { prisma } from "@km/db";

vi.mock("../../lib/session", () => ({
  getCurrentUserId: vi.fn(),
  requireUserId: vi.fn(),
}));

import { requireUserId } from "../../lib/session";
import { GET as searchNotes } from "../../app/api/notes/search/route";

describe("GET /api/notes/search", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
  });

  it("returns notes whose titles match prefix (case-insensitive)", async () => {
    const { user, vault } = await createUser();
    await prisma.note.createMany({
      data: [
        { vaultId: vault.id, title: "Project Alpha", slug: "project-alpha", content: "", contentUpdatedAt: new Date(), createdById: user.id, updatedById: user.id },
        { vaultId: vault.id, title: "Project Beta", slug: "project-beta", content: "", contentUpdatedAt: new Date(), createdById: user.id, updatedById: user.id },
        { vaultId: vault.id, title: "Diary", slug: "diary", content: "", contentUpdatedAt: new Date(), createdById: user.id, updatedById: user.id },
      ],
    });
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    const res = await searchNotes(
      new Request(`http://t/api/notes/search?vaultId=${vault.id}&q=proj`)
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    const titles = body.results.map((r: any) => r.title).sort();
    expect(titles).toEqual(["Project Alpha", "Project Beta"]);
  });

  it("rejects caller without vault access", async () => {
    const { user, vault } = await createUser();
    const { user: stranger } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(stranger.id);
    const res = await searchNotes(
      new Request(`http://t/api/notes/search?vaultId=${vault.id}&q=a`)
    );
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @km/web test notes-search`
Expected: FAIL.

- [ ] **Step 3: Implement route**

Create `apps/web/app/api/notes/search/route.ts`:

```ts
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@km/db";
import { searchNotesQuery } from "@km/shared";
import { requireUserId } from "../../../../lib/session";
import { assertCanAccessVault, AuthzError } from "../../../../lib/authz";

export async function GET(req: Request) {
  const userId = await requireUserId();
  const url = new URL(req.url);
  let params;
  try {
    params = searchNotesQuery.parse({
      vaultId: url.searchParams.get("vaultId"),
      q: url.searchParams.get("q"),
    });
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: e.flatten() }, { status: 400 });
    throw e;
  }

  try {
    await assertCanAccessVault(userId, params.vaultId, "MEMBER");
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const results = await prisma.note.findMany({
    where: {
      vaultId: params.vaultId,
      title: { startsWith: params.q, mode: "insensitive" },
    },
    select: { id: true, title: true, slug: true },
    orderBy: { title: "asc" },
    take: 20,
  });
  return NextResponse.json({ results }, { status: 200 });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @km/web test notes-search`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/notes/search/route.ts apps/web/tests/integration/notes-search.test.ts
git commit -m "feat(web): GET /api/notes/search with ILIKE prefix match"
```

---

## Task 20: GET /api/notes/:id/backlinks

**Files:**
- Create: `apps/web/tests/integration/backlinks.test.ts`
- Create: `apps/web/app/api/notes/[id]/backlinks/route.ts`

- [ ] **Step 1: Write failing test**

Create `apps/web/tests/integration/backlinks.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, createUser } from "../helpers/db";
import { prisma } from "@km/db";

vi.mock("../../lib/session", () => ({
  getCurrentUserId: vi.fn(),
  requireUserId: vi.fn(),
}));

import { requireUserId } from "../../lib/session";
import { GET as getBacklinks } from "../../app/api/notes/[id]/backlinks/route";

describe("GET /api/notes/:id/backlinks", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
  });

  it("returns resolved Link rows pointing to the note with source titles", async () => {
    const { user, vault } = await createUser();
    const target = await prisma.note.create({
      data: { vaultId: vault.id, title: "Target", slug: "target", content: "", contentUpdatedAt: new Date(), createdById: user.id, updatedById: user.id },
    });
    const source = await prisma.note.create({
      data: { vaultId: vault.id, title: "Source", slug: "source", content: "[[Target]]", contentUpdatedAt: new Date(), createdById: user.id, updatedById: user.id },
    });
    await prisma.link.create({
      data: { sourceNoteId: source.id, targetNoteId: target.id, targetTitle: "Target", resolved: true },
    });
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    const res = await getBacklinks(new Request(`http://t/api/notes/${target.id}/backlinks`), { params: { id: target.id } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.backlinks).toHaveLength(1);
    expect(body.backlinks[0].sourceNote.id).toBe(source.id);
    expect(body.backlinks[0].sourceNote.title).toBe("Source");
  });

  it("returns empty list when no links exist", async () => {
    const { user, vault } = await createUser();
    const n = await prisma.note.create({
      data: { vaultId: vault.id, title: "Lonely", slug: "lonely", content: "", contentUpdatedAt: new Date(), createdById: user.id, updatedById: user.id },
    });
    vi.mocked(requireUserId).mockResolvedValue(user.id);
    const res = await getBacklinks(new Request(`http://t/api/notes/${n.id}/backlinks`), { params: { id: n.id } });
    const body = await res.json();
    expect(body.backlinks).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @km/web test backlinks`
Expected: FAIL.

- [ ] **Step 3: Implement route**

Create `apps/web/app/api/notes/[id]/backlinks/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@km/db";
import { requireUserId } from "../../../../../lib/session";
import { assertCanAccessVault, AuthzError } from "../../../../../lib/authz";

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const userId = await requireUserId();
  const note = await prisma.note.findUnique({ where: { id: ctx.params.id }, select: { vaultId: true } });
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    await assertCanAccessVault(userId, note.vaultId, "MEMBER");
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const links = await prisma.link.findMany({
    where: { targetNoteId: ctx.params.id, resolved: true },
    select: {
      id: true,
      targetTitle: true,
      sourceNote: { select: { id: true, title: true, slug: true } },
    },
  });
  return NextResponse.json({ backlinks: links }, { status: 200 });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @km/web test backlinks`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/notes/[id]/backlinks/route.ts apps/web/tests/integration/backlinks.test.ts
git commit -m "feat(web): GET /api/notes/:id/backlinks reads Link table"
```

---

## Task 21: GET /api/vaults/:id/tree

**Files:**
- Create: `apps/web/tests/integration/tree.test.ts`
- Create: `apps/web/app/api/vaults/[id]/tree/route.ts`

- [ ] **Step 1: Write failing test**

Create `apps/web/tests/integration/tree.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, createUser } from "../helpers/db";
import { prisma } from "@km/db";

vi.mock("../../lib/session", () => ({
  getCurrentUserId: vi.fn(),
  requireUserId: vi.fn(),
}));

import { requireUserId } from "../../lib/session";
import { GET as getTree } from "../../app/api/vaults/[id]/tree/route";

describe("GET /api/vaults/:id/tree", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
  });

  it("returns nested folder + note structure", async () => {
    const { user, vault, rootFolder } = await createUser();
    const projects = await prisma.folder.create({
      data: { vaultId: vault.id, parentId: rootFolder.id, name: "Projects", path: "Projects" },
    });
    await prisma.note.create({
      data: { vaultId: vault.id, folderId: projects.id, title: "Alpha", slug: "alpha", content: "", contentUpdatedAt: new Date(), createdById: user.id, updatedById: user.id },
    });
    await prisma.note.create({
      data: { vaultId: vault.id, folderId: rootFolder.id, title: "Inbox", slug: "inbox", content: "", contentUpdatedAt: new Date(), createdById: user.id, updatedById: user.id },
    });

    vi.mocked(requireUserId).mockResolvedValue(user.id);
    const res = await getTree(new Request(`http://t/api/vaults/${vault.id}/tree`), { params: { id: vault.id } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.root.id).toBe(rootFolder.id);
    expect(body.root.children.map((c: any) => c.name)).toEqual(["Projects"]);
    expect(body.root.notes.map((n: any) => n.title)).toEqual(["Inbox"]);
    expect(body.root.children[0].notes.map((n: any) => n.title)).toEqual(["Alpha"]);
  });

  it("returns 403 for non-members on workspace vault", async () => {
    const { user: other } = await createUser();
    const { user, vault } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(other.id);
    const res = await getTree(new Request(`http://t/api/vaults/${vault.id}/tree`), { params: { id: vault.id } });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @km/web test tree`
Expected: FAIL.

- [ ] **Step 3: Implement route**

Create `apps/web/app/api/vaults/[id]/tree/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@km/db";
import { requireUserId } from "../../../../../lib/session";
import { assertCanAccessVault, AuthzError } from "../../../../../lib/authz";

interface TreeFolder {
  id: string;
  name: string;
  path: string;
  children: TreeFolder[];
  notes: Array<{ id: string; title: string; slug: string }>;
}

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const userId = await requireUserId();
  const vaultId = ctx.params.id;
  try {
    await assertCanAccessVault(userId, vaultId, "MEMBER");
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const [folders, notes] = await Promise.all([
    prisma.folder.findMany({ where: { vaultId }, orderBy: { name: "asc" } }),
    prisma.note.findMany({
      where: { vaultId },
      select: { id: true, title: true, slug: true, folderId: true },
      orderBy: { title: "asc" },
    }),
  ]);

  const byId = new Map<string, TreeFolder>();
  for (const f of folders) {
    byId.set(f.id, { id: f.id, name: f.name, path: f.path, children: [], notes: [] });
  }
  let rootId: string | null = null;
  for (const f of folders) {
    const node = byId.get(f.id)!;
    if (f.parentId) {
      const parent = byId.get(f.parentId);
      parent?.children.push(node);
    } else {
      rootId = f.id;
    }
  }
  for (const n of notes) {
    if (n.folderId && byId.has(n.folderId)) {
      byId.get(n.folderId)!.notes.push({ id: n.id, title: n.title, slug: n.slug });
    }
  }
  if (!rootId) return NextResponse.json({ error: "Vault missing root folder" }, { status: 500 });
  return NextResponse.json({ root: byId.get(rootId) }, { status: 200 });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @km/web test tree`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/vaults/[id]/tree/route.ts apps/web/tests/integration/tree.test.ts
git commit -m "feat(web): GET /api/vaults/:id/tree returns nested folder/note structure"
```

---

## Task 22: Workspaces list + create pages

**Files:**
- Create: `apps/web/app/(app)/workspaces/page.tsx`
- Create: `apps/web/app/(app)/workspaces/new/page.tsx`

- [ ] **Step 1: Implement list page**

Create `apps/web/app/(app)/workspaces/page.tsx`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@km/db";
import { getCurrentUserId } from "../../../lib/session";

export default async function WorkspacesPage() {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");
  const memberships = await prisma.membership.findMany({
    where: { userId },
    include: { workspace: true },
    orderBy: { workspace: { name: "asc" } },
  });

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Workspaces</h1>
        <Link className="underline" href="/workspaces/new">Create workspace</Link>
      </div>
      {memberships.length === 0 ? (
        <p>You are not a member of any workspaces yet.</p>
      ) : (
        <ul className="space-y-2">
          {memberships.map((m) => (
            <li key={m.id}>
              <Link href={`/workspaces/${m.workspace.id}/members`} className="underline">
                {m.workspace.name}
              </Link>{" "}
              <span className="text-sm text-gray-500">({m.role})</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Implement new workspace page**

Create `apps/web/app/(app)/workspaces/new/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getCurrentUserId } from "../../../../lib/session";
import { createWorkspace } from "../../../actions/workspaces";

export default async function NewWorkspacePage() {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");

  async function action(formData: FormData) {
    "use server";
    const uid = await getCurrentUserId();
    if (!uid) redirect("/login");
    const { workspace } = await createWorkspace(uid, { name: String(formData.get("name") ?? "") });
    redirect(`/workspaces/${workspace.id}/members`);
  }

  return (
    <main className="p-6 max-w-md space-y-4">
      <h1 className="text-2xl font-semibold">New workspace</h1>
      <form action={action} className="space-y-3">
        <label className="block">
          <span className="block text-sm">Name</span>
          <input name="name" required className="border rounded px-2 py-1 w-full" />
        </label>
        <button type="submit" className="border rounded px-3 py-1">Create</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @km/web typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(app)/workspaces/page.tsx" "apps/web/app/(app)/workspaces/new/page.tsx"
git commit -m "feat(web): add workspaces list and create pages"
```

---

## Task 23: Members + invite page

**Files:**
- Create: `apps/web/app/(app)/workspaces/[id]/members/page.tsx`

- [ ] **Step 1: Implement**

Create `apps/web/app/(app)/workspaces/[id]/members/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { prisma } from "@km/db";
import { getCurrentUserId } from "../../../../../lib/session";
import { generateInviteToken } from "../../../../../lib/invite-token";
import { sendInviteEmail } from "../../../../../lib/email";
import { roleAtLeast, Role } from "@km/shared";

export default async function MembersPage({ params }: { params: { id: string } }) {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");
  const workspaceId = params.id;
  const membership = await prisma.membership.findFirst({ where: { workspaceId, userId } });
  if (!membership) redirect("/workspaces");
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  const members = await prisma.membership.findMany({
    where: { workspaceId },
    include: { user: true },
    orderBy: { role: "asc" },
  });
  const canInvite = roleAtLeast(membership.role as Role, "ADMIN");

  async function invite(formData: FormData) {
    "use server";
    const uid = await getCurrentUserId();
    if (!uid) redirect("/login");
    const m = await prisma.membership.findFirst({ where: { workspaceId, userId: uid } });
    if (!m || !roleAtLeast(m.role as Role, "ADMIN")) return;
    const email = String(formData.get("email") ?? "");
    const role = String(formData.get("role") ?? "MEMBER") as "ADMIN" | "MEMBER";
    const { token, tokenHash } = generateInviteToken();
    await prisma.invite.create({
      data: {
        workspaceId,
        email,
        tokenHash,
        role,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
      },
    });
    const inviter = await prisma.user.findUnique({ where: { id: uid }, select: { name: true } });
    const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
    await sendInviteEmail({
      to: email,
      workspaceName: workspace.name,
      acceptUrl: `${baseUrl}/invites/${token}`,
      inviterName: inviter?.name ?? null,
    });
  }

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">{workspace.name} members</h1>
      <ul className="space-y-1">
        {members.map((m) => (
          <li key={m.id}>
            {m.user.email} <span className="text-sm text-gray-500">({m.role})</span>
          </li>
        ))}
      </ul>
      {canInvite && (
        <form action={invite} className="space-y-2 max-w-md">
          <h2 className="text-lg font-semibold">Invite a member</h2>
          <input name="email" type="email" required placeholder="email@example.com" className="border rounded px-2 py-1 w-full" />
          <select name="role" className="border rounded px-2 py-1 w-full">
            <option value="MEMBER">Member</option>
            <option value="ADMIN">Admin</option>
          </select>
          <button type="submit" className="border rounded px-3 py-1">Send invite</button>
          <p className="text-xs text-gray-500">The invite link is logged to the server console in v1.</p>
        </form>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @km/web typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(app)/workspaces/[id]/members/page.tsx"
git commit -m "feat(web): workspace members page with invite form"
```

---

## Task 24: Accept-invite landing page

**Files:**
- Create: `apps/web/app/(app)/invites/[token]/page.tsx`

- [ ] **Step 1: Implement**

Create `apps/web/app/(app)/invites/[token]/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getCurrentUserId } from "../../../../lib/session";
import { acceptInvite } from "../../../actions/invites";
import { prisma } from "@km/db";
import { hashInviteToken } from "../../../../lib/invite-token";

export default async function AcceptInvitePage({ params }: { params: { token: string } }) {
  const userId = await getCurrentUserId();
  if (!userId) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/invites/${params.token}`)}`);
  }
  const invite = await prisma.invite.findUnique({
    where: { tokenHash: hashInviteToken(params.token) },
    include: { workspace: true },
  });

  async function accept() {
    "use server";
    const uid = await getCurrentUserId();
    if (!uid) redirect(`/login?callbackUrl=${encodeURIComponent(`/invites/${params.token}`)}`);
    const result = await acceptInvite(uid, params.token);
    if (result.ok) redirect(`/workspaces/${result.workspaceId}/members`);
    redirect("/workspaces");
  }

  if (!invite) return <main className="p-6">This invite is not valid.</main>;
  if (invite.acceptedAt) return <main className="p-6">This invite has already been accepted.</main>;
  if (invite.expiresAt.getTime() < Date.now()) return <main className="p-6">This invite has expired.</main>;

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Join {invite.workspace.name}</h1>
      <p>You have been invited as <strong>{invite.role}</strong>.</p>
      <form action={accept}>
        <button type="submit" className="border rounded px-3 py-1">Accept invite</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @km/web typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(app)/invites/[token]/page.tsx"
git commit -m "feat(web): accept-invite landing page"
```

---

## Task 25: VaultSwitcher component

**Files:**
- Create: `apps/web/components/VaultSwitcher.tsx`

- [ ] **Step 1: Implement**

Create `apps/web/components/VaultSwitcher.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface VaultItem {
  id: string;
  name: string;
  ownerType: "USER" | "WORKSPACE";
}

export function VaultSwitcher({ currentVaultId }: { currentVaultId: string }) {
  const router = useRouter();
  const [vaults, setVaults] = useState<VaultItem[]>([]);

  useEffect(() => {
    fetch("/api/vaults")
      .then((r) => r.json())
      .then((d) => setVaults(d.vaults ?? []));
  }, []);

  return (
    <select
      value={currentVaultId}
      onChange={(e) => router.push(`/vault/${e.target.value}`)}
      className="border rounded px-2 py-1 w-full"
    >
      {vaults.map((v) => (
        <option key={v.id} value={v.id}>
          {v.ownerType === "USER" ? "Personal" : v.name}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/VaultSwitcher.tsx
git commit -m "feat(web): VaultSwitcher component"
```

---

## Task 26: FileTree + FileTreeItem components

**Files:**
- Create: `apps/web/components/FileTree.tsx`
- Create: `apps/web/components/FileTreeItem.tsx`

- [ ] **Step 1: Implement FileTreeItem**

Create `apps/web/components/FileTreeItem.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";

export interface TreeNode {
  id: string;
  name: string;
  path: string;
  children: TreeNode[];
  notes: Array<{ id: string; title: string; slug: string }>;
}

interface Props {
  vaultId: string;
  node: TreeNode;
  onCreateFolder: (parentId: string) => void;
  onCreateNote: (folderId: string) => void;
  onRenameFolder: (id: string, currentName: string) => void;
  onDeleteFolder: (id: string) => void;
  onDropInto: (targetFolderId: string, kind: "folder" | "note", id: string) => void;
}

export function FileTreeItem(p: Props) {
  const [open, setOpen] = useState(true);

  return (
    <li
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const kind = e.dataTransfer.getData("kind") as "folder" | "note";
        const id = e.dataTransfer.getData("id");
        if (id) p.onDropInto(p.node.id, kind, id);
      }}
    >
      <div
        className="flex items-center gap-1"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("kind", "folder");
          e.dataTransfer.setData("id", p.node.id);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          const choice = window.prompt("Action: new-folder | new-note | rename | delete");
          if (choice === "new-folder") p.onCreateFolder(p.node.id);
          else if (choice === "new-note") p.onCreateNote(p.node.id);
          else if (choice === "rename") p.onRenameFolder(p.node.id, p.node.name);
          else if (choice === "delete") p.onDeleteFolder(p.node.id);
        }}
      >
        <button onClick={() => setOpen(!open)} className="w-4">{open ? "v" : ">"}</button>
        <span>{p.node.name === "" ? "(root)" : p.node.name}</span>
      </div>
      {open && (
        <ul className="pl-4">
          {p.node.children.map((c) => (
            <FileTreeItem key={c.id} {...p} node={c} />
          ))}
          {p.node.notes.map((n) => (
            <li
              key={n.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("kind", "note");
                e.dataTransfer.setData("id", n.id);
              }}
            >
              <Link href={`/vault/${p.vaultId}/note/${n.id}`}>{n.title}</Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
```

- [ ] **Step 2: Implement FileTree**

Create `apps/web/components/FileTree.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { FileTreeItem, TreeNode } from "./FileTreeItem";

export function FileTree({ vaultId }: { vaultId: string }) {
  const [root, setRoot] = useState<TreeNode | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/vaults/${vaultId}/tree`);
    const data = await res.json();
    setRoot(data.root);
  }, [vaultId]);

  useEffect(() => { reload(); }, [reload]);

  async function createFolder(parentId: string) {
    const name = window.prompt("Folder name?");
    if (!name) return;
    await fetch("/api/folders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vaultId, parentId, name }),
    });
    await reload();
  }

  async function createNote(folderId: string) {
    const title = window.prompt("Note title?");
    if (!title) return;
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vaultId, folderId, title }),
    });
    const data = await res.json();
    await reload();
    if (data.note) window.location.href = `/vault/${vaultId}/note/${data.note.id}`;
  }

  async function renameFolder(id: string, current: string) {
    const name = window.prompt("Rename folder", current);
    if (!name || name === current) return;
    await fetch(`/api/folders/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    await reload();
  }

  async function deleteFolder(id: string) {
    if (!window.confirm("Delete this folder and all contents?")) return;
    await fetch(`/api/folders/${id}`, { method: "DELETE" });
    await reload();
  }

  async function dropInto(targetFolderId: string, kind: "folder" | "note", id: string) {
    if (kind === "folder") {
      await fetch(`/api/folders/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parentId: targetFolderId }),
      });
    } else {
      await fetch(`/api/notes/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folderId: targetFolderId }),
      });
    }
    await reload();
  }

  if (!root) return <div>Loading tree...</div>;
  return (
    <ul>
      <FileTreeItem
        vaultId={vaultId}
        node={root}
        onCreateFolder={createFolder}
        onCreateNote={createNote}
        onRenameFolder={renameFolder}
        onDeleteFolder={deleteFolder}
        onDropInto={dropInto}
      />
    </ul>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/FileTree.tsx apps/web/components/FileTreeItem.tsx
git commit -m "feat(web): FileTree and FileTreeItem components"
```

---

## Task 27: NoteEditor component with autosave

**Files:**
- Create: `apps/web/components/NoteEditor.tsx`

- [ ] **Step 1: Implement**

Create `apps/web/components/NoteEditor.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  noteId: string;
  initialTitle: string;
  initialContent: string;
}

export function NoteEditor({ noteId, initialTitle, initialContent }: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function save(next: { title?: string; content?: string }) {
    setStatus("saving");
    const res = await fetch(`/api/notes/${noteId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    });
    setStatus(res.ok ? "saved" : "error");
  }

  function scheduleSave(next: { title?: string; content?: string }) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(next), 1500);
  }

  useEffect(() => {
    const handler = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        save({ title, content });
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [title, content]);

  return (
    <div className="flex flex-col h-full p-4 gap-2">
      <input
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          scheduleSave({ title: e.target.value, content });
        }}
        onBlur={() => save({ title, content })}
        className="text-2xl font-semibold border-b pb-1"
      />
      <textarea
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          scheduleSave({ title, content: e.target.value });
        }}
        onBlur={() => save({ title, content })}
        className="flex-1 font-mono border rounded p-2"
      />
      <div className="text-xs text-gray-500">Status: {status}</div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/NoteEditor.tsx
git commit -m "feat(web): NoteEditor textarea with debounced autosave"
```

---

## Task 28: Vault shell + note page

**Files:**
- Create: `apps/web/app/(app)/vault/[vaultId]/page.tsx`
- Create: `apps/web/app/(app)/vault/[vaultId]/note/[noteId]/page.tsx`

- [ ] **Step 1: Implement vault shell**

Create `apps/web/app/(app)/vault/[vaultId]/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getCurrentUserId } from "../../../../lib/session";
import { assertCanAccessVault, AuthzError } from "../../../../lib/authz";
import { VaultSwitcher } from "../../../../components/VaultSwitcher";
import { FileTree } from "../../../../components/FileTree";

export default async function VaultShell({ params }: { params: { vaultId: string } }) {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");
  try {
    await assertCanAccessVault(userId, params.vaultId, "MEMBER");
  } catch (e) {
    if (e instanceof AuthzError) redirect("/workspaces");
    throw e;
  }
  return (
    <div className="grid grid-cols-[260px_1fr] h-screen">
      <aside className="border-r p-3 space-y-3 overflow-auto">
        <VaultSwitcher currentVaultId={params.vaultId} />
        <FileTree vaultId={params.vaultId} />
      </aside>
      <section className="p-6 text-gray-500">Select or create a note.</section>
    </div>
  );
}
```

- [ ] **Step 2: Implement note page**

Create `apps/web/app/(app)/vault/[vaultId]/note/[noteId]/page.tsx`:

```tsx
import { redirect, notFound } from "next/navigation";
import { prisma } from "@km/db";
import { getCurrentUserId } from "../../../../../../lib/session";
import { assertCanAccessVault, AuthzError } from "../../../../../../lib/authz";
import { VaultSwitcher } from "../../../../../../components/VaultSwitcher";
import { FileTree } from "../../../../../../components/FileTree";
import { NoteEditor } from "../../../../../../components/NoteEditor";

export default async function NotePage({
  params,
}: {
  params: { vaultId: string; noteId: string };
}) {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");
  try {
    await assertCanAccessVault(userId, params.vaultId, "MEMBER");
  } catch (e) {
    if (e instanceof AuthzError) redirect("/workspaces");
    throw e;
  }
  const note = await prisma.note.findUnique({ where: { id: params.noteId } });
  if (!note || note.vaultId !== params.vaultId) notFound();

  return (
    <div className="grid grid-cols-[260px_1fr] h-screen">
      <aside className="border-r p-3 space-y-3 overflow-auto">
        <VaultSwitcher currentVaultId={params.vaultId} />
        <FileTree vaultId={params.vaultId} />
      </aside>
      <section className="h-screen">
        <NoteEditor noteId={note.id} initialTitle={note.title} initialContent={note.content} />
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @km/web typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(app)/vault/[vaultId]/page.tsx" "apps/web/app/(app)/vault/[vaultId]/note/[noteId]/page.tsx"
git commit -m "feat(web): vault shell and note editor pages"
```

---

## Task 29: Layout link to workspaces

**Files:**
- Modify: `apps/web/app/layout.tsx`

- [ ] **Step 1: Add nav link**

Open `apps/web/app/layout.tsx`. Inside the existing top-nav/header area add:

```tsx
<a href="/workspaces" className="underline">Workspaces</a>
```

If Plan A did not create a header, add a minimal one above `{children}`:

```tsx
<header className="border-b p-2 flex gap-3 text-sm">
  <a href="/workspaces" className="underline">Workspaces</a>
  <a href="/api/auth/signout" className="underline">Sign out</a>
</header>
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @km/web typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/layout.tsx
git commit -m "feat(web): link to workspaces in layout header"
```

---

## Task 30: E2E workspace-invite-and-share

**Files:**
- Create: `apps/web/e2e/workspace-invite.spec.ts`

- [ ] **Step 1: Write the spec**

Create `apps/web/e2e/workspace-invite.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { prisma } from "@km/db";
import { resetDb } from "../tests/helpers/db";

test.beforeEach(async () => {
  await resetDb();
});

test("owner invites colleague; both see workspace vault", async ({ browser }) => {
  // Alice signs up and creates workspace
  const alice = await browser.newContext();
  const ap = await alice.newPage();
  await ap.goto("/signup");
  await ap.fill('input[name="email"]', "alice@test.local");
  await ap.fill('input[name="password"]', "password123");
  await ap.fill('input[name="name"]', "Alice");
  await ap.click('button[type="submit"]');
  await ap.waitForURL("**/");

  await ap.goto("/workspaces/new");
  await ap.fill('input[name="name"]', "Acme");
  await ap.click('button[type="submit"]');
  await ap.waitForURL(/\/workspaces\/.+\/members/);

  // Invite bob
  await ap.fill('input[name="email"]', "bob@test.local");
  await ap.selectOption('select[name="role"]', "MEMBER");
  await ap.click('button[type="submit"]');

  // Fetch invite token from DB (test shortcut — email is a console log in v1)
  const invite = await prisma.invite.findFirstOrThrow({
    where: { email: "bob@test.local" },
    orderBy: { createdAt: "desc" },
  });
  // We stored only the hash; regenerate a token via a direct DB test helper.
  // Instead, re-issue a known-hash invite in the test so we control the token.
  const { generateInviteToken } = await import("../lib/invite-token");
  const fresh = generateInviteToken();
  await prisma.invite.update({
    where: { id: invite.id },
    data: { tokenHash: fresh.tokenHash, expiresAt: new Date(Date.now() + 60_000) },
  });

  // Bob signs up, accepts invite
  const bob = await browser.newContext();
  const bp = await bob.newPage();
  await bp.goto("/signup");
  await bp.fill('input[name="email"]', "bob@test.local");
  await bp.fill('input[name="password"]', "password123");
  await bp.fill('input[name="name"]', "Bob");
  await bp.click('button[type="submit"]');
  await bp.waitForURL("**/");
  await bp.goto(`/invites/${fresh.token}`);
  await bp.click('button[type="submit"]');
  await bp.waitForURL(/\/workspaces\/.+\/members/);

  // Bob now sees Acme in workspaces list
  await bp.goto("/workspaces");
  await expect(bp.locator("text=Acme")).toBeVisible();

  // Alice sees Bob in members
  await ap.reload();
  await expect(ap.locator("text=bob@test.local")).toBeVisible();
});
```

- [ ] **Step 2: Run E2E**

Run: `pnpm --filter @km/web exec playwright test workspace-invite`
Expected: PASS.

If the `/signup` form field names in Plan A differ from `email`/`password`/`name`, adjust the selectors to match Plan A before rerunning.

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/workspace-invite.spec.ts
git commit -m "test(web): e2e for workspace invite golden path"
```

---

## Task 31: Run full test suite

- [ ] **Step 1: Run all unit + integration tests**

Run: `pnpm --filter @km/web test`
Expected: all tests pass.

- [ ] **Step 2: Run shared tests**

Run: `pnpm --filter @km/shared test`
Expected: all tests pass.

- [ ] **Step 3: Run typecheck across monorepo**

Run: `pnpm -r typecheck`
Expected: no errors.

- [ ] **Step 4: Run E2E**

Run: `pnpm --filter @km/web exec playwright test`
Expected: all specs pass.

- [ ] **Step 5: Final commit if any formatting/lint fixes are outstanding**

```bash
git status
git add -A
git commit -m "chore: finalize Plan B" || echo "nothing to commit"
```
