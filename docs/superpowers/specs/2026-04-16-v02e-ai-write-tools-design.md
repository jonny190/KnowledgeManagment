# v0.2-E AI Write Tools

**Date:** 2026-04-16
**Status:** Approved design, ready for implementation planning
**Builds on:** v0.2.0 (Foundation + Phase 2-5 + email flows)

## Context

v0.1 shipped the AI chat panel and three read-only tools: `readNote`, `searchNotes`, `listBacklinks`. The assistant can discuss and summarise but cannot make any actual changes to the vault. Users consistently ask for "can you just create that note" during sessions. This phase adds a minimal set of write tools with a low-friction auto-apply-plus-undo model.

## Goals

- The AI can create notes, update note content, and create folders within the user's accessible vaults.
- Each write is auto-applied; the chat surfaces an "Undo" affordance that the user can click within 10 seconds.
- Note content edits flow through the realtime service so concurrent clients stay consistent with the CRDT state.
- Authorisation never loosens: every write goes through the same `assertCanAccessVault` helper as human actions.

Out of scope for v0.2-E:

- Delete tools (note or folder). Users do destructive work themselves.
- Linking tool; the model can insert `[[...]]` via `updateNote`.
- Attachment upload tools.
- Cross-vault operations.
- Partial streaming deltas from the AI into the Y.Doc. All updates are single whole-text operations.
- Per-tool user confirmation toggle.

## Stack additions

| Concern | Choice |
|---|---|
| New tools | `createNote`, `updateNote`, `createFolder` in `@km/ai` |
| Note-content write path | HMAC-signed internal endpoint on `apps/realtime` |
| Undo model | server executes immediately, chat shows Undo link for 10s; click calls existing DELETE API |
| New env var | `REALTIME_ADMIN_SECRET` shared by `apps/web` and `apps/realtime` |
| No schema changes | This phase does not add tables or columns |

## System shape

```
AI chat turn
     │
     ▼
 @km/ai tool-runner (server-side, in apps/web SSE route)
     │
     ├──► createNote   ─► prisma tx: Note + recomputeLinksAndTags
     │                    ─► returns { noteId, undo: { kind: "create_note", id } }
     │
     ├──► createFolder ─► prisma: Folder with denormalised path
     │                    ─► returns { folderId, undo: { kind: "create_folder", id } }
     │
     └──► updateNote   ─► POST {realtime}/internal/ydoc/apply
                          (HMAC header: sha256(secret, body))
                          realtime applies to in-memory Y.Doc +
                          triggers debounced snapshot
                          ─► returns { noteId, undo: null }
```

The runner emits a new SSE event `tool_result_undoable` after each successful write. The chat panel renders a 10-second Undo strip; click calls the existing `DELETE /api/notes/:id` or `DELETE /api/folders/:id`.

## Tool contracts

### `createNote`

**Input zod schema**
```ts
{
  vaultId: string.cuid(),
  title: string.min(1).max(200),
  content: string.max(100_000).optional(),
  folderId: string.cuid().optional(),
}
```

**Behaviour**
- `assertCanAccessVault(userId, vaultId, "MEMBER")`.
- Slug generation: `slugify(title)` plus a suffix loop against `Note.unique(vaultId, slug)`.
- Prisma transaction creates the `Note` row and, if `content` is non-empty, runs `recomputeLinksAndTags(tx, noteId, vaultId, content)` so Link and NoteTag are populated in the same transaction the human PATCH route uses.
- Returns `{ noteId, title, slug, undo: { kind: "create_note", id: noteId } }`.

### `updateNote`

**Input zod schema**
```ts
{
  noteId: string.cuid(),
  content: string.max(100_000),
  mode: enum("append", "replace"),
}
```

**Behaviour**
- Look up the note; if not found, tool returns a typed error.
- `assertCanAccessVault(userId, note.vaultId, "MEMBER")`.
- POST to realtime `applyAdminUpdate`, signed with `REALTIME_ADMIN_SECRET`.
- On success, returns `{ noteId, undo: null }`.
- Client-side, the editor's `Y.UndoManager` treats the admin update like any other Y.Text mutation, so Ctrl-Z undoes it.

### `createFolder`

**Input zod schema**
```ts
{
  vaultId: string.cuid(),
  name: string.min(1).max(120),
  parentId: string.cuid().optional(),
}
```

**Behaviour**
- `assertCanAccessVault(userId, vaultId, "MEMBER")`.
- Compute path: if `parentId` provided, read parent's path and use `computeChildPath`. Otherwise parent is the vault root.
- Create the `Folder` row.
- Returns `{ folderId, path, undo: { kind: "create_folder", id: folderId } }`.

All three tools are added to `ALL_TOOLS` in `@km/ai`. The system prompt (`packages/ai/src/prompts.ts`) gains a short section explaining that write tools exist, that updateNote should prefer `append` unless the user asked for a rewrite, and that link syntax `[[Note Title]]` is the way to reference other notes.

## Realtime admin endpoint

**Route:** `POST /internal/ydoc/apply` on port 3001

**Headers**
- `Content-Type: application/json`
- `X-KM-Admin-Signature: HMAC-SHA256(REALTIME_ADMIN_SECRET, rawBody)`

