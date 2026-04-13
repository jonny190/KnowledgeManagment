# Phase 3: AI Integration

**Date:** 2026-04-13
**Status:** Approved design, ready for implementation planning
**Sub-project:** 3 of 5 (AI integration)
**Builds on:** Foundation (Plans A through D) and Phase 2 (Realtime), merged to `main`

## Context

The Foundation gave us per-vault notes, wiki-links, backlinks, and exports. Phase 2 layered Yjs realtime editing on top so several users can co-author the same note. Phase 3 brings an LLM into the workspace as a writing collaborator: a chat panel docked on the note view, plus inline slash commands inside the editor that act on the current selection or block.

Everything is server mediated. The browser never sees the model API key, never picks the model, and never talks to Anthropic directly. All vault-aware logic (which notes the AI can read, who is allowed to ask it, how much it can spend) runs behind the existing `requireUserId()` and `assertCanAccessVault()` helpers.

We deliberately keep the AI in a "suggest, never mutate" stance for v1. The model can read across the active vault but cannot write, rename, or delete anything. Edits land in the editor only when a human accepts a suggestion.

## Goals

Signed-in users with access to a vault can:

- Open a chat panel beside any note and have a streamed conversation with Claude that knows about the note's current contents.
- Let the assistant fetch other notes in the same vault by title, search note titles, and inspect backlinks for a note, with each tool call surfaced in the UI.
- Trigger inline slash commands (`/summarize`, `/expand`, `/rewrite`, `/translate`) from the editor that operate on the current selection or block and stream the result back into a chat message they can apply manually.
- See per-day token usage and hit a hard daily cap before the model is called.

Out of scope for this phase, deferred to later work:

- Write tools (the AI editing notes itself).
- Multi-provider routing or per-user model selection in the UI.
- Embeddings, vector search, retrieval beyond title prefix and backlink lookup.
- Image input or image generation.
- Conversation sharing across users.
- Per-workspace billing, cost dashboards, or admin-tier limits.
- Voice input, audio output.
- Server-side prompt evaluation harness.

## Stack additions

| Concern | Choice |
|---|---|
| Provider | Anthropic Claude (default model configurable, `claude-opus-4-6` or `claude-sonnet-4-5`) |
| SDK | `@anthropic-ai/sdk` |
| Streaming transport | Server-Sent Events over a Next.js route handler |
| Chat markdown rendering | `react-markdown` + `remark-gfm` + `rehype-highlight` |
| Inline command extension | New `aiCommands` extension in `@km/editor` |
| Rate limiting | Postgres-backed counter, no Redis |
| Prompt caching | Anthropic prompt cache (`cache_control: { type: "ephemeral" }`) on system prompt and large note context blocks |

The provider client is wrapped behind a thin internal abstraction (`AiProvider`) so an OpenAI implementation can drop in later without touching call sites.

## System shape

No new app process. AI lives inside `apps/web` plus a small package:

```
apps/
├── web/         AI route handlers, chat panel, server-side provider client
├── worker/      unchanged
└── realtime/    unchanged

packages/
├── ai/          NEW. AiProvider abstraction, Anthropic client, tool definitions, rate-limit helper
├── editor/      adds aiCommands extension
├── shared/      adds AI request/response zod schemas
└── db/          adds AiConversation, AiMessage, AiUsage tables
```

Request flow for a chat turn:

```
Browser ── POST /api/ai/chat (SSE) ──► Next.js route handler
                                              │
                                              ├── requireUserId + assertCanAccessVault
                                              ├── enforceDailyBudget(userId)
                                              ├── load AiConversation history
                                              ├── build messages + system prompt + tool defs
                                              └── stream from packages/ai
                                                       │
                                                       ├── Anthropic Messages API (stream)
                                                       ├── on tool_use: run readNote / searchNotes / listBacklinks (vault-scoped)
                                                       └── persist AiMessage rows + AiUsage rows
                                              ◄── token deltas streamed back as SSE events
```

Inline slash commands reuse the same route, with a synthesised user message templated server-side from the command name and the selected text.

## Data model changes

Three new Postgres tables, all owned by `packages/db`. One Prisma migration named `phase3_ai_integration`.

