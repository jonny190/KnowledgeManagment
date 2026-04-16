# v0.2-E AI Write Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the AI chat three write tools (`createNote`, `updateNote`, `createFolder`) that auto-apply with a 10-second undo affordance, with note-content edits routed through a new HMAC-signed internal endpoint on the realtime service so CRDT state stays consistent.

**Architecture:** New tools live in `@km/ai` alongside existing read-only tools and share the same runner. `createNote` and `createFolder` commit directly through Prisma from the web SSE route. `updateNote` POSTs a signed payload to a new `POST /internal/ydoc/apply` endpoint on `apps/realtime`, which mutates the live Y.Doc under the existing per-note mutex and enqueues a snapshot. The runner emits a new `tool_result_undoable` SSE event; the chat panel renders a 10-second undo strip that calls the existing `DELETE /api/notes/:id` or `DELETE /api/folders/:id` route. A new `REALTIME_ADMIN_SECRET` env var is shared between `apps/web` and `apps/realtime`.

**Tech Stack:** pnpm workspaces, Turborepo, TypeScript, Next.js App Router (SSE), Prisma, Postgres, Hocuspocus + Yjs, `node:http`, `node:crypto` HMAC, Vitest, Playwright.

---

## File Structure

**Create:**

- `packages/ai/src/tools/createNote.ts`
- `packages/ai/src/tools/updateNote.ts`
- `packages/ai/src/tools/createFolder.ts`
- `packages/ai/src/tools/__tests__/createNote.test.ts`
- `packages/ai/src/tools/__tests__/updateNote.test.ts`
- `packages/ai/src/tools/__tests__/createFolder.test.ts`
- `packages/ai/src/admin-client.ts`
- `packages/ai/src/__tests__/admin-client.test.ts`
- `apps/realtime/src/admin.ts`
- `apps/realtime/src/admin-http.ts`
- `apps/realtime/test/admin.test.ts`
- `apps/realtime/test/admin.int.test.ts`
- `apps/web/src/components/ai/ChatUndoStrip.tsx`
- `apps/web/src/components/ai/undoUrl.ts`
- `apps/web/src/components/ai/__tests__/undoUrl.test.ts`
- `apps/web/tests/integration/ai-write-tools.test.ts`

**Modify:**

- `packages/shared/src/ai.ts` (add `tool_result_undoable` to `aiSseEvent`)
- `packages/ai/src/types.ts` (extend `AiToolContext` with `adminSecret` + `realtimeUrl`)
- `packages/ai/src/tools.ts` (re-export new tools and the updated `ALL_TOOLS`)
- `packages/ai/src/runner.ts` (emit `tool_result_undoable` when a tool result carries an `undo` field)
- `packages/ai/src/prompts.ts` (add write-tool section to the system prompt)
- `packages/ai/src/providers/stub.ts` (accept an optional `stubToolCallMode` that yields scripted tool-use events so tests can drive write-tool calls)
- `packages/ai/src/index.ts` (re-export new symbols)
- `apps/realtime/src/server.ts` (mount the admin HTTP handler on the same port)
- `apps/web/src/app/api/ai/chat/route.ts` (pass `adminSecret` + `realtimeUrl` into `AiToolContext`)
- `apps/web/src/components/AiChatPanel.tsx` (subscribe to `tool_result_undoable` and render `ChatUndoStrip`)
- `apps/web/src/lib/sse.ts` (already uses the updated zod schema, no code changes expected but keep in scope for verification)
- `apps/web/playwright/ai-chat.spec.ts` (extend with a create-note + undo flow)
- `.env.example`
- `infra/coolify/env.example`
- `infra/docker/docker-compose.prod.yml`
- `docs/architecture.md`
- `docs/api.md`
- `docs/deployment.md`
- `guides/ai-chat.md`

---

### Task 1: Add `tool_result_undoable` to the SSE event grammar

**Files:**
- Modify: `packages/shared/src/ai.ts`
- Test: `packages/shared/src/__tests__/ai.test.ts` (create if missing)

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/__tests__/ai.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { aiSseEvent } from "../ai";