**Body**
```json
{ "noteId": "...", "op": "append" | "replace", "text": "...", "origin": "ai" }
```

**Responses**
- 200 `{ applied: true, revision: <int> }`
- 401 signature missing or mismatch
- 404 note has no `NoteDoc` row and `op` is `replace` on a never-opened note (edge case; in practice `replace` is rare for AI)

**Implementation**
- New file `apps/realtime/src/admin.ts`:
  - Exports `applyAdminUpdate({ noteId, op, text })`.
  - Acquires the per-note mutex used by `snapshotNote`.
  - Loads the live Y.Doc from Hocuspocus if connected clients exist; otherwise hydrates a transient Y.Doc from `NoteDoc.state` (creating an empty one if the row does not exist).
  - Mutates `doc.getText("content")`:
    - `append`: `ytext.insert(ytext.length, text)`
    - `replace`: `ytext.delete(0, ytext.length); ytext.insert(0, text)`
  - If the doc is attached to Hocuspocus, the change broadcasts to connected clients automatically; if transient, persist via the standard Database extension upsert.
  - Enqueues a snapshot via the existing `queueSnapshot(noteId)` helper.
- New file `apps/realtime/src/admin-http.ts`:
  - Starts a small `node:http` listener on `/internal/ydoc/apply`.
  - Uses `crypto.timingSafeEqual` for HMAC verification.
  - Mounted in `startServer` on the same port Hocuspocus uses (Hocuspocus exposes a `handleRequest` hook; admin endpoint runs alongside or on a side channel).

**Rate limit**
- The per-note mutex naturally serialises concurrent calls. No additional quota in v0.2-E.

**Security**
- `REALTIME_ADMIN_SECRET` is distinct from `REALTIME_JWT_SECRET`.
- Only `apps/web` (server-side) ever holds the admin secret.
- Internal path `/internal/*` is not exposed publicly in the Coolify runbook's Cloudflare config.

## Chat UI with undo

### SSE event grammar

Add to `aiSseEvent` in `@km/shared`:

```ts
{
  type: "tool_result_undoable",
  callId: string,
  undo: { kind: "create_note" | "create_folder", id: string } | null,
  summary: string,
}
```

### Client components

- `apps/web/src/components/ai/ChatUndoStrip.tsx` — renders `summary` + optional Undo button + 10-second countdown. On click it calls `DELETE /api/notes/:id` or `DELETE /api/folders/:id` based on `undo.kind`. On success the strip becomes a dim confirmation.
- `AiChatPanel` subscribes to the new event and pushes the strip into the chat scroll like any other message.

### updateNote undo

For `updateNote` the strip's `undo` is `null` and the summary reads: "Updated 'X'. Use Ctrl-Z in the editor to revert." The editor's existing `Y.UndoManager` sees the Y.Text mutation and can roll it back normally.

## Deployment

- `.env.example`, `infra/coolify/env.example`: add `REALTIME_ADMIN_SECRET=`.
- `infra/docker/docker-compose.prod.yml`: same env key in both `web` and `realtime` service blocks.
- Coolify runbook: one paragraph explaining that `/internal/*` on the realtime container must stay off the public route map. Cloudflare config already routes only `/yjs` publicly; confirm in the guide.

## Testing

- **Unit (Vitest):**
  - `@km/ai` tests for each new tool's input validation and result shape, with a Prisma mock for createNote/createFolder and a fetch mock for updateNote's admin POST.
  - `apps/realtime/src/admin.test.ts` for `applyAdminUpdate` correctness (`append`, `replace`, mutex serialisation, snapshot enqueue) and HMAC verify helper.
- **Integration (real Postgres + in-process Hocuspocus):**
  - `apps/web/tests/integration/ai-write-tools.test.ts` drives the SSE chat route with a stub provider that emits tool calls for each of the three tools; asserts DB state and the SSE event stream.
  - `apps/realtime/test/admin.int.test.ts` runs a Hocuspocus server + admin endpoint, POSTs a signed payload, opens a Y.Doc client, asserts text converged.
- **E2E (Playwright):**
  - Extend `ai-chat.spec.ts`: ask the stub provider to create a note titled 'From Chat', assert it appears in the tree, assert the Undo strip is visible, click Undo, assert the note disappears.

## Documentation

- `docs/architecture.md` — new subsection "AI write tools" under AI: which tools exist, the create-vs-update paths, the HMAC admin endpoint.
- `docs/api.md` — document `POST /internal/ydoc/apply`, clearly marked as internal, with the signature scheme.
- `docs/deployment.md` — add `REALTIME_ADMIN_SECRET` to the env table.
- `guides/ai-chat.md` — user-facing paragraph: the assistant can now create notes and folders and edit note content; every new note/folder can be undone for 10 seconds; edits are undone with Ctrl-Z in the editor.

## Open items deferred to implementation

- Exact placement of admin HTTP listener inside `startServer` (Hocuspocus `handleRequest` vs separate `http.createServer`).
- Whether to expose a machine-readable "origin" field on Y.Doc updates so the UI can eventually attribute changes to the AI (design decision noted; not wired in v0.2-E).
- The stub provider's mechanism for emitting forced tool calls for integration tests; if needed, add a `stubToolCallMode` option in `packages/ai/src/providers/stub.ts`.