```prisma
model AiConversation {
  id        String   @id @default(cuid())
  vaultId   String
  noteId    String?
  createdById String
  title     String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  vault    Vault     @relation(fields: [vaultId], references: [id], onDelete: Cascade)
  note     Note?     @relation(fields: [noteId], references: [id], onDelete: SetNull)
  createdBy User     @relation(fields: [createdById], references: [id])
  messages AiMessage[]

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

enum AiRole {
  USER
  ASSISTANT
  TOOL
  SYSTEM
}

model AiUsage {
  id           String   @id @default(cuid())
  userId       String
  vaultId      String
  day          DateTime @db.Date
  inputTokens  Int      @default(0)
  outputTokens Int      @default(0)
  requests     Int      @default(0)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  user  User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  vault Vault @relation(fields: [vaultId], references: [id], onDelete: Cascade)

  @@unique([userId, day])
  @@index([vaultId, day])
}
```

Design notes:

- `AiMessage.content` is stored as JSON to preserve the Anthropic block structure (`text`, `tool_use`, `tool_result`). Re-rendering uses the structure rather than re-parsing markdown out of a flat string.
- `toolCalls` mirrors the tool blocks for fast UI summarisation without scanning `content` deeply.
- Tokens are counted on the assistant turn (`outputTokens`) and on the request as charged (`inputTokens`, `cachedTokens`). Anthropic returns these in the `message.usage` payload at stream end.
- `AiUsage` is keyed by `(userId, day)` so the daily-cap query is a single point lookup. Vault is recorded for future per-vault reporting but is not part of the unique key.
- `AiConversation.noteId` is nullable so a future "vault-wide chat" can reuse the same table.
- Cascade rules: deleting a vault deletes its conversations and usage rows; deleting a note nulls out the conversation's `noteId` rather than deleting (the user may want to keep the chat).

## Auth and rate limits

Every AI request goes through three checks at the top of the route handler, in order:

1. `const userId = await requireUserId()`.
2. `await assertCanAccessVault(userId, vaultId, "MEMBER")`.
3. `await enforceDailyBudget(userId)` from `@km/ai`.

`enforceDailyBudget(userId)` reads the user's `AiUsage` row for `today` (UTC) and throws an `AiBudgetExceededError` if `inputTokens + outputTokens >= AI_DAILY_TOKEN_LIMIT` or `requests >= AI_DAILY_REQUEST_LIMIT`. Limits come from environment variables with sane defaults (`AI_DAILY_TOKEN_LIMIT=200000`, `AI_DAILY_REQUEST_LIMIT=200`). The check runs before any model call.

After each completed model response, `recordUsage({ userId, vaultId, inputTokens, outputTokens, cachedTokens })` upserts the day row in a single statement. The route handler always records usage in a `finally` block, even when streaming aborts mid-flight, so partial output is still counted.

`AiBudgetExceededError` surfaces as HTTP 429 with a JSON body the chat panel renders as a friendly inline message.

The provider key (`ANTHROPIC_API_KEY`) is server-only, read once in `packages/ai`. It is never exposed via `NEXT_PUBLIC_*` and never returned to the browser. The browser only sees streamed tokens and structured tool-result events.

## Chat panel UX

A new component `apps/web/src/components/AiChatPanel.tsx` renders to the right of the editor on the note page. The panel is collapsed by default; a toolbar button toggles it.

Behaviour:

- The first time the panel opens for a given note, the server creates an `AiConversation` row scoped to `(vaultId, noteId, userId)`. Subsequent opens load the existing conversation. Switching notes loads a different conversation.
- Messages render in chronological order. The bottom is a textarea plus a send button. `Cmd/Ctrl+Enter` sends.
- Assistant messages render markdown with `react-markdown`, GFM tables, and `rehype-highlight` for fenced code. Long responses scroll within the panel.
- Tool calls render as a collapsible card showing the tool name, arguments, and a truncated result preview. Clicking expands the full JSON.
- A small header strip shows the model name, today's token usage as `used / limit`, and a "New chat" button that archives the current conversation and starts a fresh one.
- Errors (budget, network, model) render as a red inline message with a retry button. Retries do not double-charge: the route only records usage on successful provider responses.