describe("aiSseEvent", () => {
  it("parses tool_result_undoable with a create_note undo token", () => {
    const event = {
      type: "tool_result_undoable",
      callId: "call_1",
      summary: "Created note 'Meeting notes'",
      undo: { kind: "create_note", id: "cknote1" },
    };
    expect(aiSseEvent.parse(event)).toEqual(event);
  });

  it("parses tool_result_undoable with undo null", () => {
    const event = {
      type: "tool_result_undoable",
      callId: "call_2",
      summary: "Updated 'Meeting notes'. Use Ctrl-Z in the editor to revert.",
      undo: null,
    };
    expect(aiSseEvent.parse(event)).toEqual(event);
  });

  it("rejects tool_result_undoable with unknown undo.kind", () => {
    expect(() =>
      aiSseEvent.parse({
        type: "tool_result_undoable",
        callId: "call_3",
        summary: "x",
        undo: { kind: "delete_note", id: "abc" },
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @km/shared test -- ai.test`
Expected: FAIL, "Invalid discriminator value" for `tool_result_undoable`.

- [ ] **Step 3: Implement `tool_result_undoable` in the zod discriminated union**

Edit `packages/shared/src/ai.ts`. Replace the existing `aiSseEvent` declaration with:

```ts
export const aiSseEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready"), conversationId: z.string(), messageId: z.string() }),
  z.object({ type: z.literal("text"), delta: z.string() }),
  z.object({ type: z.literal("tool_use"), id: z.string(), name: z.string(), args: z.unknown() }),
  z.object({
    type: z.literal("tool_result"),
    id: z.string(),
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z.string().optional(),
  }),
  z.object({
    type: z.literal("tool_result_undoable"),
    callId: z.string(),
    summary: z.string(),
    undo: z
      .object({
        kind: z.enum(["create_note", "create_folder"]),
        id: z.string(),
      })
      .nullable(),
  }),
  z.object({
    type: z.literal("usage"),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cachedTokens: z.number().int().nonnegative(),
    model: z.string(),
  }),
  z.object({ type: z.literal("done") }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
]);
export type AiSseEvent = z.infer<typeof aiSseEvent>;
```

- [ ] **Step 4: Re-run tests to verify they pass**

Run: `pnpm --filter @km/shared test -- ai.test`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/ai.ts packages/shared/src/__tests__/ai.test.ts
git commit -m "feat(shared): add tool_result_undoable SSE event type"
```

---

### Task 2: Extend `AiToolContext` with realtime admin wiring

**Files:**
- Modify: `packages/ai/src/types.ts`
- Modify: `packages/ai/src/index.ts`

- [ ] **Step 1: Add `adminSecret` and `realtimeUrl` fields**

Edit `packages/ai/src/types.ts`:

```ts
import type { PrismaClient } from "@km/db";
import type { AiSseEvent } from "@km/shared";

export interface AiToolContext {
  userId: string;
  vaultId: string;
  prisma: PrismaClient;
  /** Base URL of the realtime service, e.g. "http://realtime:3001". */
  realtimeUrl?: string;
  /** HMAC secret shared with the realtime service. */
  adminSecret?: string;
}

export interface AiTool<TArgs = unknown, TResult = unknown> {
  name: string;
  description: string;
  jsonSchema: Record<string, unknown>;
  parse: (raw: unknown) => TArgs;
  execute: (args: TArgs, ctx: AiToolContext) => Promise<TResult>;
}

export interface AiUsageRecord {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  model: string;
}

export interface AiProviderRequest {
  systemPrompt: string;
  cachedNoteContext?: { hash: string; text: string };
  history: Array<{ role: "user" | "assistant" | "tool"; content: unknown }>;
  tools: Array<AiTool>;
  signal: AbortSignal;
}

export interface AiProvider {
  name: string;
  model: string;
  stream(
    req: AiProviderRequest,
    ctx: AiToolContext,
    emit: (event: AiSseEvent) => void,
  ): Promise<AiUsageRecord>;
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @km/ai typecheck`
Expected: PASS (no errors introduced; the fields are optional).

- [ ] **Step 3: Commit**

```bash
git add packages/ai/src/types.ts
git commit -m "feat(ai): add realtimeUrl and adminSecret to AiToolContext"
```

---

### Task 3: Write the HMAC admin client in `@km/ai`

**Files:**
- Create: `packages/ai/src/admin-client.ts`
- Test: `packages/ai/src/__tests__/admin-client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ai/src/__tests__/admin-client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyAdminUpdate, computeAdminSignature } from "../admin-client";

describe("computeAdminSignature", () => {
  it("returns a stable HMAC-SHA256 hex string", () => {
    const sig = computeAdminSignature("secret", '{"hello":"world"}');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(sig).toBe(computeAdminSignature("secret", '{"hello":"world"}'));
  });
  it("is sensitive to the body content", () => {
    const a = computeAdminSignature("secret", '{"a":1}');
    const b = computeAdminSignature("secret", '{"a":2}');
    expect(a).not.toBe(b);
  });
});

describe("applyAdminUpdate", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  it("POSTs signed payload and returns parsed body on 200", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ applied: true, revision: 7 }), { status: 200 }),
    );
    const result = await applyAdminUpdate({
      realtimeUrl: "http://realtime:3001",
      adminSecret: "s3cr3t",
      noteId: "n1",
      op: "append",
      text: "hi",
    });
    expect(result).toEqual({ applied: true, revision: 7 });
    const call = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("http://realtime:3001/internal/ydoc/apply");
    const init = call[1] as RequestInit;
    expect(init.method).toBe("POST");
    const body = init.body as string;
    expect(JSON.parse(body)).toEqual({
      noteId: "n1",
      op: "append",
      text: "hi",
      origin: "ai",
    });
    const headers = init.headers as Record<string, string>;
    expect(headers["X-KM-Admin-Signature"]).toMatch(/^[0-9a-f]{64}$/);
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("throws a typed error on non-200 responses", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response("nope", { status: 401 }),
    );
    await expect(
      applyAdminUpdate({
        realtimeUrl: "http://realtime:3001",
        adminSecret: "wrong",
        noteId: "n1",
        op: "append",
        text: "x",
      }),
    ).rejects.toThrow(/realtime admin 401/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @km/ai test -- admin-client`
Expected: FAIL, "Cannot find module '../admin-client'".

- [ ] **Step 3: Implement the admin client**

Create `packages/ai/src/admin-client.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export interface ApplyAdminUpdateInput {
  realtimeUrl: string;
  adminSecret: string;
  noteId: string;
  op: "append" | "replace";
  text: string;
}

export interface ApplyAdminUpdateResult {
  applied: boolean;
  revision: number;
}

export function computeAdminSignature(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifyAdminSignature(
  secret: string,
  rawBody: string,
  provided: string | null | undefined,
): boolean {
  if (!provided) return false;
  const expected = computeAdminSignature(secret, rawBody);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
}

export async function applyAdminUpdate(
  input: ApplyAdminUpdateInput,
): Promise<ApplyAdminUpdateResult> {
  const body = JSON.stringify({
    noteId: input.noteId,
    op: input.op,
    text: input.text,
    origin: "ai",
  });
  const signature = computeAdminSignature(input.adminSecret, body);
  const res = await fetch(`${input.realtimeUrl}/internal/ydoc/apply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-KM-Admin-Signature": signature,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`realtime admin ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as ApplyAdminUpdateResult;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @km/ai test -- admin-client`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/admin-client.ts packages/ai/src/__tests__/admin-client.test.ts
git commit -m "feat(ai): add HMAC-signed admin client for realtime Y.Doc writes"
```

---

### Task 4: Implement the `createNote` tool

**Files:**
- Create: `packages/ai/src/tools/createNote.ts`
- Test: `packages/ai/src/tools/__tests__/createNote.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ai/src/tools/__tests__/createNote.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createNote } from "../createNote";

function prismaMock() {
  const noteFindFirst = vi.fn().mockResolvedValue(null);
  const noteCreate = vi.fn(async ({ data }: { data: { vaultId: string; title: string; slug: string; content: string } }) => ({
    id: "note_123",
    ...data,
  }));
  const linkDeleteMany = vi.fn(async () => ({ count: 0 }));
  const linkCreateMany = vi.fn(async () => ({ count: 0 }));
  const noteTagDeleteMany = vi.fn(async () => ({ count: 0 }));
  const tagUpsert = vi.fn(async () => ({ id: "tag_1" }));
  const tagFindMany = vi.fn(async () => []);
  const noteTagCreateMany = vi.fn(async () => ({ count: 0 }));
  const diagramFindMany = vi.fn(async () => []);
  const noteFindMany = vi.fn(async () => []);
  const tx = {
    note: { findFirst: noteFindFirst, create: noteCreate, findMany: noteFindMany },
    link: { deleteMany: linkDeleteMany, createMany: linkCreateMany },
    noteTag: { deleteMany: noteTagDeleteMany, createMany: noteTagCreateMany },
    tag: { upsert: tagUpsert, findMany: tagFindMany },
    diagram: { findMany: diagramFindMany },
  };
  const $transaction = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx));
  return {
    prisma: {
      note: { findFirst: noteFindFirst },
      $transaction,
    },
    tx,
    noteCreate,
  };
}

describe("createNote tool", () => {
  it("rejects titles outside 1..200 chars", () => {
    expect(() => createNote.parse({ vaultId: "clvault", title: "" })).toThrow();
    expect(() => createNote.parse({ vaultId: "clvault", title: "x".repeat(201) })).toThrow();
  });

  it("generates a slug, creates the note, and returns an undo token", async () => {
    const mock = prismaMock();
    const ctx = {
      userId: "u1",
      vaultId: "clvault0000000000000000000",
      prisma: mock.prisma as unknown as import("@km/db").PrismaClient,
    };
    const args = createNote.parse({
      vaultId: "clvault0000000000000000000",
      title: "Meeting Notes",
      content: "hello [[Other]]",
    });
    const result = await createNote.execute(args, ctx);
    expect(result).toMatchObject({
      noteId: "note_123",
      title: "Meeting Notes",
      slug: "meeting-notes",
      undo: { kind: "create_note", id: "note_123" },
    });
    expect(mock.noteCreate).toHaveBeenCalled();
  });

  it("suffixes the slug when it already exists", async () => {
    const mock = prismaMock();
    mock.prisma.note.findFirst
      .mockResolvedValueOnce({ id: "x" })
      .mockResolvedValueOnce(null);
    const ctx = {
      userId: "u1",
      vaultId: "clvault0000000000000000000",
      prisma: mock.prisma as unknown as import("@km/db").PrismaClient,
    };
    const args = createNote.parse({
      vaultId: "clvault0000000000000000000",
      title: "Meeting Notes",
    });
    const result = await createNote.execute(args, ctx);
    expect(result).toMatchObject({ slug: "meeting-notes-2" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @km/ai test -- createNote`
Expected: FAIL, "Cannot find module '../createNote'".

- [ ] **Step 3: Implement `createNote`**

Create `packages/ai/src/tools/createNote.ts`:

```ts
import { z } from "zod";
import { slugify } from "@km/shared";
import type { AiTool } from "../types";

// Dynamic import of recomputeLinksAndTags: the helper lives in apps/web to stay
// close to the human PATCH pipeline. @km/ai must not statically depend on the
// web app, so we accept an injected recompute function from the caller via a
// module-level hook that the web route installs at boot.
type RecomputeFn = (
  tx: unknown,
  noteId: string,
  vaultId: string,
  markdown: string,
) => Promise<void>;
let recomputeHook: RecomputeFn | null = null;
export function setRecomputeHook(fn: RecomputeFn): void {
  recomputeHook = fn;
}
export function __resetRecomputeHookForTests(): void {
  recomputeHook = null;
}

const createNoteArgs = z.object({
  vaultId: z.string().cuid(),
  title: z.string().min(1).max(200),
  content: z.string().max(100_000).optional(),
  folderId: z.string().cuid().optional(),
});

export interface CreateNoteResult {
  noteId: string;
  title: string;
  slug: string;
  undo: { kind: "create_note"; id: string };
}

export const createNote: AiTool<z.infer<typeof createNoteArgs>, CreateNoteResult> = {
  name: "createNote",
  description:
    "Create a new note in the current vault with the given title and optional initial markdown content. Returns the new note id. Prefer this over asking the user to create a note when they requested one.",
  jsonSchema: {
    type: "object",
    properties: {
      vaultId: { type: "string" },
      title: { type: "string", maxLength: 200 },
      content: { type: "string", maxLength: 100_000 },
      folderId: { type: "string" },
    },
    required: ["vaultId", "title"],
  },
  parse: (raw) => createNoteArgs.parse(raw),
  async execute(args, ctx) {
    if (args.vaultId !== ctx.vaultId) {
      throw new Error("createNote: vaultId does not match conversation vault");
    }
    const baseSlug = slugify(args.title);
    let slug = baseSlug;
    let suffix = 1;
    while (await ctx.prisma.note.findFirst({ where: { vaultId: args.vaultId, slug } })) {
      suffix += 1;
      slug = `${baseSlug}-${suffix}`;
    }
    const content = args.content ?? "";
    const now = new Date();
    const note = await ctx.prisma.$transaction(async (tx) => {
      const created = await tx.note.create({
        data: {
          vaultId: args.vaultId,
          folderId: args.folderId ?? null,
          title: args.title,
          slug,
          content,
          contentUpdatedAt: now,
          createdById: ctx.userId,
          updatedById: ctx.userId,
        },
      });
      if (content.length > 0 && recomputeHook) {
        await recomputeHook(tx, created.id, args.vaultId, content);
      }
      return created;
    });
    return {
      noteId: note.id,
      title: note.title,
      slug: note.slug,
      undo: { kind: "create_note", id: note.id },
    };
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @km/ai test -- createNote`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/tools/createNote.ts packages/ai/src/tools/__tests__/createNote.test.ts
git commit -m "feat(ai): add createNote tool with slug and undo token"
```

---

### Task 5: Implement the `createFolder` tool

**Files:**
- Create: `packages/ai/src/tools/createFolder.ts`
- Test: `packages/ai/src/tools/__tests__/createFolder.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ai/src/tools/__tests__/createFolder.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createFolder } from "../createFolder";

describe("createFolder tool", () => {
  it("rejects names outside 1..120 chars", () => {
    expect(() => createFolder.parse({ vaultId: "clvault", name: "" })).toThrow();
    expect(() => createFolder.parse({ vaultId: "clvault", name: "n".repeat(121) })).toThrow();
  });

  it("creates a folder at vault root when parentId omitted", async () => {
    const folderCreate = vi.fn(async ({ data }: { data: { path: string; name: string; vaultId: string; parentId: string | null } }) => ({
      id: "f1",
      ...data,
    }));
    const prisma = {
      folder: { findUnique: vi.fn(), create: folderCreate },
    };
    const ctx = {
      userId: "u1",
      vaultId: "clvault0000000000000000000",
      prisma: prisma as unknown as import("@km/db").PrismaClient,
    };
    const args = createFolder.parse({
      vaultId: "clvault0000000000000000000",
      name: "Projects",
    });
    const result = await createFolder.execute(args, ctx);
    expect(result).toEqual({
      folderId: "f1",
      path: "Projects",
      undo: { kind: "create_folder", id: "f1" },
    });
    expect(folderCreate).toHaveBeenCalledWith({
      data: {
        vaultId: "clvault0000000000000000000",
        parentId: null,
        name: "Projects",
        path: "Projects",
      },
    });
  });

  it("nests under a parent folder and computes the path", async () => {
    const folderCreate = vi.fn(async ({ data }: { data: { path: string } }) => ({
      id: "f2",
      ...data,
    }));
    const prisma = {
      folder: {
        findUnique: vi.fn().mockResolvedValue({
          vaultId: "clvault0000000000000000000",
          path: "Projects",
        }),
        create: folderCreate,
      },
    };
    const ctx = {
      userId: "u1",
      vaultId: "clvault0000000000000000000",
      prisma: prisma as unknown as import("@km/db").PrismaClient,
    };
    const args = createFolder.parse({
      vaultId: "clvault0000000000000000000",
      name: "Q2",
      parentId: "clparent0000000000000000000",
    });
    const result = await createFolder.execute(args, ctx);
    expect(result.path).toBe("Projects/Q2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @km/ai test -- createFolder`
Expected: FAIL, "Cannot find module '../createFolder'".

- [ ] **Step 3: Implement `createFolder`**

Create `packages/ai/src/tools/createFolder.ts`:

```ts
import { z } from "zod";
import type { AiTool } from "../types";

function computeChildPath(parentPath: string, childName: string): string {
  return parentPath.length === 0 ? childName : `${parentPath}/${childName}`;
}

const createFolderArgs = z.object({
  vaultId: z.string().cuid(),
  name: z.string().min(1).max(120),
  parentId: z.string().cuid().optional(),
});

export interface CreateFolderResult {
  folderId: string;
  path: string;
  undo: { kind: "create_folder"; id: string };
}

export const createFolder: AiTool<z.infer<typeof createFolderArgs>, CreateFolderResult> = {
  name: "createFolder",
  description:
    "Create a new folder in the current vault. If parentId is omitted the folder lives at the vault root.",
  jsonSchema: {
    type: "object",
    properties: {
      vaultId: { type: "string" },
      name: { type: "string", maxLength: 120 },
      parentId: { type: "string" },
    },
    required: ["vaultId", "name"],
  },
  parse: (raw) => createFolderArgs.parse(raw),
  async execute(args, ctx) {
    if (args.vaultId !== ctx.vaultId) {
      throw new Error("createFolder: vaultId does not match conversation vault");
    }
    let parentPath = "";
    if (args.parentId) {
      const parent = await ctx.prisma.folder.findUnique({
        where: { id: args.parentId },
        select: { vaultId: true, path: true },
      });
      if (!parent || parent.vaultId !== args.vaultId) {
        throw new Error("createFolder: parent folder not in this vault");
      }
      parentPath = parent.path;
    }
    const folder = await ctx.prisma.folder.create({
      data: {
        vaultId: args.vaultId,
        parentId: args.parentId ?? null,
        name: args.name,
        path: computeChildPath(parentPath, args.name),
      },
    });
    return {
      folderId: folder.id,
      path: folder.path,
      undo: { kind: "create_folder", id: folder.id },
    };
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @km/ai test -- createFolder`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/tools/createFolder.ts packages/ai/src/tools/__tests__/createFolder.test.ts
git commit -m "feat(ai): add createFolder tool with path denormalisation"
```

---

### Task 6: Implement the `updateNote` tool

**Files:**
- Create: `packages/ai/src/tools/updateNote.ts`
- Test: `packages/ai/src/tools/__tests__/updateNote.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ai/src/tools/__tests__/updateNote.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { updateNote } from "../updateNote";

const realFetch = global.fetch;
beforeEach(() => {
  global.fetch = vi.fn() as unknown as typeof fetch;
});
afterAll(() => {
  global.fetch = realFetch;
});

function prismaWithNote(note: { id: string; vaultId: string } | null) {
  return {
    note: { findUnique: vi.fn().mockResolvedValue(note) },
  };
}

describe("updateNote tool", () => {
  it("rejects invalid mode", () => {
    expect(() =>
      updateNote.parse({ noteId: "cknote1", content: "x", mode: "replace_all" }),
    ).toThrow();
  });

  it("returns a typed error when note not found", async () => {
    const prisma = prismaWithNote(null);
    const ctx = {
      userId: "u1",
      vaultId: "v1",
      prisma: prisma as unknown as import("@km/db").PrismaClient,
      adminSecret: "s",
      realtimeUrl: "http://realtime:3001",
    };
    const args = updateNote.parse({
      noteId: "cknote00000000000000000000",
      content: "x",
      mode: "append",
    });
    const result = await updateNote.execute(args, ctx);
    expect(result).toEqual({ error: "not_found" });
  });

  it("rejects note from a different vault", async () => {
    const prisma = prismaWithNote({ id: "cknote1", vaultId: "otherv" });
    const ctx = {
      userId: "u1",
      vaultId: "v1",
      prisma: prisma as unknown as import("@km/db").PrismaClient,
      adminSecret: "s",
      realtimeUrl: "http://realtime:3001",
    };
    const args = updateNote.parse({
      noteId: "cknote00000000000000000000",
      content: "x",
      mode: "append",
    });
    await expect(updateNote.execute(args, ctx)).rejects.toThrow(/not in this vault/);
  });

  it("POSTs a signed admin update and returns undo null", async () => {
    const prisma = prismaWithNote({ id: "cknote1", vaultId: "v1" });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ applied: true, revision: 1 }), { status: 200 }),
    );
    const ctx = {
      userId: "u1",
      vaultId: "v1",
      prisma: prisma as unknown as import("@km/db").PrismaClient,
      adminSecret: "s3cr3t",
      realtimeUrl: "http://realtime:3001",
    };
    const args = updateNote.parse({
      noteId: "cknote00000000000000000000",
      content: "added\n",
      mode: "append",
    });
    const result = await updateNote.execute(args, ctx);
    expect(result).toEqual({ noteId: "cknote1", undo: null });
    expect(global.fetch).toHaveBeenCalledWith(
      "http://realtime:3001/internal/ydoc/apply",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws when adminSecret or realtimeUrl are absent", async () => {
    const prisma = prismaWithNote({ id: "cknote1", vaultId: "v1" });
    const ctx = {
      userId: "u1",
      vaultId: "v1",
      prisma: prisma as unknown as import("@km/db").PrismaClient,
    };
    const args = updateNote.parse({
      noteId: "cknote00000000000000000000",
      content: "x",
      mode: "append",
    });
    await expect(updateNote.execute(args, ctx)).rejects.toThrow(/admin.*not configured/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @km/ai test -- updateNote`
Expected: FAIL, "Cannot find module '../updateNote'".

- [ ] **Step 3: Implement `updateNote`**

Create `packages/ai/src/tools/updateNote.ts`:

```ts
import { z } from "zod";
import type { AiTool } from "../types";
import { applyAdminUpdate } from "../admin-client";

const updateNoteArgs = z.object({
  noteId: z.string().cuid(),
  content: z.string().max(100_000),
  mode: z.enum(["append", "replace"]),
});

export type UpdateNoteResult =
  | { noteId: string; undo: null }
  | { error: "not_found" };

export const updateNote: AiTool<z.infer<typeof updateNoteArgs>, UpdateNoteResult> = {
  name: "updateNote",
  description:
    "Append text to, or fully replace the content of, an existing note in the current vault. Prefer mode 'append' unless the user asked for a rewrite.",
  jsonSchema: {
    type: "object",
    properties: {
      noteId: { type: "string" },
      content: { type: "string", maxLength: 100_000 },
      mode: { type: "string", enum: ["append", "replace"] },
    },
    required: ["noteId", "content", "mode"],
  },
  parse: (raw) => updateNoteArgs.parse(raw),
  async execute(args, ctx) {
    if (!ctx.adminSecret || !ctx.realtimeUrl) {
      throw new Error("updateNote: realtime admin is not configured");
    }
    const note = await ctx.prisma.note.findUnique({
      where: { id: args.noteId },
      select: { id: true, vaultId: true },
    });
    if (!note) return { error: "not_found" };
    if (note.vaultId !== ctx.vaultId) {
      throw new Error("updateNote: note is not in this vault");
    }
    await applyAdminUpdate({
      realtimeUrl: ctx.realtimeUrl,
      adminSecret: ctx.adminSecret,
      noteId: note.id,
      op: args.mode,
      text: args.content,
    });
    return { noteId: note.id, undo: null };
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @km/ai test -- updateNote`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/tools/updateNote.ts packages/ai/src/tools/__tests__/updateNote.test.ts
git commit -m "feat(ai): add updateNote tool that POSTs to realtime admin endpoint"
```

---

### Task 7: Register write tools in `ALL_TOOLS` and export

**Files:**
- Modify: `packages/ai/src/tools.ts`
- Modify: `packages/ai/src/index.ts`

- [ ] **Step 1: Add re-exports and extend `ALL_TOOLS`**

Append to `packages/ai/src/tools.ts`:

```ts
export { createNote, setRecomputeHook, __resetRecomputeHookForTests } from "./tools/createNote";
export { createFolder } from "./tools/createFolder";
export { updateNote } from "./tools/updateNote";

import { createNote as _createNote } from "./tools/createNote";
import { createFolder as _createFolder } from "./tools/createFolder";
import { updateNote as _updateNote } from "./tools/updateNote";
```

Replace the existing final line:

```ts
export const ALL_TOOLS = [readNote, searchNotes, listBacklinks];
```

with:

```ts
export const ALL_TOOLS = [
  readNote,
  searchNotes,
  listBacklinks,
  _createNote,
  _updateNote,
  _createFolder,
];
```

- [ ] **Step 2: Extend the package barrel**

Edit `packages/ai/src/index.ts` to add:

```ts
export {
  createNote,
  updateNote,
  createFolder,
  setRecomputeHook,
} from "./tools";
export {
  applyAdminUpdate,
  computeAdminSignature,
  verifyAdminSignature,
} from "./admin-client";
```

- [ ] **Step 3: Run the full package test to confirm nothing broke**

Run: `pnpm --filter @km/ai test`
Expected: PASS (all existing tests + new tests from Tasks 3-6).

- [ ] **Step 4: Commit**

```bash
git add packages/ai/src/tools.ts packages/ai/src/index.ts
git commit -m "feat(ai): register write tools in ALL_TOOLS and expose helpers"
```

---

### Task 8: Emit `tool_result_undoable` from the runner

**Files:**
- Modify: `packages/ai/src/runner.ts`
- Test: `packages/ai/src/__tests__/runner-undoable.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ai/src/__tests__/runner-undoable.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { runChat } from "../runner";
import { StubProvider } from "../providers/stub";
import type { AiTool, AiToolContext } from "../types";

describe("runChat", () => {
  it("emits tool_result_undoable when a tool returns an undo field", async () => {
    const undoableTool: AiTool = {
      name: "fakeWrite",
      description: "t",
      jsonSchema: { type: "object", properties: {}, required: [] },
      parse: (raw) => z.object({}).parse(raw),
      async execute() {
        return {
          noteId: "n1",
          title: "X",
          undo: { kind: "create_note", id: "n1" },
        };
      },
    };
    const provider = new StubProvider([
      { type: "tool_use", id: "call_a", name: "fakeWrite", args: {} },
    ]);
    const events: unknown[] = [];
    const ctx: AiToolContext = {
      userId: "u",
      vaultId: "v",
      prisma: {} as unknown as import("@km/db").PrismaClient,
    };
    await runChat({
      provider,
      tools: [undoableTool],
      systemPrompt: "",
      history: [],
      ctx,
      maxToolHops: 2,
      signal: new AbortController().signal,
      emit: (ev) => events.push(ev),
    });
    const undoable = events.find(
      (e) => (e as { type?: string }).type === "tool_result_undoable",
    );
    expect(undoable).toMatchObject({
      type: "tool_result_undoable",
      callId: "call_a",
      undo: { kind: "create_note", id: "n1" },
    });
    expect((undoable as { summary: string }).summary).toMatch(/X|fakeWrite/);
  });

  it("emits tool_result_undoable with null undo when result carries undo:null", async () => {
    const tool: AiTool = {
      name: "editNote",
      description: "t",
      jsonSchema: { type: "object", properties: {}, required: [] },
      parse: (raw) => z.object({}).parse(raw),
      async execute() {
        return { noteId: "n2", undo: null };
      },
    };
    const provider = new StubProvider([
      { type: "tool_use", id: "call_b", name: "editNote", args: {} },
    ]);
    const events: unknown[] = [];
    await runChat({
      provider,
      tools: [tool],
      systemPrompt: "",
      history: [],
      ctx: { userId: "u", vaultId: "v", prisma: {} as unknown as import("@km/db").PrismaClient },
      maxToolHops: 2,
      signal: new AbortController().signal,
      emit: (ev) => events.push(ev),
    });
    const undoable = events.find(
      (e) => (e as { type?: string }).type === "tool_result_undoable",
    ) as { undo: unknown; summary: string } | undefined;
    expect(undoable?.undo).toBeNull();
    expect(undoable?.summary).toMatch(/Ctrl-Z/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @km/ai test -- runner-undoable`
Expected: FAIL, `undoable` is `undefined`.

- [ ] **Step 3: Implement `tool_result_undoable` emission**

Edit `packages/ai/src/runner.ts`. Inside the `for (const call of pendingToolCalls)` loop, immediately after `opts.emit({ type: "tool_result", id: call.id, ok: true, result });` (in the success branch), add:

```ts
const maybeUndo = (result as { undo?: unknown } | null | undefined)?.undo;
if (maybeUndo !== undefined) {
  const undoTyped = maybeUndo as
    | { kind: "create_note" | "create_folder"; id: string }
    | null;
  const summary = buildUndoSummary(call.name, result, undoTyped);
  opts.emit({
    type: "tool_result_undoable",
    callId: call.id,
    undo: undoTyped,
    summary,
  });
}
```

Add this helper below the `runChat` function in the same file:

```ts
function buildUndoSummary(
  toolName: string,
  result: unknown,
  undo: { kind: "create_note" | "create_folder"; id: string } | null,
): string {
  const r = (result ?? {}) as { title?: string; path?: string };
  if (undo === null) {
    const title = r.title ?? "note";
    return `Updated '${title}'. Use Ctrl-Z in the editor to revert.`;
  }
  if (undo.kind === "create_note") {
    return `Created note '${r.title ?? toolName}'`;
  }
  return `Created folder '${r.path ?? toolName}'`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @km/ai test -- runner-undoable`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/runner.ts packages/ai/src/__tests__/runner-undoable.test.ts
git commit -m "feat(ai): emit tool_result_undoable SSE events from runner"
```

---

### Task 9: Update the system prompt for write tools

**Files:**
- Modify: `packages/ai/src/prompts.ts`

- [ ] **Step 1: Rewrite the prompt**

Replace `packages/ai/src/prompts.ts` contents with:

```ts
export const SYSTEM_PROMPT = `You are an assistant embedded in a knowledge management web app.

You help the signed-in user think and write inside a single vault. You can read other notes in the same vault using the provided tools, but you must never refer to notes outside that vault.

You also have write tools:
- createNote: create a new note when the user asks for one.
- createFolder: create a new folder when the user asks you to organise.
- updateNote: add to or rewrite an existing note. Prefer mode 'append' unless the user explicitly asked you to rewrite the whole note.

To reference another note in markdown use the wiki-link syntax [[Note Title]]; the app resolves these automatically.

When the user asks for an edit to the active note, prefer updateNote with mode 'append' for additions, and mode 'replace' only if they asked for a full rewrite. Otherwise you may return the proposed text in your reply so the user can review and apply it themselves.

Format your replies as Markdown. Use fenced code blocks for code, and keep responses focused and concise.`;
```

- [ ] **Step 2: Run the AI package tests to confirm nothing depends on the old text**

Run: `pnpm --filter @km/ai test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/ai/src/prompts.ts
git commit -m "feat(ai): teach system prompt about write tools and wiki-link syntax"
```

---

### Task 10: Add `stubToolCallMode` to the stub provider

**Files:**
- Modify: `packages/ai/src/providers/stub.ts`
- Test: `packages/ai/src/__tests__/stub-provider.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ai/src/__tests__/stub-provider.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { StubProvider } from "../providers/stub";

describe("StubProvider", () => {
  it("emits the scripted steps in order when given a script", async () => {
    const provider = new StubProvider([
      { type: "text", delta: "hi" },
      { type: "tool_use", id: "call_1", name: "createNote", args: { title: "x" } },
    ]);
    const events: Array<{ type: string }> = [];
    await provider.stream(
      {
        systemPrompt: "",
        history: [],
        tools: [],
        signal: new AbortController().signal,
      },
      { userId: "u", vaultId: "v", prisma: {} as never },
      (ev) => events.push(ev),
    );
    expect(events.map((e) => e.type)).toEqual(["text", "tool_use"]);
  });

  it("stubToolCallMode 'tool-then-finish' emits tool_use once then stops on next hop", async () => {
    const provider = new StubProvider({
      mode: "tool-then-finish",
      toolUse: { id: "call_99", name: "createNote", args: { vaultId: "v", title: "x" } },
    });
    const first: Array<{ type: string }> = [];
    await provider.stream(
      { systemPrompt: "", history: [], tools: [], signal: new AbortController().signal },
      { userId: "u", vaultId: "v", prisma: {} as never },
      (ev) => first.push(ev),
    );
    expect(first.map((e) => e.type)).toEqual(["tool_use"]);

    const second: Array<{ type: string }> = [];
    await provider.stream(
      { systemPrompt: "", history: [{ role: "tool", content: [] }], tools: [], signal: new AbortController().signal },
      { userId: "u", vaultId: "v", prisma: {} as never },
      (ev) => second.push(ev),
    );
    expect(second.map((e) => e.type)).toEqual(["text"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @km/ai test -- stub-provider`
Expected: FAIL on the `tool-then-finish` case.

- [ ] **Step 3: Extend the stub**

Replace `packages/ai/src/providers/stub.ts` with:

```ts
import type { AiProvider, AiProviderRequest, AiToolContext, AiUsageRecord } from "../types";
import type { AiSseEvent } from "@km/shared";

type StubStep =
  | { type: "text"; delta: string }
  | { type: "tool_use"; id: string; name: string; args: unknown };

export interface StubToolCallMode {
  mode: "tool-then-finish";
  toolUse: { id: string; name: string; args: unknown };
  finishText?: string;
}

export class StubProvider implements AiProvider {
  name = "stub";
  model = "stub-model";
  private calls = 0;

  constructor(
    private readonly config:
      | StubStep[]
      | StubToolCallMode = [{ type: "text", delta: "stub response" }],
  ) {}

  async stream(
    _req: AiProviderRequest,
    _ctx: AiToolContext,
    emit: (event: AiSseEvent) => void,
  ): Promise<AiUsageRecord> {
    this.calls += 1;
    if (Array.isArray(this.config)) {
      for (const step of this.config) {
        if (step.type === "text") emit({ type: "text", delta: step.delta });
        else emit({ type: "tool_use", id: step.id, name: step.name, args: step.args });
      }
    } else if (this.config.mode === "tool-then-finish") {
      if (this.calls === 1) {
        const t = this.config.toolUse;
        emit({ type: "tool_use", id: t.id, name: t.name, args: t.args });
      } else {
        emit({ type: "text", delta: this.config.finishText ?? "done" });
      }
    }
    return { inputTokens: 10, outputTokens: 5, cachedTokens: 0, model: this.model };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @km/ai test -- stub-provider`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/providers/stub.ts packages/ai/src/__tests__/stub-provider.test.ts
git commit -m "test(ai): add stubToolCallMode for integration tool-call scripting"
```

---

### Task 11: Add `REALTIME_ADMIN_SECRET` to env files

**Files:**
- Modify: `.env.example`
- Modify: `infra/coolify/env.example`
- Modify: `infra/docker/docker-compose.prod.yml`

- [ ] **Step 1: Append the new env to `.env.example`**

At the end of `.env.example` (or immediately after `REALTIME_JWT_SECRET=`), add:

```
# Shared HMAC secret used to sign internal admin POSTs from apps/web to apps/realtime.
# MUST differ from REALTIME_JWT_SECRET. Generate with `openssl rand -base64 32`.
REALTIME_ADMIN_SECRET=replace-with-openssl-rand-base64-32
# Base URL of the realtime service reachable from apps/web (server-side).
REALTIME_INTERNAL_URL=http://localhost:3001
```

- [ ] **Step 2: Append the same keys to `infra/coolify/env.example`**

```
# Realtime admin HMAC secret (distinct from REALTIME_JWT_SECRET)
REALTIME_ADMIN_SECRET=replace-with-openssl-rand-base64-32
REALTIME_INTERNAL_URL=http://realtime:3001
```

- [ ] **Step 3: Wire the env vars into `docker-compose.prod.yml`**

In `infra/docker/docker-compose.prod.yml`, inside the `web` service `environment:` block, add:

```yaml
      REALTIME_ADMIN_SECRET: ${REALTIME_ADMIN_SECRET}
      REALTIME_INTERNAL_URL: ${REALTIME_INTERNAL_URL}
```

Inside the `realtime` service `environment:` block add:

```yaml
      REALTIME_ADMIN_SECRET: ${REALTIME_ADMIN_SECRET}
```

- [ ] **Step 4: Commit**

```bash
git add .env.example infra/coolify/env.example infra/docker/docker-compose.prod.yml
git commit -m "chore(infra): add REALTIME_ADMIN_SECRET env var"
```

---

### Task 12: Implement realtime `applyAdminUpdate` core

**Files:**
- Create: `apps/realtime/src/admin.ts`
- Test: `apps/realtime/test/admin.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/realtime/test/admin.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Y from "yjs";
import { applyAdminUpdate, __setAdminDocProvider, __resetAdminState } from "../src/admin.js";

vi.mock("../src/snapshot.js", async () => {
  const actual = await vi.importActual<typeof import("../src/snapshot.js")>("../src/snapshot.js");
  return {
    ...actual,
    snapshotNote: vi.fn(async () => undefined),
  };
});

describe("applyAdminUpdate", () => {
  beforeEach(() => {
    __resetAdminState();
  });

  it("appends text to an existing Y.Doc", async () => {
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "start ");
    __setAdminDocProvider(async () => ({ doc, lastEditorUserId: null, persist: async () => {} }));
    const res = await applyAdminUpdate({ noteId: "n1", op: "append", text: "added" });
    expect(res.applied).toBe(true);
    expect(doc.getText("content").toString()).toBe("start added");
  });

  it("replaces the full text when op is 'replace'", async () => {
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "old body");
    __setAdminDocProvider(async () => ({ doc, lastEditorUserId: null, persist: async () => {} }));
    await applyAdminUpdate({ noteId: "n1", op: "replace", text: "brand new" });
    expect(doc.getText("content").toString()).toBe("brand new");
  });

  it("serialises concurrent calls under the per-note mutex", async () => {
    const doc = new Y.Doc();
    const observed: string[] = [];
    __setAdminDocProvider(async () => {
      observed.push(doc.getText("content").toString());
      return { doc, lastEditorUserId: null, persist: async () => {} };
    });
    await Promise.all([
      applyAdminUpdate({ noteId: "n1", op: "append", text: "a" }),
      applyAdminUpdate({ noteId: "n1", op: "append", text: "b" }),
      applyAdminUpdate({ noteId: "n1", op: "append", text: "c" }),
    ]);
    expect(doc.getText("content").toString().length).toBe(3);
    // Each call observed a different snapshot length: 0, 1, 2.
    expect(new Set(observed).size).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @km/realtime test -- admin`
Expected: FAIL, module `../src/admin.js` not found.

- [ ] **Step 3: Implement the admin core**

Create `apps/realtime/src/admin.ts`:

```ts
import { Mutex } from "async-mutex";
import * as Y from "yjs";
import { prisma } from "./prisma.js";
import { snapshotNote } from "./snapshot.js";

export interface AdminDocHandle {
  doc: Y.Doc;
  lastEditorUserId: string | null;
  /** Persist the updated state if the doc is transient (no live Hocuspocus clients). */
  persist: (state: Uint8Array) => Promise<void>;
}

export type AdminDocProvider = (noteId: string) => Promise<AdminDocHandle>;

const mutexes = new Map<string, Mutex>();
let provider: AdminDocProvider = async (noteId: string) => {
  const row = await prisma.noteDoc.findUnique({ where: { noteId } });
  const doc = new Y.Doc();
  if (row) Y.applyUpdate(doc, row.state);
  return {
    doc,
    lastEditorUserId: null,
    persist: async (state: Uint8Array) => {
      await prisma.noteDoc.upsert({
        where: { noteId },
        update: { state, clock: { increment: 1 } },
        create: { noteId, state, clock: 0 },
      });
    },
  };
};

export function setAdminDocProvider(p: AdminDocProvider): void {
  provider = p;
}
export function __setAdminDocProvider(p: AdminDocProvider): void {
  provider = p;
}
export function __resetAdminState(): void {
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

export interface AdminUpdateInput {
  noteId: string;
  op: "append" | "replace";
  text: string;
}

export interface AdminUpdateResult {
  applied: boolean;
  revision: number;
}

let revisionCounter = 0;

export async function applyAdminUpdate(
  input: AdminUpdateInput,
): Promise<AdminUpdateResult> {
  return mutexFor(input.noteId).runExclusive(async () => {
    const handle = await provider(input.noteId);
    const ytext = handle.doc.getText("content");
    if (input.op === "append") {
      ytext.insert(ytext.length, input.text);
    } else {
      ytext.delete(0, ytext.length);
      ytext.insert(0, input.text);
    }
    const state = Y.encodeStateAsUpdate(handle.doc);
    await handle.persist(state);
    // Best effort snapshot of Note.content; errors are logged inside snapshotNote.
    snapshotNote(input.noteId).catch((e) => {
      // eslint-disable-next-line no-console
      console.error(`[admin] snapshot enqueue failed for ${input.noteId}:`, e);
    });
    revisionCounter += 1;
    return { applied: true, revision: revisionCounter };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @km/realtime test -- admin`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/realtime/src/admin.ts apps/realtime/test/admin.test.ts
git commit -m "feat(realtime): add applyAdminUpdate mutating the live Y.Doc"
```

---

### Task 13: Mount the admin HTTP handler on the realtime port

**Files:**
- Create: `apps/realtime/src/admin-http.ts`
- Modify: `apps/realtime/src/server.ts`

- [ ] **Step 1: Write `admin-http.ts`**

Create `apps/realtime/src/admin-http.ts`:

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { applyAdminUpdate } from "./admin.js";

function verifySignature(secret: string, rawBody: string, provided: string | null): boolean {
  if (!provided) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (expected.length !== provided.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
  } catch {
    return false;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function isAdminRequest(url: string | undefined): boolean {
  return !!url && url.startsWith("/internal/ydoc/apply");
}

export async function handleAdminRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }
  const secret = process.env.REALTIME_ADMIN_SECRET;
  if (!secret) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "admin_secret_not_configured" }));
    return;
  }
  const raw = await readBody(req);
  const sig = (req.headers["x-km-admin-signature"] as string | undefined) ?? null;
  if (!verifySignature(secret, raw, sig)) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "bad_signature" }));
    return;
  }
  let parsed: { noteId?: string; op?: "append" | "replace"; text?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "bad_json" }));
    return;
  }
  if (!parsed.noteId || (parsed.op !== "append" && parsed.op !== "replace") || typeof parsed.text !== "string") {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "bad_body" }));
    return;
  }
  try {
    const result = await applyAdminUpdate({
      noteId: parsed.noteId,
      op: parsed.op,
      text: parsed.text,
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[admin-http] apply failed:", err);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "apply_failed" }));
  }
}
```

- [ ] **Step 2: Wire the admin handler into `startServer`**

Edit `apps/realtime/src/server.ts`. Replace the final section beginning with `await hocuspocus.listen();` with:

```ts
  // Wrap Hocuspocus's HTTP server so /internal/* is handled by the admin endpoint
  // and all other requests (WS upgrade + default HTTP) flow through Hocuspocus.
  const httpServer = (hocuspocus as unknown as { httpServer?: import("node:http").Server }).httpServer;
  if (httpServer) {
    const existing = httpServer.listeners("request").slice();
    httpServer.removeAllListeners("request");
    httpServer.on("request", (req, res) => {
      if (isAdminRequest(req.url)) {
        handleAdminRequest(req, res).catch((e) => {
          // eslint-disable-next-line no-console
          console.error("[admin-http] handler error:", e);
          if (!res.headersSent) res.writeHead(500);
          res.end();
        });
        return;
      }
      for (const l of existing) l.call(httpServer, req, res);
    });
  }
  await hocuspocus.listen();
  return hocuspocus;
}
```

Add these imports at the top of the file:

```ts
import { handleAdminRequest, isAdminRequest } from "./admin-http.js";
```

- [ ] **Step 3: Run the realtime package typecheck + tests**

Run: `pnpm --filter @km/realtime typecheck && pnpm --filter @km/realtime test -- admin`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/realtime/src/admin-http.ts apps/realtime/src/server.ts
git commit -m "feat(realtime): mount HMAC-signed /internal/ydoc/apply endpoint"
```

---

### Task 14: Integration test the admin HTTP endpoint end-to-end

**Files:**
- Test: `apps/realtime/test/admin.int.test.ts`

- [ ] **Step 1: Write the integration test**

Create `apps/realtime/test/admin.int.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as Y from "yjs";
import { createHmac } from "node:crypto";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import WebSocket from "ws";
import jwt from "jsonwebtoken";
import { prisma } from "../src/prisma.js";
import { startServer } from "../src/server.js";
import type { Hocuspocus } from "@hocuspocus/server";

const JWT_SECRET = "int-admin-jwt";
const ADMIN_SECRET = "int-admin-secret";
process.env.REALTIME_JWT_SECRET = JWT_SECRET;
process.env.REALTIME_ADMIN_SECRET = ADMIN_SECRET;

const PORT = 3998;
let server: Hocuspocus;

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
  const jti = `jti-${Date.now()}`;
  const exp = Math.floor(Date.now() / 1000) + 120;
  await prisma.realtimeGrant.create({
    data: { jti, userId: user.id, noteId: note.id, expiresAt: new Date(exp * 1000) },
  });
  const token = jwt.sign(
    { jti, sub: user.id, nid: note.id, vid: vault.id, role: "OWNER", exp },
    JWT_SECRET,
    { algorithm: "HS256", noTimestamp: true },
  );
  return { user, note, token };
}

function sign(body: string): string {
  return createHmac("sha256", ADMIN_SECRET).update(body).digest("hex");
}

async function waitFor(fn: () => boolean | Promise<boolean>, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("waitFor timeout");
}

describe("admin /internal/ydoc/apply", () => {
  beforeEach(async () => {
    await prisma.link.deleteMany({});
    await prisma.noteDoc.deleteMany({});
    await prisma.realtimeGrant.deleteMany({});
    await prisma.note.deleteMany({});
    await prisma.folder.deleteMany({});
    await prisma.vault.deleteMany({});
    await prisma.user.deleteMany({});
    server = await startServer(PORT);
  });
  afterEach(async () => {
    await server.destroy();
  });

  it("returns 401 when the signature is missing", async () => {
    const res = await fetch(`http://localhost:${PORT}/internal/ydoc/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ noteId: "x", op: "append", text: "y" }),
    });
    expect(res.status).toBe(401);
  });

  it.skipIf(process.env.CI)(
    "applies a signed append and a connected client sees the text",
    { retry: 2 },
    async () => {
      const { note, token } = await seed();
      const doc = new Y.Doc();
      const wsProvider = new HocuspocusProviderWebsocket({
        url: `ws://localhost:${PORT}`,
        WebSocketPolyfill: WebSocket,
      });
      const provider = new HocuspocusProvider({
        websocketProvider: wsProvider,
        name: note.id,
        token,
        document: doc,
      });
      await waitFor(() => provider.isSynced);

      const body = JSON.stringify({
        noteId: note.id,
        op: "append",
        text: "hello admin",
        origin: "ai",
      });
      const res = await fetch(`http://localhost:${PORT}/internal/ydoc/apply`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-km-admin-signature": sign(body),
        },
        body,
      });
      expect(res.status).toBe(200);

      await waitFor(() => doc.getText("content").toString() === "hello admin");

      provider.disconnect();
      wsProvider.disconnect();
    },
    20_000,
  );
});
```

- [ ] **Step 2: Run the integration tests**

Run: `pnpm --filter @km/realtime test -- admin.int`
Expected: PASS. The 401 case runs everywhere; the converge case is skipped under CI.

- [ ] **Step 3: Commit**

```bash
git add apps/realtime/test/admin.int.test.ts
git commit -m "test(realtime): integration test admin endpoint + WS convergence"
```

---

### Task 15: Wire admin context and recompute hook into the web SSE route

**Files:**
- Modify: `apps/web/src/app/api/ai/chat/route.ts`

- [ ] **Step 1: Install the recompute hook once and pass admin context**

Edit `apps/web/src/app/api/ai/chat/route.ts`. Add imports near the top:

```ts
import { setRecomputeHook } from "@km/ai";
import { recomputeLinksAndTags } from "@/lib/links";
```

Below the `MAX_TOOL_HOPS` constant add:

```ts
let hookInstalled = false;
function ensureRecomputeHook() {
  if (hookInstalled) return;
  setRecomputeHook(async (tx, noteId, vaultId, markdown) => {
    await recomputeLinksAndTags(
      tx as Parameters<typeof recomputeLinksAndTags>[0],
      noteId,
      vaultId,
      markdown,
    );
  });
  hookInstalled = true;
}
```

Inside the `POST` handler, immediately before `const provider = getProvider();` add:

```ts
  ensureRecomputeHook();
```

Replace the `ctx` field in the `runChat` call with:

```ts
          ctx: {
            userId,
            vaultId: conversation.vaultId,
            prisma,
            realtimeUrl: process.env.REALTIME_INTERNAL_URL ?? "http://localhost:3001",
            adminSecret: process.env.REALTIME_ADMIN_SECRET ?? "",
          },
```

- [ ] **Step 2: Run the existing ai-chat integration test to confirm no regression**

Run: `pnpm --filter @km/web test -- tests/integration/ai-chat.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/ai/chat/route.ts
git commit -m "feat(web): pass realtime admin context into AI tool runner"
```

---

### Task 16: Build the `ChatUndoStrip` component

**Files:**
- Create: `apps/web/src/components/ai/ChatUndoStrip.tsx`
- Create: `apps/web/src/components/ai/undoUrl.ts`
- Test: `apps/web/src/components/ai/__tests__/undoUrl.test.ts`

This project's web app has no React component test setup today (see existing tests under `apps/web/src/lib/__tests__`). To keep this plan within the existing tooling, we extract the URL selection logic to a pure module, unit-test that, and cover the rest of the component via the Playwright e2e in Task 19.

- [ ] **Step 1: Write the failing test for `undoUrl`**

Create `apps/web/src/components/ai/__tests__/undoUrl.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { undoUrl } from "../undoUrl";

describe("undoUrl", () => {
  it("builds the notes delete URL for create_note", () => {
    expect(undoUrl({ kind: "create_note", id: "n1" })).toBe("/api/notes/n1");
  });
  it("builds the folders delete URL for create_folder", () => {
    expect(undoUrl({ kind: "create_folder", id: "f1" })).toBe("/api/folders/f1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @km/web test -- undoUrl`
Expected: FAIL, module `../undoUrl` not found.

- [ ] **Step 3: Implement the pure helper**

Create `apps/web/src/components/ai/undoUrl.ts`:

```ts
export type UndoToken = { kind: "create_note" | "create_folder"; id: string };

export function undoUrl(token: UndoToken): string {
  return token.kind === "create_note"
    ? `/api/notes/${token.id}`
    : `/api/folders/${token.id}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @km/web test -- undoUrl`
Expected: PASS (2 tests).

- [ ] **Step 5: Implement `ChatUndoStrip`**

Create `apps/web/src/components/ai/ChatUndoStrip.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { undoUrl, type UndoToken } from "./undoUrl";

export interface ChatUndoStripProps {
  summary: string;
  undo: UndoToken | null;
}

export function ChatUndoStrip(props: ChatUndoStripProps) {
  const [remaining, setRemaining] = useState(10);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!props.undo || done) return;
    if (remaining <= 0) return;
    const t = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(t);
  }, [remaining, props.undo, done]);

  async function onClick() {
    if (!props.undo) return;
    const res = await fetch(undoUrl(props.undo), { method: "DELETE" });
    if (res.ok) setDone(true);
  }

  const showButton = props.undo !== null && remaining > 0 && !done;

  return (
    <div className={`my-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs ${done ? "opacity-60" : ""}`}>
      <span>{props.summary}</span>
      {showButton ? (
        <button
          type="button"
          onClick={onClick}
          className="ml-2 rounded bg-amber-200 px-2 py-0.5 hover:bg-amber-300"
        >
          Undo ({remaining})
        </button>
      ) : null}
      {done ? <span className="ml-2 italic">undone</span> : null}
    </div>
  );
}
```

- [ ] **Step 6: Typecheck the web package**

Run: `pnpm --filter @km/web typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/ai/ChatUndoStrip.tsx apps/web/src/components/ai/undoUrl.ts apps/web/src/components/ai/__tests__/undoUrl.test.ts
git commit -m "feat(web): add ChatUndoStrip with 10s countdown and DELETE on click"
```

---

### Task 17: Render `ChatUndoStrip` from `AiChatPanel`

**Files:**
- Modify: `apps/web/src/components/AiChatPanel.tsx`

- [ ] **Step 1: Extend the `AiMessageBlock` type and render the new block**

Edit `apps/web/src/components/AiMessageView.tsx`. Extend `AiMessageBlock`:

```ts
export interface AiMessageBlock {
  type: "text" | "tool_use" | "tool_result" | "undoable";
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  result?: unknown;
  ok?: boolean;
  error?: string;
  callId?: string;
  summary?: string;
  undo?: { kind: "create_note" | "create_folder"; id: string } | null;
}
```

Add an import at the top:

```ts
import { ChatUndoStrip } from "./ai/ChatUndoStrip";
```

Inside the `blocks.map` return ladder, before `return null;`, add:

```tsx
        if (b.type === "undoable" && b.summary !== undefined) {
          return (
            <ChatUndoStrip
              key={i}
              summary={b.summary}
              undo={b.undo ?? null}
            />
          );
        }
```

- [ ] **Step 2: Handle the new SSE event in `AiChatPanel`**

Edit `apps/web/src/components/AiChatPanel.tsx`. Extend the `handleEvent` callback. After the `else if (data.type === "tool_result") { ... }` branch, add:

```ts
    } else if (data.type === "tool_result_undoable") {
      streamingBlocksRef.current.push({
        type: "undoable",
        callId: data.callId,
        summary: data.summary,
        undo: data.undo,
      });
      setMessages((prev) => [...prev]);
```

- [ ] **Step 3: Run the web unit tests to confirm nothing broke**

Run: `pnpm --filter @km/web test -- AiChatPanel ChatUndoStrip AiMessageView`
Expected: PASS (any new tests + existing ones).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/AiChatPanel.tsx apps/web/src/components/AiMessageView.tsx
git commit -m "feat(web): render ChatUndoStrip for tool_result_undoable events"
```

---

### Task 18: End-to-end integration test for write tools

**Files:**
- Test: `apps/web/tests/integration/ai-write-tools.test.ts`

- [ ] **Step 1: Write the integration test**

Create `apps/web/tests/integration/ai-write-tools.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@km/db";
import { resetDb, createUser } from "../helpers/db";

vi.mock("@km/ai", async (orig) => {
  const mod = await orig<typeof import("@km/ai")>();
  const { StubProvider } = mod;
  return {
    ...mod,
    getProvider: () =>
      new StubProvider({
        mode: "tool-then-finish",
        toolUse: {
          id: "call_1",
          name: "createNote",
          // Filled in at runtime via global closure below.
          args: (globalThis as unknown as { __NEXT_ARGS: unknown }).__NEXT_ARGS,
        },
      }),
  };
});

vi.mock("../../src/lib/session", () => ({
  requireUserId: vi.fn(),
}));
vi.mock("../../src/lib/authz", () => ({
  assertCanAccessVault: vi.fn(async () => undefined),
}));

import { requireUserId } from "../../src/lib/session";
import { POST } from "../../src/app/api/ai/chat/route";

async function readSse(res: Response): Promise<string[]> {
  const reader = res.body!.getReader();
  const chunks: string[] = [];
  const dec = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(dec.decode(value));
  }
  return chunks.join("").split("\n\n").filter(Boolean);
}

describe("AI write tools via SSE route", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
  });

  it("createNote via tool-use creates DB row and emits tool_result_undoable", async () => {
    const { user, vault } = await createUser();
    const note = await prisma.note.create({
      data: {
        vaultId: vault.id,
        title: "Host",
        slug: "host",
        content: "",
        createdById: user.id,
        updatedById: user.id,
      },
    });
    const conversation = await prisma.aiConversation.create({
      data: { vaultId: vault.id, noteId: note.id, createdById: user.id },
    });
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    (globalThis as unknown as { __NEXT_ARGS: unknown }).__NEXT_ARGS = {
      vaultId: vault.id,
      title: "From Chat",
    };

    const res = await POST(
      new Request("http://test/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({ conversationId: conversation.id, message: "make a note" }),
      }),
    );
    const events = await readSse(res);
    expect(events.some((e) => e.includes("event: tool_result_undoable"))).toBe(true);
    expect(events.some((e) => e.includes('"kind":"create_note"'))).toBe(true);

    const created = await prisma.note.findFirst({
      where: { vaultId: vault.id, title: "From Chat" },
    });
    expect(created).not.toBeNull();
    expect(created!.slug).toBe("from-chat");
  });
});
```

- [ ] **Step 2: Run the integration test**

Run: `pnpm --filter @km/web test -- tests/integration/ai-write-tools.test.ts`
Expected: PASS (1 test). Note: this suite mocks `assertCanAccessVault` and `requireUserId` the same way the existing `ai-chat.test.ts` does, so Prisma access is exercised but auth is bypassed under test.

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/integration/ai-write-tools.test.ts
git commit -m "test(web): integration test createNote write tool + SSE events"
```

---

### Task 19: Extend Playwright ai-chat spec with create + undo

**Files:**
- Modify: `apps/web/playwright/ai-chat.spec.ts`

- [ ] **Step 1: Append a new Playwright test**

At the end of `apps/web/playwright/ai-chat.spec.ts` append:

```ts
test("AI chat createNote shows Undo strip and Undo removes the note", async ({ page }) => {
  test.setTimeout(120000);
  const EMAIL = `aiw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.io`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL("/", { timeout: 15000 });
  await page.waitForLoadState("networkidle");

  await page.goto("/workspaces/new");
  await page.locator("input[name='name']").fill("AiWrite");
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/members/);

  const { vaults } = await (await page.request.get("/api/vaults")).json();
  const vaultId = vaults[0].id;
  const { root } = await (await page.request.get(`/api/vaults/${vaultId}/tree`)).json();
  const { note } = await (
    await page.request.post("/api/notes", {
      data: { vaultId, folderId: root.id, title: "Host" },
    })
  ).json();
  await page.goto(`/vault/${vaultId}/note/${note.id}`);
  await page.waitForSelector(".cm-content", { timeout: 15000 });

  // The CI test harness is expected to run with AI_PROVIDER=stub; we drive a
  // tool-call-producing message via the server test-hook header so the stub
  // provider scripts a createNote tool_use.
  await page.getByRole("button", { name: /open ai chat/i }).click();
  const panel = page.locator("aside").filter({ hasText: "AI chat" });
  await expect(panel).toBeVisible({ timeout: 5000 });
  await panel.locator("textarea").fill(
    "__TEST__createNote:" + JSON.stringify({ vaultId, title: "From Chat" }),
  );
  await panel.getByRole("button", { name: /send/i }).click();

  // Undo strip should appear with a button and countdown.
  await expect(panel.getByText(/Created note 'From Chat'/)).toBeVisible({ timeout: 15000 });
  const undoBtn = panel.getByRole("button", { name: /undo \(/i });
  await expect(undoBtn).toBeVisible();

  // Confirm the note appeared in the tree.
  const treeList = page.locator("nav").filter({ hasText: "From Chat" });
  await expect(treeList).toBeVisible({ timeout: 10000 });

  // Click Undo and confirm the note disappears.
  await undoBtn.click();
  await expect(panel.getByText(/undone/i)).toBeVisible({ timeout: 5000 });
  await page.reload();
  await expect(page.locator("text=From Chat")).toHaveCount(0);
});
```

- [ ] **Step 2: Teach the stub provider to recognise the `__TEST__createNote:` prefix**

This step requires the chat route to map a `__TEST__` message to a scripted tool_use. Edit `apps/web/src/app/api/ai/chat/route.ts` right above `const provider = getProvider();`:

```ts
  let providerOverride: ReturnType<typeof getProvider> | null = null;
  if (process.env.AI_PROVIDER === "stub" && parsed.message.startsWith("__TEST__createNote:")) {
    const args = JSON.parse(parsed.message.slice("__TEST__createNote:".length));
    const { StubProvider } = await import("@km/ai");
    providerOverride = new StubProvider({
      mode: "tool-then-finish",
      toolUse: { id: "call_test", name: "createNote", args },
      finishText: "done",
    });
  }
```

Then change `const provider = getProvider();` to:

```ts
  const provider = providerOverride ?? getProvider();
```

- [ ] **Step 3: Run Playwright locally (requires AI_PROVIDER=stub)**

Run: `AI_PROVIDER=stub pnpm --filter @km/web test:e2e -- ai-chat`
Expected: PASS both Playwright tests.

- [ ] **Step 4: Commit**

```bash
git add apps/web/playwright/ai-chat.spec.ts apps/web/src/app/api/ai/chat/route.ts
git commit -m "test(web): Playwright createNote + Undo flow using stub tool-call"
```

---

### Task 20: Document the feature

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/api.md`
- Modify: `docs/deployment.md`
- Modify: `guides/ai-chat.md`

- [ ] **Step 1: Append an "AI write tools" subsection to `docs/architecture.md`**

Under the existing AI section, add:

```markdown
### AI write tools

The AI runner exposes three write tools in addition to the read-only set. `createNote` and `createFolder` commit directly through Prisma from inside the `/api/ai/chat` SSE route using the same `assertCanAccessVault` path as human actions. `updateNote` does not touch Prisma directly; instead it POSTs a signed payload to `POST /internal/ydoc/apply` on `apps/realtime`, which mutates the live Y.Doc under the per-note mutex and enqueues a snapshot. The HMAC is keyed by `REALTIME_ADMIN_SECRET`, which is distinct from the JWT secret used for client WS auth.

After any write tool returns, the runner emits a `tool_result_undoable` SSE event carrying a summary and an undo token. The chat panel renders a 10-second Undo strip. Click calls `DELETE /api/notes/:id` or `DELETE /api/folders/:id`. For `updateNote`, the undo token is null and the user is pointed at the editor's Y.UndoManager (Ctrl-Z).
```

- [ ] **Step 2: Document the admin endpoint in `docs/api.md`**

Append:

```markdown
## Internal endpoints

### POST /internal/ydoc/apply (apps/realtime)

This endpoint is internal and is never routed publicly. Cloudflare must only
forward `/yjs` to the realtime container.

Headers:

- `Content-Type: application/json`
- `X-KM-Admin-Signature: HMAC-SHA256(REALTIME_ADMIN_SECRET, rawBody)` as hex.

Body:

```json
{ "noteId": "...", "op": "append" | "replace", "text": "...", "origin": "ai" }
```

Responses:

- 200 `{ "applied": true, "revision": <int> }`
- 400 bad body
- 401 signature missing or mismatch
- 405 method not POST

The mutation runs under the per-note mutex that also guards snapshots, so
concurrent admin POSTs for the same note serialise deterministically.
```

- [ ] **Step 3: Add the env var to `docs/deployment.md`**

Add a new row to the env table (or append a section if no table exists):

```markdown
| Var | Where | Purpose |
| --- | --- | --- |
| `REALTIME_ADMIN_SECRET` | web + realtime | HMAC secret for internal Y.Doc admin writes. Must differ from `REALTIME_JWT_SECRET`. |
| `REALTIME_INTERNAL_URL` | web | Base URL for the realtime container reachable server-side, e.g. `http://realtime:3001`. |
```

- [ ] **Step 4: Update the user guide `guides/ai-chat.md`**

Append:

```markdown
## Creating notes and folders from chat

The AI can now create notes and folders for you. Ask it to "make a note called Meeting notes" or "create a folder called Projects" and it will do so directly. Each new note or folder shows an Undo link in the chat for 10 seconds; click it to roll back.

When the AI edits an existing note, the change appears in your editor immediately. Use Ctrl-Z (or Cmd-Z on macOS) to undo an AI edit just like any other edit.

Wiki links the AI produces, such as [[Meeting notes]], resolve automatically as soon as the referenced note exists.
```

- [ ] **Step 5: Commit**

```bash
git add docs/architecture.md docs/api.md docs/deployment.md guides/ai-chat.md
git commit -m "docs: describe AI write tools and the realtime admin endpoint"
```

---

### Task 21: Full test-suite green + typecheck

**Files:** none (verification task)

- [ ] **Step 1: Run package typechecks**

Run: `pnpm -r typecheck`
Expected: PASS across all packages.

- [ ] **Step 2: Run the full vitest suite**

Run: `pnpm -r test`
Expected: PASS. Integration tests that require Postgres must find `DATABASE_URL` set; set `AI_PROVIDER=stub` to avoid live API calls.

- [ ] **Step 3: Run Playwright e2e with stub**

Run: `AI_PROVIDER=stub REALTIME_ADMIN_SECRET=local-admin REALTIME_INTERNAL_URL=http://localhost:3001 pnpm --filter @km/web test:e2e`
Expected: PASS, including the new ai-chat create-and-undo test.

- [ ] **Step 4: If everything is green, commit a final marker**

```bash
git commit --allow-empty -m "chore: v0.2-E AI write tools verified end-to-end"
```
