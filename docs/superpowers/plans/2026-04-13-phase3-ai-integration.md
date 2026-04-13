# Phase 3 AI Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-mediated Claude chat panel and editor slash commands to the note view, with vault-scoped read tools, SSE streaming, prompt caching, and a per-user daily token budget.

**Architecture:** A new `packages/ai` package wraps the Anthropic SDK behind an `AiProvider` interface. Two Next.js route handlers (`/api/ai/chat`, `/api/ai/command`) authenticate, enforce a Postgres-backed daily budget, build messages with cached system + note context blocks, run a tool loop over `readNote`, `searchNotes`, `listBacklinks`, and stream tokens back as Server-Sent Events. A new chat panel component on the note page consumes the SSE stream. A new `aiCommands` extension in `@km/editor` opens slash-command autocomplete and forwards captured selections to the chat panel.

**Tech Stack:** `@anthropic-ai/sdk`, Next.js 14 App Router route handlers (Edge-incompatible, Node runtime), Prisma 5, Zod, CodeMirror 6, `react-markdown` + `remark-gfm` + `rehype-highlight`, Vitest (unit + integration with mocked transport), Playwright (E2E with stub provider).

---

## File Structure

New files:

- `packages/ai/package.json` - new workspace package manifest.
- `packages/ai/tsconfig.json`.
- `packages/ai/src/index.ts` - public exports.
- `packages/ai/src/types.ts` - `AiProvider`, `AiStreamEvent`, `AiToolContext`, `AiTool` interfaces.
- `packages/ai/src/prompts.ts` - system prompt, command templates.
- `packages/ai/src/commands.ts` - `buildCommandUserMessage(command, args)`.
- `packages/ai/src/tools.ts` - `readNote`, `searchNotes`, `listBacklinks` definitions.
- `packages/ai/src/budget.ts` - `enforceDailyBudget`, `recordUsage`, `AiBudgetExceededError`.
- `packages/ai/src/runner.ts` - `runChat` driving the tool loop and emitting events.
- `packages/ai/src/providers/anthropic.ts` - `AnthropicProvider` implementation with prompt caching.
- `packages/ai/src/providers/stub.ts` - deterministic stub for tests and Playwright.
- `packages/ai/src/providers/index.ts` - `getProvider()` selector by env.
- `packages/ai/test/commands.test.ts`.
- `packages/ai/test/tools.test.ts`.
- `packages/ai/test/budget.test.ts`.
- `packages/ai/test/runner.test.ts`.
- `packages/db/prisma/migrations/<timestamp>_phase3_ai_integration/migration.sql` - generated migration.
- `packages/shared/src/ai.ts` - zod schemas for SSE event payloads, request bodies, command names.
- `packages/editor/src/aiCommands.ts` - CodeMirror extension for slash commands.
- `packages/editor/src/aiCommands.test.ts`.
- `apps/web/src/lib/sse.ts` - browser SSE client over `fetch`.
- `apps/web/src/lib/sse.test.ts`.
- `apps/web/src/app/api/ai/chat/route.ts` - chat SSE handler.
- `apps/web/src/app/api/ai/command/route.ts` - inline command SSE handler.
- `apps/web/src/app/api/ai/conversations/route.ts` - GET or create conversation per (vault, note, user).
- `apps/web/src/components/AiChatPanel.tsx` - the chat panel UI.
- `apps/web/src/components/AiMessageView.tsx` - markdown + tool-call rendering.
- `apps/web/src/components/AiToolCallCard.tsx` - expandable tool call display.
- `apps/web/test/api/ai-chat.test.ts`.
- `apps/web/test/api/ai-command.test.ts`.
- `apps/web/playwright/ai-chat.spec.ts`.
- `guides/ai-chat.md`.
- `guides/ai-inline-commands.md`.

Modified files:

- `packages/db/prisma/schema.prisma` - add `AiConversation`, `AiMessage`, `AiUsage`, `AiRole`, back-relations on `Vault`, `Note`, `User`.
- `packages/shared/src/index.ts` - re-export ai schemas.
- `packages/editor/src/index.ts` - re-export `aiCommands`.
- `packages/editor/package.json` - no new deps (CodeMirror only).
- `apps/web/package.json` - add `@km/ai`, `@anthropic-ai/sdk`, `react-markdown`, `remark-gfm`, `rehype-highlight`.
- `apps/web/src/app/(app)/vault/[vaultId]/note/[noteId]/page.tsx` - mount `AiChatPanel`, wire `aiCommands` extension.
- `env.example` - add `ANTHROPIC_API_KEY`, `AI_MODEL`, `AI_DAILY_TOKEN_LIMIT`, `AI_DAILY_REQUEST_LIMIT`, `AI_MAX_TOOL_HOPS`, `AI_PROVIDER`.
- `pnpm-workspace.yaml` - already globs `packages/*`, no edit needed; verify only.
- `infra/coolify/README.md` - add "AI integration" env var section.
- `docs/architecture.md` - add "AI integration" section.
- `docs/data-model.md` - document new tables.
- `docs/deployment.md` - document new env vars.
- `docs/api.md` - document SSE routes and event grammar.
- `.github/workflows/ci.yml` - add `AI_PROVIDER=stub` to test jobs.

---

## Task 1: Prisma schema and migration for AI tables

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_phase3_ai_integration/migration.sql` (generated)

- [ ] **Step 1: Append models to `packages/db/prisma/schema.prisma`**

Add at end of file:

```prisma
enum AiRole {
  USER
  ASSISTANT
  TOOL
  SYSTEM
}

model AiConversation {
  id          String   @id @default(cuid())
  vaultId     String
  noteId      String?
  createdById String
  title       String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  vault     Vault       @relation(fields: [vaultId], references: [id], onDelete: Cascade)
  note      Note?       @relation(fields: [noteId], references: [id], onDelete: SetNull)
  createdBy User        @relation(fields: [createdById], references: [id])
  messages  AiMessage[]

  @@index([vaultId])
  @@index([noteId])
  @@index([createdById])
}

model AiMessage {
  id             String   @id @default(cuid())
  conversationId String
  role           AiRole
  content        Json
  toolCalls      Json?
  inputTokens    Int      @default(0)
  outputTokens   Int      @default(0)
  cachedTokens   Int      @default(0)
  model          String?
  createdAt      DateTime @default(now())

  conversation AiConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([conversationId, createdAt])
}

model AiUsage {
  id           String   @id @default(cuid())
  userId       String
  vaultId      String
  day          DateTime @db.Date
  inputTokens  Int      @default(0)
  outputTokens Int      @default(0)
  cachedTokens Int      @default(0)
  requests     Int      @default(0)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  user  User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  vault Vault @relation(fields: [vaultId], references: [id], onDelete: Cascade)

  @@unique([userId, day])
  @@index([vaultId, day])
}
```

- [ ] **Step 2: Add back-relations on existing models**

In `model Vault`, add:

```prisma
  aiConversations AiConversation[]
  aiUsage         AiUsage[]
```

In `model Note`, add:

```prisma
  aiConversations AiConversation[]
```

In `model User`, add:

```prisma
  aiConversations AiConversation[]
  aiUsage         AiUsage[]
```

- [ ] **Step 3: Generate the migration**

```
pnpm --filter @km/db exec prisma migrate dev --name phase3_ai_integration --create-only
```

Expected: new folder `packages/db/prisma/migrations/<timestamp>_phase3_ai_integration/` with a `migration.sql` creating three tables and one enum.

- [ ] **Step 4: Apply locally and regenerate client**

```
pnpm --filter @km/db exec prisma migrate deploy
pnpm --filter @km/db generate
```

Expected: "All migrations have been successfully applied." and a regenerated `@prisma/client` with `aiConversation`, `aiMessage`, `aiUsage` models.

- [ ] **Step 5: Commit**

```
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add AiConversation, AiMessage, AiUsage tables for ai integration"
```

---

## Task 2: Shared zod schemas for AI requests and SSE events

**Files:**
- Create: `packages/shared/src/ai.ts`
- Create: `packages/shared/src/ai.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/ai.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { aiChatRequest, aiCommandName, aiCommandRequest, aiSseEvent } from "./ai";