The panel mounts only when the note page has a stable note id, so it does not interfere with the realtime collab session.

## Inline commands

Inline commands live in `packages/editor/src/aiCommands.ts`, exported as `aiCommands(options)`.

Commands in v1: `/summarize`, `/expand`, `/rewrite`, `/translate`.

Editor behaviour:

- Typing `/` at the start of a line opens an autocomplete listing the available commands with one-line descriptions.
- Selecting a command prompts for arguments where relevant. `/translate` shows a small inline field for the target language; the others run immediately.
- The command captures the current selection. If no selection exists, it captures the current block (paragraph or list item under the cursor).
- The command does not modify the buffer. It calls the chat panel via a registered `onAiCommand` callback supplied by `apps/web`. The panel opens (if collapsed), inserts a system-rendered "command card" in the conversation showing the command, the captured text, and any arguments, and posts a server request that turns into a pre-templated user message.

Command-to-prompt templating happens server-side in `packages/ai/src/commands.ts` so the editor stays UI-only and the prompts can evolve without a client release. Templates take `{ selection, language?, fullNote? }` and return a Markdown user message.

The user can copy or click "Apply at cursor" on the assistant response. "Apply at cursor" replaces the captured selection with the assistant's text via the existing CodeMirror collab transaction (the change participates in the Yjs document like any other edit).

## Tool calls

Tools defined in `packages/ai/src/tools.ts`. Each tool has a Zod schema for arguments, an Anthropic-shaped JSON schema generated from the Zod schema, and an executor function `(args, ctx) => Promise<unknown>` where `ctx` carries `{ userId, vaultId, prisma }`.

v1 tools:

```
readNote({ title: string })
  → Resolves the note by exact title match within ctx.vaultId.
  → Returns { id, title, content, updatedAt } or { error: "not_found" }.

searchNotes({ query: string, limit?: number })
  → Title prefix search within ctx.vaultId, case-insensitive, default limit 10.
  → Returns Array<{ id, title, snippet }>.

listBacklinks({ noteId: string })
  → Verifies the noteId belongs to ctx.vaultId.
  → Returns Array<{ sourceNoteId, sourceTitle, snippet }>.
```

Every tool executor runs `assertCanAccessVault(ctx.userId, ctx.vaultId, "MEMBER")` defensively before its first DB read. There is no path by which a tool reaches a different vault: the vault is bound when the conversation starts and is the only vault id passed into the tool runner.

The route handler runs an inner loop over the streamed Anthropic response:

1. Open a stream.
2. For each `tool_use` block emitted, look up the tool, validate arguments through Zod, run it, push a `tool_result` block, and continue the conversation. The runtime caps tool iterations at `AI_MAX_TOOL_HOPS=8` to bound runaway loops.
3. Flush the final assistant message, persist `AiMessage` rows for every turn (including tool calls and results), and record usage.

Write tools are explicitly out of scope. The system prompt instructs the model to suggest edits as proposed text in its final answer rather than calling a tool to mutate notes.

## Streaming

Streaming uses Server-Sent Events from `POST /api/ai/chat` and `POST /api/ai/command`.

Event types emitted by the server:

```
event: ready          { conversationId, messageId }
event: text           { delta: string }
event: tool_use       { id, name, args }
event: tool_result    { id, ok: boolean, result?: unknown, error?: string }
event: usage          { inputTokens, outputTokens, cachedTokens, model }
event: done           {}
event: error          { code, message }
```

The browser uses a small SSE client (`apps/web/src/lib/sse.ts`) built on `fetch` + `ReadableStream` rather than the older `EventSource` API, so it can send `POST` bodies and standard auth cookies.

If the client disconnects mid-stream, an `AbortController` cancels the upstream Anthropic call and the route still runs its `finally` block to record partial usage. Persisted `AiMessage` rows mark `content.partial = true` so the UI can flag truncated answers when the conversation reloads.

## Prompt caching

Two cache breakpoints per request, in this order:

1. The system prompt (stable across all turns of a conversation, edits in source require a deploy).
2. The current note context block: `# Active note\n\n## Title\n${title}\n\n## Body\n${body}`.