describe("ai schemas", () => {
  it("accepts a chat request", () => {
    const ok = aiChatRequest.parse({
      conversationId: "c1",
      message: "hello",
    });
    expect(ok.message).toBe("hello");
  });

  it("rejects an empty message", () => {
    expect(() => aiChatRequest.parse({ conversationId: "c1", message: "" })).toThrow();
  });

  it("validates command names", () => {
    expect(aiCommandName.parse("summarize")).toBe("summarize");
    expect(() => aiCommandName.parse("delete")).toThrow();
  });

  it("validates a command request with optional language", () => {
    const ok = aiCommandRequest.parse({
      conversationId: "c1",
      command: "translate",
      selection: "hello",
      language: "French",
    });
    expect(ok.language).toBe("French");
  });

  it("validates a text SSE event", () => {
    const ok = aiSseEvent.parse({ type: "text", delta: "hi" });
    expect(ok.type).toBe("text");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
pnpm --filter @km/shared test -- ai.test.ts
```

Expected: FAIL with "Cannot find module './ai'".

- [ ] **Step 3: Create `packages/shared/src/ai.ts`**

```ts
import { z } from "zod";

export const aiCommandName = z.enum(["summarize", "expand", "rewrite", "translate"]);
export type AiCommandName = z.infer<typeof aiCommandName>;

export const aiChatRequest = z.object({
  conversationId: z.string().min(1),
  message: z.string().min(1).max(8000),
});
export type AiChatRequest = z.infer<typeof aiChatRequest>;

export const aiCommandRequest = z.object({
  conversationId: z.string().min(1),
  command: aiCommandName,
  selection: z.string().min(1).max(8000),
  language: z.string().min(1).max(64).optional(),
});
export type AiCommandRequest = z.infer<typeof aiCommandRequest>;

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

- [ ] **Step 4: Re-export from the package index**

Edit `packages/shared/src/index.ts` to add at the end:

```ts
export {
  aiChatRequest,
  aiCommandName,
  aiCommandRequest,
  aiSseEvent,
} from "./ai";
export type {
  AiChatRequest,
  AiCommandName,
  AiCommandRequest,
  AiSseEvent,
} from "./ai";
```

- [ ] **Step 5: Rerun the test**

```
pnpm --filter @km/shared test -- ai.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```
git add packages/shared/src/ai.ts packages/shared/src/ai.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add ai zod schemas for requests and sse events"
```

---

## Task 3: Scaffold @km/ai package

**Files:**
- Create: `packages/ai/package.json`
- Create: `packages/ai/tsconfig.json`
- Create: `packages/ai/src/index.ts`
- Create: `packages/ai/src/types.ts`

- [ ] **Step 1: Create `packages/ai/package.json`**

```json
{
  "name": "@km/ai",
  "version": "0.0.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.30.0",
    "@km/db": "workspace:*",
    "@km/shared": "workspace:*",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `packages/ai/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `packages/ai/src/types.ts`**

```ts
import type { PrismaClient } from "@prisma/client";
import type { AiSseEvent } from "@km/shared";

export interface AiToolContext {
  userId: string;
  vaultId: string;
  prisma: PrismaClient;
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

- [ ] **Step 4: Create `packages/ai/src/index.ts`**

```ts
export type { AiProvider, AiProviderRequest, AiTool, AiToolContext, AiUsageRecord } from "./types";
```

- [ ] **Step 5: Install and verify the workspace picks it up**

```
pnpm install
pnpm --filter @km/ai typecheck
```

Expected: install completes, typecheck passes with zero errors.

- [ ] **Step 6: Commit**

```
git add packages/ai pnpm-lock.yaml
git commit -m "feat(ai): scaffold @km/ai package with provider and tool types"
```

---

## Task 4: System prompt and command templates

**Files:**
- Create: `packages/ai/src/prompts.ts`
- Create: `packages/ai/src/commands.ts`
- Create: `packages/ai/test/commands.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ai/test/commands.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildCommandUserMessage } from "../src/commands";

describe("buildCommandUserMessage", () => {
  it("templates summarize", () => {
    const msg = buildCommandUserMessage("summarize", { selection: "hello world" });
    expect(msg).toContain("Summarise");
    expect(msg).toContain("hello world");
  });

  it("templates expand", () => {
    expect(buildCommandUserMessage("expand", { selection: "x" })).toContain("Expand");
  });

  it("templates rewrite", () => {
    expect(buildCommandUserMessage("rewrite", { selection: "x" })).toContain("Rewrite");
  });

  it("templates translate with a language", () => {
    const msg = buildCommandUserMessage("translate", { selection: "hi", language: "French" });
    expect(msg).toContain("French");
    expect(msg).toContain("hi");
  });

  it("throws if translate is missing a language", () => {
    expect(() => buildCommandUserMessage("translate", { selection: "hi" })).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
pnpm --filter @km/ai test -- commands.test.ts
```

Expected: FAIL with "Cannot find module '../src/commands'".

- [ ] **Step 3: Create `packages/ai/src/prompts.ts`**

```ts
export const SYSTEM_PROMPT = `You are an assistant embedded in a knowledge management web app.

You help the signed-in user think and write inside a single vault. You can read other notes in the same vault using the provided tools, but you must never refer to notes outside that vault.

When the user asks for an edit to the active note, do not call any tool to apply it. Instead, return the proposed text in your reply so the user can review and apply it themselves.

Format your replies as Markdown. Use fenced code blocks for code, and keep responses focused and concise.`;
```

- [ ] **Step 4: Create `packages/ai/src/commands.ts`**

```ts
import type { AiCommandName } from "@km/shared";

export interface CommandArgs {
  selection: string;
  language?: string;
}

export function buildCommandUserMessage(command: AiCommandName, args: CommandArgs): string {
  const block = "```\n" + args.selection + "\n```";
  switch (command) {
    case "summarize":
      return `Summarise the following text in three to five bullet points.\n\n${block}`;
    case "expand":
      return `Expand the following text with additional detail and examples while preserving its meaning.\n\n${block}`;
    case "rewrite":
      return `Rewrite the following text to be clearer and more direct, keeping the original meaning.\n\n${block}`;
    case "translate": {
      if (!args.language) {
        throw new Error("translate requires a language argument");
      }
      return `Translate the following text into ${args.language}. Return only the translation.\n\n${block}`;
    }
  }
}
```

- [ ] **Step 5: Rerun the test**

```
pnpm --filter @km/ai test -- commands.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```
git add packages/ai/src/prompts.ts packages/ai/src/commands.ts packages/ai/test/commands.test.ts
git commit -m "feat(ai): system prompt and slash-command templates"
```

---

## Task 5: Vault-scoped tool implementations

**Files:**
- Create: `packages/ai/src/tools.ts`
- Create: `packages/ai/test/tools.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ai/test/tools.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@km/db";
import { readNote, searchNotes, listBacklinks } from "../src/tools";

async function seed() {
  const user = await prisma.user.create({ data: { email: `u${Date.now()}@t.io` } });
  const vault = await prisma.vault.create({
    data: { ownerType: "USER", ownerId: user.id, name: "V" },
  });
  const otherVault = await prisma.vault.create({
    data: { ownerType: "USER", ownerId: user.id, name: "Other" },
  });
  const target = await prisma.note.create({
    data: {
      vaultId: vault.id,
      title: "Target",
      slug: "target",
      content: "body of target",
      createdById: user.id,
      updatedById: user.id,
    },
  });
  const source = await prisma.note.create({
    data: {
      vaultId: vault.id,
      title: "Source",
      slug: "source",
      content: "see [[Target]]",
      createdById: user.id,
      updatedById: user.id,
    },
  });
  await prisma.link.create({
    data: {
      sourceNoteId: source.id,
      targetNoteId: target.id,
      targetTitle: "Target",
      resolved: true,
    },
  });
  return { user, vault, otherVault, source, target };
}

describe("ai tools", () => {
  beforeEach(async () => {
    await prisma.link.deleteMany({});
    await prisma.note.deleteMany({});
    await prisma.vault.deleteMany({});
    await prisma.user.deleteMany({});
  });

  it("readNote returns the note body inside the vault", async () => {
    const { user, vault } = await seed();
    const result = await readNote.execute(
      readNote.parse({ title: "Target" }),
      { userId: user.id, vaultId: vault.id, prisma },
    );
    expect(result).toMatchObject({ title: "Target", content: "body of target" });
  });

  it("readNote returns not_found for unknown titles", async () => {
    const { user, vault } = await seed();
    const result = await readNote.execute(
      readNote.parse({ title: "Missing" }),
      { userId: user.id, vaultId: vault.id, prisma },
    );
    expect(result).toEqual({ error: "not_found" });
  });

  it("searchNotes returns a vault-scoped prefix match list", async () => {
    const { user, vault } = await seed();
    const result = await searchNotes.execute(
      searchNotes.parse({ query: "tar" }),
      { userId: user.id, vaultId: vault.id, prisma },
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ title: "Target" });
  });

  it("listBacklinks returns sources pointing at the note", async () => {
    const { user, vault, target } = await seed();
    const result = await listBacklinks.execute(
      listBacklinks.parse({ noteId: target.id }),
      { userId: user.id, vaultId: vault.id, prisma },
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ sourceTitle: "Source" });
  });

  it("listBacklinks rejects a noteId in a different vault", async () => {
    const { user, otherVault, target } = await seed();
    await expect(
      listBacklinks.execute(
        listBacklinks.parse({ noteId: target.id }),
        { userId: user.id, vaultId: otherVault.id, prisma },
      ),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
pnpm --filter @km/ai test -- tools.test.ts
```

Expected: FAIL with "Cannot find module '../src/tools'".

- [ ] **Step 3: Create `packages/ai/src/tools.ts`**

```ts
import { z } from "zod";
import { computeSnippet } from "@km/shared";
import type { AiTool } from "./types";

const readNoteArgs = z.object({ title: z.string().min(1).max(256) });

export const readNote: AiTool<z.infer<typeof readNoteArgs>, unknown> = {
  name: "readNote",
  description: "Read the markdown content of a note in the current vault by exact title.",
  jsonSchema: {
    type: "object",
    properties: { title: { type: "string" } },
    required: ["title"],
  },
  parse: (raw) => readNoteArgs.parse(raw),
  async execute(args, ctx) {
    const note = await ctx.prisma.note.findFirst({
      where: { vaultId: ctx.vaultId, title: args.title },
      select: { id: true, title: true, content: true, updatedAt: true },
    });
    if (!note) return { error: "not_found" };
    return note;
  },
};

const searchNotesArgs = z.object({
  query: z.string().min(1).max(128),
  limit: z.number().int().min(1).max(25).optional(),
});

export const searchNotes: AiTool<z.infer<typeof searchNotesArgs>, unknown[]> = {
  name: "searchNotes",
  description: "Search notes in the current vault by case-insensitive title prefix.",
  jsonSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 25 },
    },
    required: ["query"],
  },
  parse: (raw) => searchNotesArgs.parse(raw),
  async execute(args, ctx) {
    const rows = await ctx.prisma.note.findMany({
      where: {
        vaultId: ctx.vaultId,
        title: { startsWith: args.query, mode: "insensitive" },
      },
      orderBy: { title: "asc" },
      take: args.limit ?? 10,
      select: { id: true, title: true, content: true },
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      snippet: computeSnippet(r.content, args.query, 160),
    }));
  },
};

const listBacklinksArgs = z.object({ noteId: z.string().min(1) });

export const listBacklinks: AiTool<z.infer<typeof listBacklinksArgs>, unknown[]> = {
  name: "listBacklinks",
  description: "List notes in the current vault that link to the given note id.",
  jsonSchema: {
    type: "object",
    properties: { noteId: { type: "string" } },
    required: ["noteId"],
  },
  parse: (raw) => listBacklinksArgs.parse(raw),
  async execute(args, ctx) {
    const target = await ctx.prisma.note.findFirst({
      where: { id: args.noteId, vaultId: ctx.vaultId },
      select: { id: true, title: true },
    });
    if (!target) {
      throw new Error("noteId not in current vault");
    }
    const links = await ctx.prisma.link.findMany({
      where: { targetNoteId: target.id },
      include: { sourceNote: { select: { id: true, title: true, content: true } } },
    });
    return links
      .filter((l) => l.sourceNote)
      .map((l) => ({
        sourceNoteId: l.sourceNote!.id,
        sourceTitle: l.sourceNote!.title,
        snippet: computeSnippet(l.sourceNote!.content, target.title, 160),
      }));
  },
};

export const ALL_TOOLS = [readNote, searchNotes, listBacklinks];
```

- [ ] **Step 4: Add re-exports to `packages/ai/src/index.ts`**

```ts
export type { AiProvider, AiProviderRequest, AiTool, AiToolContext, AiUsageRecord } from "./types";
export { readNote, searchNotes, listBacklinks, ALL_TOOLS } from "./tools";
export { SYSTEM_PROMPT } from "./prompts";
export { buildCommandUserMessage } from "./commands";
```

- [ ] **Step 5: Run the test**

```
pnpm --filter @km/ai test -- tools.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```
git add packages/ai/src/tools.ts packages/ai/src/index.ts packages/ai/test/tools.test.ts
git commit -m "feat(ai): vault-scoped readNote, searchNotes, listBacklinks tools"
```

---

## Task 6: Daily token budget helper

**Files:**
- Create: `packages/ai/src/budget.ts`
- Create: `packages/ai/test/budget.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ai/test/budget.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@km/db";
import { AiBudgetExceededError, enforceDailyBudget, recordUsage } from "../src/budget";

async function makeUserAndVault() {
  const user = await prisma.user.create({ data: { email: `u${Date.now()}@t.io` } });
  const vault = await prisma.vault.create({
    data: { ownerType: "USER", ownerId: user.id, name: "V" },
  });
  return { user, vault };
}

describe("budget", () => {
  beforeEach(async () => {
    await prisma.aiUsage.deleteMany({});
    await prisma.vault.deleteMany({});
    await prisma.user.deleteMany({});
  });

  it("allows when no usage row exists", async () => {
    const { user } = await makeUserAndVault();
    await expect(
      enforceDailyBudget(prisma, user.id, { tokenLimit: 1000, requestLimit: 10 }),
    ).resolves.toBeUndefined();
  });

  it("recordUsage upserts and increments", async () => {
    const { user, vault } = await makeUserAndVault();
    await recordUsage(prisma, {
      userId: user.id,
      vaultId: vault.id,
      inputTokens: 10,
      outputTokens: 20,
      cachedTokens: 0,
    });
    await recordUsage(prisma, {
      userId: user.id,
      vaultId: vault.id,
      inputTokens: 5,
      outputTokens: 5,
      cachedTokens: 0,
    });
    const row = await prisma.aiUsage.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.inputTokens).toBe(15);
    expect(row.outputTokens).toBe(25);
    expect(row.requests).toBe(2);
  });

  it("throws AiBudgetExceededError once over the token cap", async () => {
    const { user, vault } = await makeUserAndVault();
    await recordUsage(prisma, {
      userId: user.id,
      vaultId: vault.id,
      inputTokens: 600,
      outputTokens: 500,
      cachedTokens: 0,
    });
    await expect(
      enforceDailyBudget(prisma, user.id, { tokenLimit: 1000, requestLimit: 100 }),
    ).rejects.toBeInstanceOf(AiBudgetExceededError);
  });

  it("throws once over the request cap", async () => {
    const { user, vault } = await makeUserAndVault();
    for (let i = 0; i < 3; i++) {
      await recordUsage(prisma, {
        userId: user.id,
        vaultId: vault.id,
        inputTokens: 1,
        outputTokens: 1,
        cachedTokens: 0,
      });
    }
    await expect(
      enforceDailyBudget(prisma, user.id, { tokenLimit: 100000, requestLimit: 3 }),
    ).rejects.toBeInstanceOf(AiBudgetExceededError);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
pnpm --filter @km/ai test -- budget.test.ts
```

Expected: FAIL with "Cannot find module '../src/budget'".

- [ ] **Step 3: Create `packages/ai/src/budget.ts`**

```ts
import type { PrismaClient } from "@prisma/client";

export class AiBudgetExceededError extends Error {
  constructor(public readonly reason: "tokens" | "requests") {
    super(`AI daily budget exceeded: ${reason}`);
    this.name = "AiBudgetExceededError";
  }
}

export interface BudgetLimits {
  tokenLimit: number;
  requestLimit: number;
}

function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function enforceDailyBudget(
  prisma: PrismaClient,
  userId: string,
  limits: BudgetLimits,
): Promise<void> {
  const row = await prisma.aiUsage.findUnique({
    where: { userId_day: { userId, day: todayUtc() } },
  });
  if (!row) return;
  if (row.requests >= limits.requestLimit) {
    throw new AiBudgetExceededError("requests");
  }
  if (row.inputTokens + row.outputTokens >= limits.tokenLimit) {
    throw new AiBudgetExceededError("tokens");
  }
}

export interface UsageDelta {
  userId: string;
  vaultId: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export async function recordUsage(prisma: PrismaClient, delta: UsageDelta): Promise<void> {
  const day = todayUtc();
  await prisma.aiUsage.upsert({
    where: { userId_day: { userId: delta.userId, day } },
    create: {
      userId: delta.userId,
      vaultId: delta.vaultId,
      day,
      inputTokens: delta.inputTokens,
      outputTokens: delta.outputTokens,
      cachedTokens: delta.cachedTokens,
      requests: 1,
    },
    update: {
      inputTokens: { increment: delta.inputTokens },
      outputTokens: { increment: delta.outputTokens },
      cachedTokens: { increment: delta.cachedTokens },
      requests: { increment: 1 },
    },
  });
}
```

- [ ] **Step 4: Re-export from index**

Append to `packages/ai/src/index.ts`:

```ts
export {
  AiBudgetExceededError,
  enforceDailyBudget,
  recordUsage,
} from "./budget";
export type { BudgetLimits, UsageDelta } from "./budget";
```

- [ ] **Step 5: Run the test**

```
pnpm --filter @km/ai test -- budget.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```
git add packages/ai/src/budget.ts packages/ai/src/index.ts packages/ai/test/budget.test.ts
git commit -m "feat(ai): daily token and request budget helpers"
```

---

## Task 7: Stub provider for tests and CI

**Files:**
- Create: `packages/ai/src/providers/stub.ts`

- [ ] **Step 1: Create `packages/ai/src/providers/stub.ts`**

```ts
import type { AiProvider } from "../types";

export class StubProvider implements AiProvider {
  name = "stub";
  model = "stub-model";

  constructor(
    private readonly script: Array<
      | { type: "text"; delta: string }
      | { type: "tool_use"; id: string; name: string; args: unknown }
    > = [{ type: "text", delta: "stub response" }],
  ) {}

  async stream(_req, _ctx, emit) {
    for (const step of this.script) {
      if (step.type === "text") {
        emit({ type: "text", delta: step.delta });
      } else {
        emit({ type: "tool_use", id: step.id, name: step.name, args: step.args });
      }
    }
    return {
      inputTokens: 10,
      outputTokens: 5,
      cachedTokens: 0,
      model: this.model,
    };
  }
}
```

- [ ] **Step 2: Re-export and verify it compiles**

Append to `packages/ai/src/index.ts`:

```ts
export { StubProvider } from "./providers/stub";
```

Run:

```
pnpm --filter @km/ai typecheck
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```
git add packages/ai/src/providers/stub.ts packages/ai/src/index.ts
git commit -m "feat(ai): add deterministic StubProvider for tests"
```

---

## Task 8: Anthropic provider with prompt caching

**Files:**
- Create: `packages/ai/src/providers/anthropic.ts`
- Create: `packages/ai/src/providers/index.ts`

- [ ] **Step 1: Create `packages/ai/src/providers/anthropic.ts`**

```ts
import Anthropic from "@anthropic-ai/sdk";
import type { AiProvider, AiProviderRequest, AiToolContext, AiUsageRecord } from "../types";
import type { AiSseEvent } from "@km/shared";

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  maxOutputTokens?: number;
}

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  readonly model: string;
  private readonly client: Anthropic;
  private readonly maxOutputTokens: number;

  constructor(opts: AnthropicProviderOptions) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.model = opts.model;
    this.maxOutputTokens = opts.maxOutputTokens ?? 2048;
  }

  async stream(
    req: AiProviderRequest,
    _ctx: AiToolContext,
    emit: (event: AiSseEvent) => void,
  ): Promise<AiUsageRecord> {
    const systemBlocks: Array<Record<string, unknown>> = [
      {
        type: "text",
        text: req.systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ];
    if (req.cachedNoteContext) {
      systemBlocks.push({
        type: "text",
        text: req.cachedNoteContext.text,
        cache_control: { type: "ephemeral" },
      });
    }

    const tools = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.jsonSchema,
    }));

    let inputTokens = 0;
    let outputTokens = 0;
    let cachedTokens = 0;

    const stream = await this.client.messages.stream(
      {
        model: this.model,
        max_tokens: this.maxOutputTokens,
        system: systemBlocks as never,
        tools: tools as never,
        messages: req.history as never,
      },
      { signal: req.signal },
    );

    stream.on("text", (delta) => emit({ type: "text", delta }));
    stream.on("contentBlock", (block) => {
      if ((block as { type?: string }).type === "tool_use") {
        const tu = block as { id: string; name: string; input: unknown };
        emit({ type: "tool_use", id: tu.id, name: tu.name, args: tu.input });
      }
    });

    const final = await stream.finalMessage();
    inputTokens = final.usage?.input_tokens ?? 0;
    outputTokens = final.usage?.output_tokens ?? 0;
    cachedTokens =
      (final.usage as { cache_read_input_tokens?: number } | undefined)
        ?.cache_read_input_tokens ?? 0;

    return { inputTokens, outputTokens, cachedTokens, model: this.model };
  }
}
```

- [ ] **Step 2: Create `packages/ai/src/providers/index.ts`**

```ts
import { AnthropicProvider } from "./anthropic";
import { StubProvider } from "./stub";
import type { AiProvider } from "../types";

export function getProvider(): AiProvider {
  if (process.env.AI_PROVIDER === "stub") {
    return new StubProvider();
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required when AI_PROVIDER is not 'stub'");
  }
  return new AnthropicProvider({
    apiKey,
    model: process.env.AI_MODEL ?? "claude-opus-4-6",
  });
}
```

- [ ] **Step 3: Re-export and typecheck**

Append to `packages/ai/src/index.ts`:

```ts
export { AnthropicProvider } from "./providers/anthropic";
export { getProvider } from "./providers/index";
```

Run:

```
pnpm --filter @km/ai typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```
git add packages/ai/src/providers/anthropic.ts packages/ai/src/providers/index.ts packages/ai/src/index.ts
git commit -m "feat(ai): Anthropic provider with prompt caching and provider selector"
```

---

## Task 9: Tool-loop runner

**Files:**
- Create: `packages/ai/src/runner.ts`
- Create: `packages/ai/test/runner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ai/test/runner.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { runChat } from "../src/runner";
import type { AiProvider, AiTool } from "../src/types";

const fakeTool: AiTool = {
  name: "echo",
  description: "echo args",
  jsonSchema: { type: "object" },
  parse: (raw) => raw,
  async execute(args) {
    return { echoed: args };
  },
};

class ScriptedProvider implements AiProvider {
  name = "scripted";
  model = "m";
  private callCount = 0;
  async stream(_req, _ctx, emit) {
    this.callCount++;
    if (this.callCount === 1) {
      emit({ type: "tool_use", id: "t1", name: "echo", args: { hi: 1 } });
    } else {
      emit({ type: "text", delta: "final" });
    }
    return { inputTokens: 1, outputTokens: 1, cachedTokens: 0, model: "m" };
  }
}

describe("runChat", () => {
  it("invokes the tool, feeds the result back, and streams the final text", async () => {
    const events: unknown[] = [];
    const usage = await runChat({
      provider: new ScriptedProvider(),
      tools: [fakeTool],
      systemPrompt: "sys",
      history: [{ role: "user", content: "hi" }],
      ctx: { userId: "u", vaultId: "v", prisma: {} as never },
      maxToolHops: 4,
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
    });
    expect(events.some((e: { type?: string }) => e.type === "tool_use")).toBe(true);
    expect(events.some((e: { type?: string }) => e.type === "tool_result")).toBe(true);
    expect(events.some((e: { type?: string }) => e.type === "text")).toBe(true);
    expect(usage.inputTokens).toBe(2);
  });

  it("aborts on max tool hops", async () => {
    class LoopProvider implements AiProvider {
      name = "loop";
      model = "m";
      async stream(_req, _ctx, emit) {
        emit({ type: "tool_use", id: "x", name: "echo", args: {} });
        return { inputTokens: 0, outputTokens: 0, cachedTokens: 0, model: "m" };
      }
    }
    await expect(
      runChat({
        provider: new LoopProvider(),
        tools: [fakeTool],
        systemPrompt: "s",
        history: [{ role: "user", content: "hi" }],
        ctx: { userId: "u", vaultId: "v", prisma: {} as never },
        maxToolHops: 2,
        signal: new AbortController().signal,
        emit: vi.fn(),
      }),
    ).rejects.toThrow(/max tool hops/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
pnpm --filter @km/ai test -- runner.test.ts
```

Expected: FAIL with "Cannot find module '../src/runner'".

- [ ] **Step 3: Create `packages/ai/src/runner.ts`**

```ts
import type { AiSseEvent } from "@km/shared";
import type { AiProvider, AiTool, AiToolContext, AiUsageRecord } from "./types";

export interface RunChatOptions {
  provider: AiProvider;
  tools: AiTool[];
  systemPrompt: string;
  cachedNoteContext?: { hash: string; text: string };
  history: Array<{ role: "user" | "assistant" | "tool"; content: unknown }>;
  ctx: AiToolContext;
  maxToolHops: number;
  signal: AbortSignal;
  emit: (event: AiSseEvent) => void;
}

export async function runChat(opts: RunChatOptions): Promise<AiUsageRecord> {
  const totals = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, model: opts.provider.model };
  let history = [...opts.history];

  for (let hop = 0; hop <= opts.maxToolHops; hop++) {
    const pendingToolCalls: Array<{ id: string; name: string; args: unknown }> = [];

    const usage = await opts.provider.stream(
      {
        systemPrompt: opts.systemPrompt,
        cachedNoteContext: opts.cachedNoteContext,
        history,
        tools: opts.tools,
        signal: opts.signal,
      },
      opts.ctx,
      (event) => {
        if (event.type === "tool_use") {
          pendingToolCalls.push({ id: event.id, name: event.name, args: event.args });
        }
        opts.emit(event);
      },
    );

    totals.inputTokens += usage.inputTokens;
    totals.outputTokens += usage.outputTokens;
    totals.cachedTokens += usage.cachedTokens;

    if (pendingToolCalls.length === 0) {
      return totals;
    }

    if (hop === opts.maxToolHops) {
      throw new Error(`runChat: max tool hops (${opts.maxToolHops}) exceeded`);
    }

    const toolResults: Array<{ id: string; result: unknown; ok: boolean; error?: string }> = [];
    for (const call of pendingToolCalls) {
      const tool = opts.tools.find((t) => t.name === call.name);
      if (!tool) {
        opts.emit({ type: "tool_result", id: call.id, ok: false, error: "unknown_tool" });
        toolResults.push({ id: call.id, ok: false, result: { error: "unknown_tool" }, error: "unknown_tool" });
        continue;
      }
      try {
        const parsed = tool.parse(call.args);
        const result = await tool.execute(parsed, opts.ctx);
        opts.emit({ type: "tool_result", id: call.id, ok: true, result });
        toolResults.push({ id: call.id, ok: true, result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        opts.emit({ type: "tool_result", id: call.id, ok: false, error: message });
        toolResults.push({ id: call.id, ok: false, result: { error: message }, error: message });
      }
    }

    history = [
      ...history,
      {
        role: "assistant",
        content: pendingToolCalls.map((c) => ({
          type: "tool_use",
          id: c.id,
          name: c.name,
          input: c.args,
        })),
      },
      {
        role: "tool",
        content: toolResults.map((r) => ({
          type: "tool_result",
          tool_use_id: r.id,
          content: JSON.stringify(r.result),
        })),
      },
    ];
  }

  return totals;
}
```

- [ ] **Step 4: Re-export and run the test**

Append to `packages/ai/src/index.ts`:

```ts
export { runChat } from "./runner";
export type { RunChatOptions } from "./runner";
```

Run:

```
pnpm --filter @km/ai test -- runner.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```
git add packages/ai/src/runner.ts packages/ai/src/index.ts packages/ai/test/runner.test.ts
git commit -m "feat(ai): tool-loop runner with hop cap and event emission"
```

---

## Task 10: Conversation lookup endpoint

**Files:**
- Create: `apps/web/src/app/api/ai/conversations/route.ts`

- [ ] **Step 1: Create the route**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@km/db";
import { requireUserId } from "@/lib/session";
import { assertCanAccessVault } from "@/lib/authz";

const body = z.object({
  vaultId: z.string().min(1),
  noteId: z.string().min(1),
});

export const runtime = "nodejs";

export async function POST(req: Request) {
  const userId = await requireUserId();
  const parsed = body.parse(await req.json());
  await assertCanAccessVault(userId, parsed.vaultId, "MEMBER");

  const existing = await prisma.aiConversation.findFirst({
    where: { vaultId: parsed.vaultId, noteId: parsed.noteId, createdById: userId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (existing) {
    return NextResponse.json(existing);
  }

  const created = await prisma.aiConversation.create({
    data: {
      vaultId: parsed.vaultId,
      noteId: parsed.noteId,
      createdById: userId,
    },
    include: { messages: true },
  });
  return NextResponse.json(created);
}
```

- [ ] **Step 2: Manual smoke**

```
pnpm --filter web dev
curl -X POST http://localhost:3000/api/ai/conversations -H 'content-type: application/json' --cookie "$SESSION" -d '{"vaultId":"<id>","noteId":"<id>"}'
```

Expected: 200 with a conversation row including an empty `messages` array.

- [ ] **Step 3: Commit**

```
git add apps/web/src/app/api/ai/conversations/route.ts
git commit -m "feat(web): add /api/ai/conversations endpoint for per-note chats"
```

---

## Task 11: SSE chat route

**Files:**
- Create: `apps/web/src/app/api/ai/chat/route.ts`

- [ ] **Step 1: Create the route**

```ts
import { z } from "zod";
import { prisma } from "@km/db";
import {
  ALL_TOOLS,
  AiBudgetExceededError,
  SYSTEM_PROMPT,
  enforceDailyBudget,
  getProvider,
  recordUsage,
  runChat,
} from "@km/ai";
import { aiChatRequest, type AiSseEvent } from "@km/shared";
import { requireUserId } from "@/lib/session";
import { assertCanAccessVault } from "@/lib/authz";
import { createHash } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_LIMIT = Number(process.env.AI_DAILY_TOKEN_LIMIT ?? 200000);
const REQUEST_LIMIT = Number(process.env.AI_DAILY_REQUEST_LIMIT ?? 200);
const MAX_TOOL_HOPS = Number(process.env.AI_MAX_TOOL_HOPS ?? 8);

function sseEncoder() {
  const encoder = new TextEncoder();
  return (event: AiSseEvent) =>
    encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  const parsed = aiChatRequest.parse(await req.json());

  const conversation = await prisma.aiConversation.findUniqueOrThrow({
    where: { id: parsed.conversationId },
    include: { note: true, messages: { orderBy: { createdAt: "asc" } } },
  });
  await assertCanAccessVault(userId, conversation.vaultId, "MEMBER");

  try {
    await enforceDailyBudget(prisma, userId, {
      tokenLimit: TOKEN_LIMIT,
      requestLimit: REQUEST_LIMIT,
    });
  } catch (err) {
    if (err instanceof AiBudgetExceededError) {
      return new Response(JSON.stringify({ code: "budget_exceeded", reason: err.reason }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    }
    throw err;
  }

  const userMessage = await prisma.aiMessage.create({
    data: {
      conversationId: conversation.id,
      role: "USER",
      content: [{ type: "text", text: parsed.message }],
    },
  });

  const note = conversation.note;
  const cachedNoteContext = note
    ? {
        hash: createHash("sha1").update(note.content).digest("hex"),
        text: `# Active note\n\n## Title\n${note.title}\n\n## Body\n${note.content}`,
      }
    : undefined;

  const history: Array<{ role: "user" | "assistant" | "tool"; content: unknown }> = [
    ...conversation.messages.map((m) => ({
      role: m.role.toLowerCase() as "user" | "assistant" | "tool",
      content: m.content as unknown,
    })),
    { role: "user", content: parsed.message },
  ];

  const provider = getProvider();
  const controller = new AbortController();
  const encode = sseEncoder();
  let totalUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, model: provider.model };
  const collectedAssistantBlocks: Array<unknown> = [];

  const stream = new ReadableStream<Uint8Array>({
    async start(streamCtl) {
      const send = (event: AiSseEvent) => streamCtl.enqueue(encode(event));
      send({ type: "ready", conversationId: conversation.id, messageId: userMessage.id });
      try {
        totalUsage = await runChat({
          provider,
          tools: ALL_TOOLS,
          systemPrompt: SYSTEM_PROMPT,
          cachedNoteContext,
          history,
          ctx: { userId, vaultId: conversation.vaultId, prisma },
          maxToolHops: MAX_TOOL_HOPS,
          signal: controller.signal,
          emit: (event) => {
            if (event.type === "text") {
              collectedAssistantBlocks.push({ type: "text", text: event.delta });
            } else if (event.type === "tool_use") {
              collectedAssistantBlocks.push({
                type: "tool_use",
                id: event.id,
                name: event.name,
                input: event.args,
              });
            }
            send(event);
          },
        });
        send({
          type: "usage",
          inputTokens: totalUsage.inputTokens,
          outputTokens: totalUsage.outputTokens,
          cachedTokens: totalUsage.cachedTokens,
          model: totalUsage.model,
        });
        send({ type: "done" });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: "error", code: "stream_failed", message });
      } finally {
        try {
          await prisma.aiMessage.create({
            data: {
              conversationId: conversation.id,
              role: "ASSISTANT",
              content: collectedAssistantBlocks,
              inputTokens: totalUsage.inputTokens,
              outputTokens: totalUsage.outputTokens,
              cachedTokens: totalUsage.cachedTokens,
              model: totalUsage.model,
            },
          });
          await recordUsage(prisma, {
            userId,
            vaultId: conversation.vaultId,
            inputTokens: totalUsage.inputTokens,
            outputTokens: totalUsage.outputTokens,
            cachedTokens: totalUsage.cachedTokens,
          });
        } finally {
          streamCtl.close();
        }
      }
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 2: Add `@km/ai`, `@anthropic-ai/sdk`, `react-markdown`, `remark-gfm`, `rehype-highlight` to `apps/web/package.json` dependencies**

```json
    "@km/ai": "workspace:*",
    "@anthropic-ai/sdk": "^0.30.0",
    "react-markdown": "^9.0.1",
    "remark-gfm": "^4.0.0",
    "rehype-highlight": "^7.0.0",
```

Run:

```
pnpm install
```

Expected: install succeeds.

- [ ] **Step 3: Commit**

```
git add apps/web/src/app/api/ai/chat/route.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): add /api/ai/chat SSE route with budget and tool loop"
```

---

## Task 12: SSE chat route integration test

**Files:**
- Create: `apps/web/test/api/ai-chat.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@km/db";

vi.mock("@km/ai", async (orig) => {
  const mod = await orig<typeof import("@km/ai")>();
  const { StubProvider } = mod;
  return {
    ...mod,
    getProvider: () =>
      new StubProvider([
        { type: "text", delta: "hi from stub" },
      ]),
  };
});

vi.mock("@/lib/session", () => ({ requireUserId: vi.fn(async () => globalThis.__USER_ID) }));
vi.mock("@/lib/authz", () => ({ assertCanAccessVault: vi.fn(async () => undefined) }));

import { POST } from "@/app/api/ai/chat/route";

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

describe("POST /api/ai/chat", () => {
  beforeEach(async () => {
    await prisma.aiMessage.deleteMany({});
    await prisma.aiConversation.deleteMany({});
    await prisma.aiUsage.deleteMany({});
    await prisma.note.deleteMany({});
    await prisma.vault.deleteMany({});
    await prisma.user.deleteMany({});
  });

  it("streams text, persists messages, and records usage", async () => {
    const user = await prisma.user.create({ data: { email: `u${Date.now()}@t.io` } });
    const vault = await prisma.vault.create({
      data: { ownerType: "USER", ownerId: user.id, name: "V" },
    });
    const note = await prisma.note.create({
      data: {
        vaultId: vault.id,
        title: "N",
        slug: "n",
        content: "body",
        createdById: user.id,
        updatedById: user.id,
      },
    });
    const conversation = await prisma.aiConversation.create({
      data: { vaultId: vault.id, noteId: note.id, createdById: user.id },
    });
    (globalThis as { __USER_ID?: string }).__USER_ID = user.id;

    const res = await POST(
      new Request("http://test/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({ conversationId: conversation.id, message: "hi" }),
      }),
    );
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const events = await readSse(res);
    expect(events.some((e) => e.includes("event: ready"))).toBe(true);
    expect(events.some((e) => e.includes("event: text") && e.includes("hi from stub"))).toBe(true);
    expect(events.some((e) => e.includes("event: done"))).toBe(true);

    const messages = await prisma.aiMessage.findMany({ where: { conversationId: conversation.id } });
    expect(messages).toHaveLength(2);
    const usage = await prisma.aiUsage.findFirst({ where: { userId: user.id } });
    expect(usage?.requests).toBe(1);
    expect(usage!.inputTokens + usage!.outputTokens).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test**

```
pnpm --filter web test -- ai-chat.test.ts
```

Expected: PASS, 1 test.

- [ ] **Step 3: Commit**

```
git add apps/web/test/api/ai-chat.test.ts
git commit -m "test(web): integration test for /api/ai/chat with stub provider"
```

---

## Task 13: SSE command route

**Files:**
- Create: `apps/web/src/app/api/ai/command/route.ts`
- Create: `apps/web/test/api/ai-command.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/api/ai-command.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@km/db";

vi.mock("@km/ai", async (orig) => {
  const mod = await orig<typeof import("@km/ai")>();
  const { StubProvider } = mod;
  return {
    ...mod,
    getProvider: () => new StubProvider([{ type: "text", delta: "summary" }]),
  };
});
vi.mock("@/lib/session", () => ({ requireUserId: vi.fn(async () => globalThis.__USER_ID) }));
vi.mock("@/lib/authz", () => ({ assertCanAccessVault: vi.fn(async () => undefined) }));

import { POST } from "@/app/api/ai/command/route";

describe("POST /api/ai/command", () => {
  beforeEach(async () => {
    await prisma.aiMessage.deleteMany({});
    await prisma.aiConversation.deleteMany({});
    await prisma.aiUsage.deleteMany({});
    await prisma.vault.deleteMany({});
    await prisma.user.deleteMany({});
  });

  it("templates the command into a user message and streams a reply", async () => {
    const user = await prisma.user.create({ data: { email: `u${Date.now()}@t.io` } });
    const vault = await prisma.vault.create({
      data: { ownerType: "USER", ownerId: user.id, name: "V" },
    });
    const conversation = await prisma.aiConversation.create({
      data: { vaultId: vault.id, createdById: user.id },
    });
    (globalThis as { __USER_ID?: string }).__USER_ID = user.id;

    const res = await POST(
      new Request("http://test/api/ai/command", {
        method: "POST",
        body: JSON.stringify({
          conversationId: conversation.id,
          command: "summarize",
          selection: "long text here",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("event: text");

    const messages = await prisma.aiMessage.findMany({ where: { conversationId: conversation.id } });
    expect(messages).toHaveLength(2);
    const userMsg = messages.find((m) => m.role === "USER");
    const content = userMsg!.content as Array<{ text: string }>;
    expect(content[0].text).toContain("Summarise");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
pnpm --filter web test -- ai-command.test.ts
```

Expected: FAIL with "Cannot find module '@/app/api/ai/command/route'".

- [ ] **Step 3: Create the route**

```ts
import { z } from "zod";
import { prisma } from "@km/db";
import {
  ALL_TOOLS,
  AiBudgetExceededError,
  SYSTEM_PROMPT,
  buildCommandUserMessage,
  enforceDailyBudget,
  getProvider,
  recordUsage,
  runChat,
} from "@km/ai";
import { aiCommandRequest, type AiSseEvent } from "@km/shared";
import { requireUserId } from "@/lib/session";
import { assertCanAccessVault } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_LIMIT = Number(process.env.AI_DAILY_TOKEN_LIMIT ?? 200000);
const REQUEST_LIMIT = Number(process.env.AI_DAILY_REQUEST_LIMIT ?? 200);
const MAX_TOOL_HOPS = Number(process.env.AI_MAX_TOOL_HOPS ?? 8);

function sseEncoder() {
  const encoder = new TextEncoder();
  return (event: AiSseEvent) =>
    encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  const parsed = aiCommandRequest.parse(await req.json());

  const conversation = await prisma.aiConversation.findUniqueOrThrow({
    where: { id: parsed.conversationId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  await assertCanAccessVault(userId, conversation.vaultId, "MEMBER");

  try {
    await enforceDailyBudget(prisma, userId, {
      tokenLimit: TOKEN_LIMIT,
      requestLimit: REQUEST_LIMIT,
    });
  } catch (err) {
    if (err instanceof AiBudgetExceededError) {
      return new Response(JSON.stringify({ code: "budget_exceeded", reason: err.reason }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    }
    throw err;
  }

  const templated = buildCommandUserMessage(parsed.command, {
    selection: parsed.selection,
    language: parsed.language,
  });

  const userMessage = await prisma.aiMessage.create({
    data: {
      conversationId: conversation.id,
      role: "USER",
      content: [{ type: "text", text: templated }],
    },
  });

  const history: Array<{ role: "user" | "assistant" | "tool"; content: unknown }> = [
    ...conversation.messages.map((m) => ({
      role: m.role.toLowerCase() as "user" | "assistant" | "tool",
      content: m.content as unknown,
    })),
    { role: "user", content: templated },
  ];

  const provider = getProvider();
  const controller = new AbortController();
  const encode = sseEncoder();
  let totalUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, model: provider.model };
  const collected: Array<unknown> = [];

  const stream = new ReadableStream<Uint8Array>({
    async start(streamCtl) {
      const send = (event: AiSseEvent) => streamCtl.enqueue(encode(event));
      send({ type: "ready", conversationId: conversation.id, messageId: userMessage.id });
      try {
        totalUsage = await runChat({
          provider,
          tools: ALL_TOOLS,
          systemPrompt: SYSTEM_PROMPT,
          history,
          ctx: { userId, vaultId: conversation.vaultId, prisma },
          maxToolHops: MAX_TOOL_HOPS,
          signal: controller.signal,
          emit: (event) => {
            if (event.type === "text") {
              collected.push({ type: "text", text: event.delta });
            }
            send(event);
          },
        });
        send({
          type: "usage",
          inputTokens: totalUsage.inputTokens,
          outputTokens: totalUsage.outputTokens,
          cachedTokens: totalUsage.cachedTokens,
          model: totalUsage.model,
        });
        send({ type: "done" });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: "error", code: "stream_failed", message });
      } finally {
        try {
          await prisma.aiMessage.create({
            data: {
              conversationId: conversation.id,
              role: "ASSISTANT",
              content: collected,
              inputTokens: totalUsage.inputTokens,
              outputTokens: totalUsage.outputTokens,
              cachedTokens: totalUsage.cachedTokens,
              model: totalUsage.model,
            },
          });
          await recordUsage(prisma, {
            userId,
            vaultId: conversation.vaultId,
            inputTokens: totalUsage.inputTokens,
            outputTokens: totalUsage.outputTokens,
            cachedTokens: totalUsage.cachedTokens,
          });
        } finally {
          streamCtl.close();
        }
      }
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 4: Rerun the test**

```
pnpm --filter web test -- ai-command.test.ts
```

Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```
git add apps/web/src/app/api/ai/command/route.ts apps/web/test/api/ai-command.test.ts
git commit -m "feat(web): add /api/ai/command SSE route for inline slash commands"
```

---

## Task 14: Browser SSE client

**Files:**
- Create: `apps/web/src/lib/sse.ts`
- Create: `apps/web/src/lib/sse.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/sse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseSseChunk } from "./sse";

describe("parseSseChunk", () => {
  it("parses a single event", () => {
    const events = parseSseChunk("event: text\ndata: {\"type\":\"text\",\"delta\":\"hi\"}\n\n");
    expect(events).toEqual([{ event: "text", data: { type: "text", delta: "hi" } }]);
  });

  it("parses multiple events in a chunk", () => {
    const raw =
      'event: ready\ndata: {"type":"ready","conversationId":"c","messageId":"m"}\n\n' +
      'event: text\ndata: {"type":"text","delta":"x"}\n\n';
    const events = parseSseChunk(raw);
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe("ready");
  });

  it("ignores trailing partials", () => {
    const events = parseSseChunk("event: text\ndata: {");
    expect(events).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
pnpm --filter web test -- sse.test.ts
```

Expected: FAIL with "Cannot find module './sse'".

- [ ] **Step 3: Create `apps/web/src/lib/sse.ts`**

```ts
import { aiSseEvent, type AiSseEvent } from "@km/shared";

export interface ParsedSseEvent {
  event: string;
  data: AiSseEvent;
}

export function parseSseChunk(raw: string): ParsedSseEvent[] {
  const out: ParsedSseEvent[] = [];
  for (const block of raw.split("\n\n")) {
    const lines = block.split("\n");
    let event = "message";
    let dataLine = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) event = line.slice(7).trim();
      else if (line.startsWith("data: ")) dataLine = line.slice(6);
    }
    if (!dataLine) continue;
    try {
      const json = JSON.parse(dataLine);
      const parsed = aiSseEvent.parse(json);
      out.push({ event, data: parsed });
    } catch {
      // partial or invalid block, skip
    }
  }
  return out;
}

export interface OpenSseOptions {
  url: string;
  body: unknown;
  signal: AbortSignal;
  onEvent: (event: ParsedSseEvent) => void;
}

export async function openSse(opts: OpenSseOptions): Promise<void> {
  const res = await fetch(opts.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(opts.body),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`SSE request failed: ${res.status}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, idx + 2);
      buffer = buffer.slice(idx + 2);
      for (const ev of parseSseChunk(block)) {
        opts.onEvent(ev);
      }
    }
  }
}
```

- [ ] **Step 4: Rerun the test**

```
pnpm --filter web test -- sse.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```
git add apps/web/src/lib/sse.ts apps/web/src/lib/sse.test.ts
git commit -m "feat(web): browser SSE client over fetch with parseSseChunk helper"
```

---

## Task 15: Tool-call card and message view components

**Files:**
- Create: `apps/web/src/components/AiToolCallCard.tsx`
- Create: `apps/web/src/components/AiMessageView.tsx`

- [ ] **Step 1: Create `apps/web/src/components/AiToolCallCard.tsx`**

```tsx
"use client";
import { useState } from "react";

export interface AiToolCallCardProps {
  name: string;
  args: unknown;
  result?: unknown;
  ok?: boolean;
  error?: string;
}

export function AiToolCallCard(props: AiToolCallCardProps) {
  const [open, setOpen] = useState(false);
  const status = props.ok === false ? "error" : props.result === undefined ? "running" : "ok";
  return (
    <div className="my-2 rounded border border-slate-300 bg-slate-50 p-2 text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left font-mono"
      >
        <span>
          tool: <strong>{props.name}</strong> [{status}]
        </span>
        <span>{open ? "-" : "+"}</span>
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          <pre className="overflow-x-auto rounded bg-white p-2 text-xs">
            {JSON.stringify(props.args, null, 2)}
          </pre>
          {props.result !== undefined ? (
            <pre className="overflow-x-auto rounded bg-white p-2 text-xs">
              {JSON.stringify(props.result, null, 2)}
            </pre>
          ) : null}
          {props.error ? <p className="text-red-700">{props.error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Create `apps/web/src/components/AiMessageView.tsx`**

```tsx
"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { AiToolCallCard } from "./AiToolCallCard";

export interface AiMessageBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  result?: unknown;
  ok?: boolean;
  error?: string;
}

export interface AiMessageViewProps {
  role: "USER" | "ASSISTANT" | "TOOL" | "SYSTEM";
  blocks: AiMessageBlock[];
  onApply?: (text: string) => void;
}

export function AiMessageView(props: AiMessageViewProps) {
  const isAssistant = props.role === "ASSISTANT";
  return (
    <div className={`mb-3 rounded p-2 ${isAssistant ? "bg-white" : "bg-blue-50"}`}>
      {props.blocks.map((b, i) => {
        if (b.type === "text" && b.text !== undefined) {
          return (
            <div key={i}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                {b.text}
              </ReactMarkdown>
              {isAssistant && props.onApply ? (
                <button
                  type="button"
                  onClick={() => props.onApply!(b.text!)}
                  className="mt-1 text-xs underline"
                >
                  Apply at cursor
                </button>
              ) : null}
            </div>
          );
        }
        if (b.type === "tool_use") {
          return <AiToolCallCard key={i} name={b.name ?? "?"} args={b.input} />;
        }
        if (b.type === "tool_result") {
          return (
            <AiToolCallCard
              key={i}
              name="result"
              args={null}
              result={b.result}
              ok={b.ok}
              error={b.error}
            />
          );
        }
        return null;
      })}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

```
pnpm --filter web typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```
git add apps/web/src/components/AiToolCallCard.tsx apps/web/src/components/AiMessageView.tsx
git commit -m "feat(web): chat message and tool-call view components"
```

---

## Task 16: Chat panel component

**Files:**
- Create: `apps/web/src/components/AiChatPanel.tsx`

- [ ] **Step 1: Create the panel**

```tsx
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { openSse, type ParsedSseEvent } from "@/lib/sse";
import { AiMessageView, type AiMessageBlock } from "./AiMessageView";

export interface AiChatPanelProps {
  vaultId: string;
  noteId: string;
  onApplyAtCursor?: (text: string) => void;
  registerCommandRunner?: (
    fn: (cmd: { command: string; selection: string; language?: string }) => void,
  ) => void;
}

interface PersistedMessage {
  id: string;
  role: "USER" | "ASSISTANT" | "TOOL" | "SYSTEM";
  content: AiMessageBlock[];
}

export function AiChatPanel(props: AiChatPanelProps) {
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<PersistedMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [usage, setUsage] = useState<{ used: number; limit: number }>({ used: 0, limit: 0 });
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamingBlocksRef = useRef<AiMessageBlock[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/ai/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vaultId: props.vaultId, noteId: props.noteId }),
      });
      const json = await res.json();
      if (cancelled) return;
      setConversationId(json.id);
      setMessages(
        (json.messages ?? []).map((m: PersistedMessage) => ({
          id: m.id,
          role: m.role,
          content: Array.isArray(m.content) ? m.content : [{ type: "text", text: String(m.content) }],
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [open, props.vaultId, props.noteId]);

  const handleEvent = useCallback((ev: ParsedSseEvent) => {
    const data = ev.data;
    if (data.type === "text") {
      const last = streamingBlocksRef.current.at(-1);
      if (last && last.type === "text") {
        last.text = (last.text ?? "") + data.delta;
      } else {
        streamingBlocksRef.current.push({ type: "text", text: data.delta });
      }
      setMessages((prev) => [...prev]);
    } else if (data.type === "tool_use") {
      streamingBlocksRef.current.push({
        type: "tool_use",
        id: data.id,
        name: data.name,
        input: data.args,
      });
      setMessages((prev) => [...prev]);
    } else if (data.type === "tool_result") {
      streamingBlocksRef.current.push({
        type: "tool_result",
        id: data.id,
        ok: data.ok,
        result: data.result,
        error: data.error,
      });
      setMessages((prev) => [...prev]);
    } else if (data.type === "usage") {
      setUsage((u) => ({ used: u.used + data.inputTokens + data.outputTokens, limit: u.limit }));
    } else if (data.type === "error") {
      setError(data.message);
    }
  }, []);

  const flushStreamingMessage = useCallback(() => {
    if (streamingBlocksRef.current.length === 0) return;
    const blocks = streamingBlocksRef.current;
    streamingBlocksRef.current = [];
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, role: "ASSISTANT", content: blocks },
    ]);
  }, []);

  const send = useCallback(
    async (payload: { url: string; body: unknown; localUserText: string }) => {
      if (!conversationId) return;
      setError(null);
      setStreaming(true);
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}-u`,
          role: "USER",
          content: [{ type: "text", text: payload.localUserText }],
        },
      ]);
      const ctl = new AbortController();
      abortRef.current = ctl;
      streamingBlocksRef.current = [];
      try {
        await openSse({
          url: payload.url,
          body: payload.body,
          signal: ctl.signal,
          onEvent: handleEvent,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        flushStreamingMessage();
        setStreaming(false);
      }
    },
    [conversationId, handleEvent, flushStreamingMessage],
  );

  useEffect(() => {
    if (!props.registerCommandRunner) return;
    props.registerCommandRunner(({ command, selection, language }) => {
      setOpen(true);
      void send({
        url: "/api/ai/command",
        body: { conversationId, command, selection, language },
        localUserText: `/${command} on selection`,
      });
    });
  }, [props, conversationId, send]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-4 top-20 rounded bg-slate-900 px-3 py-1 text-sm text-white"
      >
        Open AI chat
      </button>
    );
  }

  return (
    <aside className="fixed right-0 top-16 flex h-[calc(100vh-4rem)] w-96 flex-col border-l border-slate-200 bg-slate-100">
      <header className="flex items-center justify-between border-b border-slate-200 p-2 text-sm">
        <span>AI chat</span>
        <span className="text-xs text-slate-600">
          {usage.used} tokens used today
        </span>
        <button type="button" onClick={() => setOpen(false)} className="text-xs underline">
          close
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-2">
        {messages.map((m) => (
          <AiMessageView
            key={m.id}
            role={m.role}
            blocks={m.content}
            onApply={props.onApplyAtCursor}
          />
        ))}
        {streaming && streamingBlocksRef.current.length > 0 ? (
          <AiMessageView
            role="ASSISTANT"
            blocks={streamingBlocksRef.current}
            onApply={props.onApplyAtCursor}
          />
        ) : null}
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
      </div>
      <form
        className="border-t border-slate-200 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim() || streaming) return;
          const text = draft;
          setDraft("");
          void send({
            url: "/api/ai/chat",
            body: { conversationId, message: text },
            localUserText: text,
          });
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          className="w-full rounded border border-slate-300 p-1 text-sm"
          placeholder="Ask the AI about this note..."
        />
        <button
          type="submit"
          disabled={streaming}
          className="mt-1 rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </aside>
  );
}
```

- [ ] **Step 2: Typecheck**

```
pnpm --filter web typecheck
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```
git add apps/web/src/components/AiChatPanel.tsx
git commit -m "feat(web): AiChatPanel with SSE streaming, history load, command runner hook"
```

---

## Task 17: Editor slash-command extension

**Files:**
- Create: `packages/editor/src/aiCommands.ts`
- Create: `packages/editor/src/aiCommands.test.ts`
- Modify: `packages/editor/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/editor/src/aiCommands.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { parseSlashCommand, captureContext } from "./aiCommands";

describe("parseSlashCommand", () => {
  it("recognises supported commands", () => {
    expect(parseSlashCommand("/summarize")).toEqual({ command: "summarize" });
    expect(parseSlashCommand("/translate fr")).toEqual({ command: "translate", language: "fr" });
  });

  it("returns null for unknown text", () => {
    expect(parseSlashCommand("/unknown")).toBeNull();
    expect(parseSlashCommand("hello")).toBeNull();
  });
});

describe("captureContext", () => {
  it("returns the selection when present", () => {
    const state = EditorState.create({ doc: "line one\nline two", selection: { anchor: 0, head: 8 } });
    expect(captureContext(state)).toBe("line one");
  });

  it("falls back to the current line when no selection", () => {
    const state = EditorState.create({ doc: "line one\nline two", selection: { anchor: 12, head: 12 } });
    expect(captureContext(state)).toBe("line two");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
pnpm --filter @km/editor test -- aiCommands.test.ts
```

Expected: FAIL with "Cannot find module './aiCommands'".

- [ ] **Step 3: Create `packages/editor/src/aiCommands.ts`**

```ts
import { Extension } from "@codemirror/state";
import { keymap, EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";

const SUPPORTED = ["summarize", "expand", "rewrite", "translate"] as const;
type SupportedCommand = (typeof SUPPORTED)[number];

export interface ParsedCommand {
  command: SupportedCommand;
  language?: string;
}

export function parseSlashCommand(text: string): ParsedCommand | null {
  const match = text.trim().match(/^\/(\w+)(?:\s+(.+))?$/);
  if (!match) return null;
  const name = match[1] as SupportedCommand;
  if (!SUPPORTED.includes(name)) return null;
  if (name === "translate") {
    return { command: name, language: match[2] ?? "English" };
  }
  return { command: name };
}

export function captureContext(state: EditorState): string {
  const { from, to } = state.selection.main;
  if (from !== to) return state.sliceDoc(from, to);
  const line = state.doc.lineAt(from);
  return line.text;
}

export interface AiCommandsOptions {
  onCommand: (cmd: ParsedCommand & { selection: string }) => void;
  promptForLine?: (defaultText: string) => Promise<string | null>;
}

export function aiCommands(opts: AiCommandsOptions): Extension {
  return keymap.of([
    {
      key: "Mod-Shift-k",
      run(view) {
        const line = view.state.doc.lineAt(view.state.selection.main.head);
        const promptFn =
          opts.promptForLine ??
          (async (def) =>
            typeof window !== "undefined" ? window.prompt("AI command (e.g. /summarize)", def) : null);
        promptFn(line.text.startsWith("/") ? line.text : "/summarize").then((entered) => {
          if (!entered) return;
          const parsed = parseSlashCommand(entered);
          if (!parsed) return;
          const selection = captureContext(view.state);
          opts.onCommand({ ...parsed, selection });
        });
        return true;
      },
    },
  ]);
}
```

- [ ] **Step 4: Re-export from `packages/editor/src/index.ts`**

Append:

```ts
export { aiCommands, parseSlashCommand, captureContext } from "./aiCommands";
export type { AiCommandsOptions, ParsedCommand } from "./aiCommands";
```

- [ ] **Step 5: Run the test**

```
pnpm --filter @km/editor test -- aiCommands.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```
git add packages/editor/src/aiCommands.ts packages/editor/src/aiCommands.test.ts packages/editor/src/index.ts
git commit -m "feat(editor): aiCommands extension with slash-command parsing"
```

---

## Task 18: Wire chat panel and aiCommands into the note page

**Files:**
- Modify: `apps/web/src/app/(app)/vault/[vaultId]/note/[noteId]/page.tsx`

- [ ] **Step 1: Add the imports at the top of the file**

```tsx
import { useCallback, useRef } from "react";
import { aiCommands } from "@km/editor";
import { AiChatPanel } from "@/components/AiChatPanel";
```

- [ ] **Step 2: Inside the page component, add the command bridge**

Replace the existing CodeMirror extensions array assembly with one that includes `aiCommands`. Add at the top of the component body:

```tsx
const commandRunnerRef = useRef<((cmd: { command: string; selection: string; language?: string }) => void) | null>(null);

const onAiCommand = useCallback((cmd: { command: string; selection: string; language?: string }) => {
  commandRunnerRef.current?.(cmd);
}, []);

const onApplyAtCursor = useCallback((text: string) => {
  // The collab CodeMirror view is mounted by NoteEditor; expose a ref via NoteEditorProps in a follow-up task if needed.
  // For v1 the panel writes via document.execCommand-free path: dispatch a custom DOM event the editor listens to.
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("ai:applyAtCursor", { detail: { text } }));
  }
}, []);
```

Then where the editor extensions are built, add `aiCommands({ onCommand: onAiCommand })` to the list.

At the end of the JSX, add:

```tsx
<AiChatPanel
  vaultId={vaultId}
  noteId={noteId}
  onApplyAtCursor={onApplyAtCursor}
  registerCommandRunner={(fn) => {
    commandRunnerRef.current = fn;
  }}
/>
```

- [ ] **Step 3: Typecheck and lint**

```
pnpm --filter web typecheck
pnpm --filter web lint
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```
git add apps/web/src/app/\(app\)/vault/\[vaultId\]/note/\[noteId\]/page.tsx
git commit -m "feat(web): mount AiChatPanel and aiCommands extension on the note page"
```

---

## Task 19: Environment variables

**Files:**
- Modify: `env.example`

- [ ] **Step 1: Append AI variables**

```
# AI integration
ANTHROPIC_API_KEY=
AI_MODEL=claude-opus-4-6
AI_DAILY_TOKEN_LIMIT=200000
AI_DAILY_REQUEST_LIMIT=200
AI_MAX_TOOL_HOPS=8
# Set to "stub" in CI to use the deterministic stub provider
AI_PROVIDER=
```

- [ ] **Step 2: Commit**

```
git add env.example
git commit -m "chore(env): add AI integration env vars"
```

---

## Task 20: CI configuration

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add `AI_PROVIDER: stub` to the test job env block**

In each job that runs `pnpm test` or `pnpm -r test`, add the env entry:

```yaml
    env:
      AI_PROVIDER: stub
      ANTHROPIC_API_KEY: stub-key-not-used
```

- [ ] **Step 2: Commit**

```
git add .github/workflows/ci.yml
git commit -m "ci: run tests with AI_PROVIDER=stub"
```

---

## Task 21: Coolify and deployment notes

**Files:**
- Modify: `infra/coolify/README.md`

- [ ] **Step 1: Add an "AI integration" section**

Append:

```markdown
## AI integration

Phase 3 adds an in-app chat panel and inline slash commands powered by the Anthropic Claude API. No new container is required; the web service makes outbound HTTPS calls to api.anthropic.com.

Required env vars on the web service:

- `ANTHROPIC_API_KEY` - server-only secret. Never expose to the browser.
- `AI_MODEL` - default `claude-opus-4-6`. Override per environment if needed.
- `AI_DAILY_TOKEN_LIMIT` - default `200000`. Per-user, per-day combined input plus output token cap.
- `AI_DAILY_REQUEST_LIMIT` - default `200`. Per-user, per-day request cap.
- `AI_MAX_TOOL_HOPS` - default `8`. Upper bound on tool-call rounds per chat turn.

The Cloudflare proxy already supports Server-Sent Events. No proxy config changes are needed for the new endpoints (`/api/ai/chat`, `/api/ai/command`, `/api/ai/conversations`).
```

- [ ] **Step 2: Commit**

```
git add infra/coolify/README.md
git commit -m "docs(infra): document AI env vars and SSE notes for Coolify"
```

---

## Task 22: Architecture, data-model, deployment, and API docs

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/data-model.md`
- Modify: `docs/deployment.md`
- Modify: `docs/api.md`

- [ ] **Step 1: Add an "AI integration" section to `docs/architecture.md`**

Append:

```markdown
## AI integration

Phase 3 introduced a server-mediated AI assistant. The browser never holds the model API key. All requests go through `/api/ai/chat` and `/api/ai/command`, both Server-Sent Events endpoints in the web app. Each request authenticates via `requireUserId()`, authorises with `assertCanAccessVault()`, and enforces a per-user daily budget with `enforceDailyBudget()` from `@km/ai`.

The provider is wrapped behind an `AiProvider` interface in `packages/ai`. The Anthropic implementation uses prompt caching for the system prompt and the active note context. A stub provider is selected when `AI_PROVIDER=stub`, used for unit tests and CI.

The tool runner in `packages/ai/src/runner.ts` drives a bounded loop of provider stream calls and tool executions. v1 tools are read-only and vault-scoped: `readNote`, `searchNotes`, `listBacklinks`. Each tool re-checks vault membership defensively before reading data.
```

- [ ] **Step 2: Add an "AI tables" section to `docs/data-model.md`**

Append:

```markdown
## AI integration tables

- `AiConversation` - one per `(vaultId, noteId, userId)` pairing in v1. `noteId` is nullable for future vault-wide chats. Cascades from vault delete; nulls on note delete.
- `AiMessage` - rows per turn. `role` is one of `USER`, `ASSISTANT`, `TOOL`, `SYSTEM`. `content` stores Anthropic block JSON to preserve `text`, `tool_use`, and `tool_result` structure. Token counters captured on each row from the provider's usage payload.
- `AiUsage` - one row per `(userId, day)`. Powers the daily budget check. Vault id is recorded for future per-vault reporting but is not part of the unique key.
```

- [ ] **Step 3: Add an "AI environment variables" section to `docs/deployment.md`**

Append:

```markdown
## AI integration

Required on the web service:

- `ANTHROPIC_API_KEY` - server-only.
- `AI_MODEL` - default `claude-opus-4-6`.
- `AI_DAILY_TOKEN_LIMIT` - default `200000`.
- `AI_DAILY_REQUEST_LIMIT` - default `200`.
- `AI_MAX_TOOL_HOPS` - default `8`.
- `AI_PROVIDER` - leave unset in production. Set to `stub` in CI.
```

- [ ] **Step 4: Add AI routes to `docs/api.md`**

Append:

```markdown
## AI routes

### POST /api/ai/conversations

Body: `{ vaultId, noteId }`. Returns the existing conversation for `(vault, note, user)` or creates a new one. Includes `messages` ordered ascending.

### POST /api/ai/chat

Body: `{ conversationId, message }`. Server-Sent Events response. Event types: `ready`, `text`, `tool_use`, `tool_result`, `usage`, `done`, `error`. Returns 429 with `{ code: "budget_exceeded", reason }` if the daily budget is reached before the call.

### POST /api/ai/command

Body: `{ conversationId, command, selection, language? }`. Same SSE event grammar as `/api/ai/chat`. The `command` is one of `summarize`, `expand`, `rewrite`, `translate`. `language` is required for `translate`.
```

- [ ] **Step 5: Commit**

```
git add docs/architecture.md docs/data-model.md docs/deployment.md docs/api.md
git commit -m "docs: cover AI integration architecture, data model, deployment, and API"
```

---

## Task 23: End-user guides

**Files:**
- Create: `guides/ai-chat.md`
- Create: `guides/ai-inline-commands.md`

- [ ] **Step 1: Create `guides/ai-chat.md`**

```markdown
# Using the AI chat panel

Each note has an AI chat panel that opens from the right side of the page. Click "Open AI chat" to expand it.

The assistant can read the active note and any other note in the same vault. It looks up other notes by exact title or by a title prefix, and can show you a list of notes that link back to a given note. Everything stays inside the vault you are working in.

Ask anything in plain English. Press Send to deliver the message and watch the reply stream in. The assistant cannot edit your notes directly. When it suggests changes, click "Apply at cursor" to drop the suggested text where your cursor sits in the editor.

Each tool call the assistant makes appears as a small expandable card so you can see what it looked at.

There is a daily limit on how many tokens and requests each user can spend. The current usage shows in the panel header. If you hit the limit, the assistant will pause until the next day in UTC.
```

- [ ] **Step 2: Create `guides/ai-inline-commands.md`**

```markdown
# Inline AI commands

The editor supports four quick commands that run on the current selection or, if nothing is selected, the line your cursor sits on.

- `/summarize` produces a short bullet-point summary.
- `/expand` adds detail and examples while keeping the meaning.
- `/rewrite` rewrites the text to be clearer and more direct.
- `/translate` translates the text into a target language you provide.

Press the inline command shortcut and type the command. The chat panel will open if it is not already, the assistant's reply will stream in, and you can click "Apply at cursor" to replace the original text with the result.

Inline commands count against the same daily token and request limit as the chat panel.
```

- [ ] **Step 3: Commit**

```
git add guides/ai-chat.md guides/ai-inline-commands.md
git commit -m "docs(guides): user guides for AI chat panel and inline commands"
```

---

## Task 24: Playwright E2E for the chat panel

**Files:**
- Create: `apps/web/playwright/ai-chat.spec.ts`

- [ ] **Step 1: Write the test**

```ts
import { test, expect } from "@playwright/test";

test("AI chat panel streams a response and updates usage", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[name="email"]', "e2e@test.io");
  await page.fill('input[name="password"]', "Password123!");
  await page.click('button[type="submit"]');

  await page.waitForURL(/\/vault\//);
  await page.click('text=Open AI chat');
  await page.fill("textarea", "What is in this note?");
  await page.click('button:has-text("Send")');

  await expect(page.locator("aside")).toContainText("stub response");
  await expect(page.locator("aside header")).toContainText("tokens used today");
});
```

- [ ] **Step 2: Confirm Playwright config runs the web app with `AI_PROVIDER=stub`**

In `apps/web/playwright.config.ts`, ensure the `webServer.env` block contains:

```ts
        AI_PROVIDER: "stub",
        ANTHROPIC_API_KEY: "stub",
```

- [ ] **Step 3: Run the test**

```
pnpm --filter web exec playwright test ai-chat.spec.ts
```

Expected: PASS, 1 test.

- [ ] **Step 4: Commit**

```
git add apps/web/playwright/ai-chat.spec.ts apps/web/playwright.config.ts
git commit -m "test(web): playwright smoke for AI chat panel with stub provider"
```

---

## Task 25: Final verification

- [ ] **Step 1: Run the full test suite**

```
pnpm -r test
```

Expected: all packages green.

- [ ] **Step 2: Run typecheck and lint across the repo**

```
pnpm -r typecheck
pnpm -r lint
```

Expected: zero errors.

- [ ] **Step 3: Confirm the migration applies cleanly on a fresh database**

```
dropdb km_test --if-exists
createdb km_test
DATABASE_URL=postgres://localhost/km_test pnpm --filter @km/db exec prisma migrate deploy
```

Expected: all migrations apply, including `phase3_ai_integration`.

- [ ] **Step 4: Push the branch**

```
git push -u origin feat/phase3-ai-integration
```

Expected: branch published. Open a pull request titled `feat: phase 3 AI integration` referencing the spec.