Both are sent with `cache_control: { type: "ephemeral" }`. Subsequent turns of the same conversation reuse the cache as long as the note body has not been edited; a hash of the note body is compared turn-to-turn, and on mismatch the cache breakpoint is rebuilt.

Tool definitions are not cached separately; they are stable across the deploy and small enough to ride inside the system prompt cache window.

`cachedTokens` from the response is recorded into `AiMessage.cachedTokens` and into `AiUsage.cachedTokens` for visibility.

## Deployment

No new service. Adds env vars to existing `web` deployment.

New environment variables:

- `ANTHROPIC_API_KEY`: required. Server-only.
- `AI_MODEL`: default `claude-opus-4-6`. Configurable per environment.
- `AI_DAILY_TOKEN_LIMIT`: default `200000`.
- `AI_DAILY_REQUEST_LIMIT`: default `200`.
- `AI_MAX_TOOL_HOPS`: default `8`.

`infra/coolify/README.md` adds an "AI integration" section noting these env vars and confirming no new container is required. The Cloudflare proxy already supports SSE so no proxy config changes are needed.

`infra/docker/Dockerfile.web` does not change beyond a `pnpm install` that picks up `@anthropic-ai/sdk` as a new web dependency.

## Testing

- **Unit (Vitest):**
  - `packages/ai/test/commands.test.ts` for command-to-prompt templating across all four commands.
  - `packages/ai/test/tools.test.ts` for `readNote`, `searchNotes`, `listBacklinks` against a real Postgres test database. Includes a cross-vault attempt that must throw at the `assertCanAccessVault` re-check.
  - `packages/ai/test/budget.test.ts` for `enforceDailyBudget` and `recordUsage` upsert semantics across midnight (UTC day rollover).
  - `packages/editor/test/aiCommands.test.ts` for the slash-command extension state.
- **Integration (Vitest + real Postgres + mocked Anthropic transport):**
  - `apps/web/test/api/ai-chat.test.ts` exercises the SSE route end-to-end with a fake provider that emits a deterministic script of `text` and `tool_use` chunks. Asserts persisted `AiMessage` rows, `AiUsage` increments, abort handling, and tool-hop cap.
  - `apps/web/test/api/ai-command.test.ts` exercises `/api/ai/command` with each of the four commands.
- **E2E (Playwright):**
  - `apps/web/playwright/ai-chat.spec.ts` opens a note, opens the panel, asks "summarise this note", asserts streamed text appears in the panel, asserts a `usage` event updates the header counter. The provider is stubbed in test mode behind an `AI_PROVIDER=stub` env var so CI does not call the real API.

CI gains a new test job `ai` that runs unit + integration with `AI_PROVIDER=stub`. The stub provider lives in `packages/ai/src/providers/stub.ts` and is selected at runtime when `AI_PROVIDER === "stub"`.

## Documentation and guides

- `docs/architecture.md`: add an "AI integration" section describing the route, tool runner, streaming, budget, and where the provider abstraction lives.
- `docs/data-model.md`: document `AiConversation`, `AiMessage`, `AiUsage` and the `AiRole` enum.
- `docs/deployment.md`: add the AI env vars and confirm no new container.
- `docs/api.md`: add `POST /api/ai/chat` and `POST /api/ai/command` with their SSE event grammar.
- `guides/ai-chat.md`: new end-user guide covering opening the panel, asking questions, what the assistant can read, and the daily limit.
- `guides/ai-inline-commands.md`: new end-user guide covering each slash command and the "Apply at cursor" affordance.

Per the user's global rules, all docs and guides are written naturally, with no emojis or special characters, and no em dashes.

## Open items deferred to implementation

- Exact Tailwind layout for the chat panel (width, breakpoints, mobile collapse).
- Whether `AiMessage.content` should be additionally validated by a Zod discriminated union at write time, or trusted as the SDK shape.
- Final wording of the system prompt (kept versioned in `packages/ai/src/prompts.ts`).
- Whether to add a "compact conversation" action in v1 or defer to a later phase once we see real usage.
- Decision on per-conversation soft cap (separate from the daily cap) once we observe typical conversation lengths.
