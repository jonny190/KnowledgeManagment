# Phase 2 — Realtime Collaboration

**Date:** 2026-04-13
**Status:** Approved design, ready for implementation planning
**Sub-project:** 2 of 5 (Realtime collaboration)
**Builds on:** Foundation (Plans A through D, merged to `main`)

## Context

The Foundation sub-project delivered a single-user-at-a-time editing experience: one user edits a note, debounced autosave PATCHes the content, and the `Link` table is recomputed in the same transaction. Two users opening the same note today would overwrite each other.

Phase 2 adds true realtime multi-user editing with CRDT merging, presence (cursors, selections, names, active-users list), and clean integration with the existing backlinks, search, and export paths.

## Goals

- Two or more users can edit the same note concurrently with no lost writes.
- Each user sees others' cursors, text selections, and names in real time.
- A sidebar lists everyone currently in the note.
- Backlinks, search, and export continue to work against a server-side markdown snapshot that stays in sync with the CRDT state.
- Authentication and vault-membership authorisation continue to hold over the realtime channel.

Out of scope for this phase:

- Server-side undo / history log (local Yjs undo only).
- Per-note ACLs beyond workspace membership.
- Typing indicators.
- Rate limiting on realtime connections.
- Full PWA / offline-first; we ship `y-indexeddb` tab-restore only.

## Stack additions

| Concern | Choice |
|---|---|
| CRDT | Yjs |
| WebSocket server | Hocuspocus (production-grade Yjs server with auth hooks and persistence plugins) |
| CM6 binding | `y-codemirror.next` |
| Transport | WebSocket, proxied over Cloudflare |
| Token format | HS256 JWT with a distinct secret from `NEXTAUTH_SECRET` |
| Local cache | `y-indexeddb` (tab-restore on reload) |

## System shape

A new workspace app `apps/realtime` joins `apps/web` and `apps/worker`:

```
apps/
├── web/         Next.js, request-response paths unchanged
├── worker/      pg-boss consumer for exports, unchanged
└── realtime/    Hocuspocus server on :3001 (new)
```

Data flow for an open note:

```
Browser A ─┐
Browser B ─┼──► wss://host/yjs/<noteId> ──► Hocuspocus ──► Y.Doc in memory
Browser C ─┘                                     │
                                                  ├──► persist binary to NoteDoc row
                                                  └──► debounced snapshot → Note.content
                                                           └──► link recompute (same tx)
```

Non-realtime routes in `apps/web` are untouched: signup, workspace creation, invite flow, file tree, note metadata, attachment upload, exports. The single change is that the note page (`/vault/[vaultId]/note/[noteId]`) opens a WebSocket to `apps/realtime` for the note body; the previous debounced PATCH of note content is removed.

## Data model changes

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

Design notes:

- `NoteDoc` stores the merged Y.Doc state. We do not keep an append-only update log in this phase; Yjs CRDT merge semantics make the merged state sufficient.
- `NoteDoc` rows are not deleted when a note has zero live clients. The CRDT state is the authoritative source of truth, so it must survive empty-room transitions.
- `RealtimeGrant` gives us a revocation backstop for issued tokens without relying on JWT expiry alone. Every connection checks `revokedAt IS NULL AND expiresAt > now()`.
- `Note.content` and the `Link` table are unchanged in shape. Their writes move from the PATCH handler to a snapshot helper invoked by the realtime service.

## Authentication flow

**Issuance (web).** When a user opens a note, a server action `issueRealtimeToken(noteId)`:

1. Calls `requireUserId()`.
2. Calls `assertCanAccessVault(userId, note.vaultId, "MEMBER")`.
3. Generates a `jti` with `nanoid(21)`.
4. Signs a JWT with `REALTIME_JWT_SECRET`:
   ```json
   { "jti": "<nanoid>", "sub": userId, "nid": noteId, "vid": vaultId, "role": "MEMBER|ADMIN|OWNER", "exp": now + 300 }
   ```
5. Inserts a `RealtimeGrant` row with matching `jti`, `userId`, `noteId`, `expiresAt`.
6. Returns the JWT to the browser.

Token TTL is 5 minutes. The client silently refreshes every 4 minutes while the socket is open.

**Connect (realtime).** The browser opens `wss://host/yjs/<noteId>?token=<jwt>`. Hocuspocus's `onAuthenticate` hook:

1. Verifies the JWT signature and `exp` with the shared secret.
2. Asserts the path `noteId` matches the JWT `nid` (prevents cross-note token reuse).
3. Looks up the `RealtimeGrant` by `jti`, rejects if revoked or expired.
4. Re-calls `assertCanAccessVault(userId, vaultId, "MEMBER")` against Postgres. Membership may have been revoked since issuance, so the JWT claim is not trusted alone.
5. Attaches `{ userId, role }` to the connection context for later hooks.

Rejections close the socket with a descriptive close code. The client surfaces "session ended, reconnect or log in again".

## Yjs integration

### Client

A new optional CodeMirror extension in `packages/editor`:

- `packages/editor/src/collab.ts` exports `collabExtension({ ytext, awareness })` returning the composition `yCollab(ytext, awareness)` from `y-codemirror.next`.
- `packages/editor/src/index.ts` re-exports `collabExtension`.

A new client-side module in `apps/web`:

- `apps/web/src/components/CollabSession.ts` exposes `useCollabSession({ noteId, user })` returning `{ doc, provider, awareness, status }`:
  1. Calls the `issueRealtimeToken` server action to get a JWT.
  2. Builds a `Y.Doc`, wraps it in a `y-indexeddb` persistence provider keyed by `noteId`, and creates a `HocuspocusProvider({ url: NEXT_PUBLIC_REALTIME_URL, name: noteId, token, document })`.
  3. Seeds local awareness with `{ user: { id, name, color } }`.
  4. Handles token refresh on a 4-minute interval and socket status changes.

The note page (`apps/web/src/app/(app)/vault/[vaultId]/note/[noteId]/page.tsx`) mounts `NoteEditor` with the collab extension once the session is ready. The previous `useDebouncedAutosave` for content is removed from this page; title and folder changes still go through `PATCH /api/notes/:id`.

### Server

`apps/realtime/src/server.ts`:

- Creates a Hocuspocus server listening on `:3001`.
- Registers extensions:
  - `Database` extension: `fetch(documentName)` returns `NoteDoc.state`; `store({ document, state })` upserts it. Hocuspocus handles debouncing of `store` calls.
  - Custom `onAuthenticate` hook implementing the connect flow above.
  - Custom `onChange` hook that captures `lastEditorUserId` per `documentName` and enqueues a debounced snapshot.
  - Custom `onDisconnect` hook that flushes a snapshot immediately when `documentName` has zero live connections.

`apps/realtime/src/snapshot.ts` owns the snapshot pipeline (next section).
`apps/realtime/src/prisma.ts` re-exports `@km/db`.
`apps/realtime/src/auth.ts` holds JWT verification and grant-lookup helpers.

## Presence

Using `Y.Awareness` bundled with Hocuspocus. No new tables; awareness state is ephemeral and in-memory on the server.

- Each client sets local awareness to `{ user: { id, name, color }, cursor: null, selection: null }`. `cursor` and `selection` are populated by `y-codemirror.next`.
- `y-codemirror.next` renders remote carets with a coloured selection highlight and a small name label floating above each caret.
- A new `apps/web/src/components/ActiveUsers.tsx` component subscribes to `awareness.on("change", ...)` and renders one avatar per live state. Mounted in the note page header.
- Colour assignment is deterministic: `hsl(hash(userId) % 360, 70%, 50%)`. No server-side colour registry.

## Snapshot pipeline

Triggered by:

- `onChange` with a 5-second idle debounce per `noteId`.
- `onDisconnect` when the last connection for a `noteId` drops, which forces an immediate snapshot.

`apps/realtime/src/snapshot.ts` exports `snapshotNote(noteId: string): Promise<void>`:

1. Acquire a per-note async mutex. Different notes snapshot in parallel; the same note never has two overlapping snapshots.
2. Load the current Y.Doc. Prefer the in-memory instance Hocuspocus already has; fall back to loading `NoteDoc.state` if evicted.
3. `const markdown = doc.getText("content").toString()`.
4. Read `Note.content` for this note. If equal to `markdown`, release mutex and return.
5. Open a Prisma transaction:
   a. `note.update({ where: { id: noteId }, data: { content: markdown, contentUpdatedAt: new Date(), updatedById: lastEditorUserId } })`.
   b. `const parsed = parseWikiLinks(markdown)`.
   c. Resolve target note ids by title in the same vault.
   d. `link.deleteMany({ where: { sourceNoteId: noteId } })`.
   e. `link.createMany({ data: parsed.map(...) })`.
6. On transaction failure, log, wait 500 ms, retry once. If still failing, emit an error metric. The Y.Doc state is untouched so a later snapshot can try again.

`lastEditorUserId` is captured in `onChange` by mapping the Hocuspocus `context.userId` at change time. If it is unset for some reason (e.g. snapshot triggered before any edit), fall back to `note.updatedById` unchanged.

The link-recomputation logic moves into a new helper `apps/web/src/lib/links.ts` exporting `recomputeLinks(tx, noteId, vaultId, markdown)`. The existing `PATCH /api/notes/:id` content branch is removed; the route remains for title and folder changes. The snapshot helper calls the same `recomputeLinks` helper so the link logic lives in exactly one place.

## Deployment

**Docker and Coolify:**

- `infra/docker/Dockerfile.realtime` — multi-stage Node production build for `apps/realtime`.
- `infra/docker/docker-compose.prod.yml` — add a `realtime` service exposing `3001` internally; depends on Postgres.
- `infra/coolify/README.md` — add a "Realtime service" section. Point out that Cloudflare Proxy requires "WebSockets" enabled for the route (`wss://app.<host>/yjs`). Per global rules, services remain HTTP behind the Cloudflare proxy.

**Environment variables (new):**

- `REALTIME_JWT_SECRET` — HS256 secret shared by `apps/web` and `apps/realtime`.
- `NEXT_PUBLIC_REALTIME_URL` — WebSocket URL the browser uses (e.g. `wss://app.example.com/yjs`).
- `DATABASE_URL` — already set; realtime reads the same database.

`REALTIME_JWT_SECRET` is kept distinct from `NEXTAUTH_SECRET` so rotating one does not invalidate the other.

**Migrations:** two new tables (`NoteDoc`, `RealtimeGrant`). One Prisma migration named `phase2-realtime` adds both.

## Testing

- **Unit (Vitest):**
  - `packages/editor/src/collab.test.ts` for extension composition.
  - `apps/realtime/test/snapshot.test.ts` for the mutex, the no-op-on-unchanged fast path, and the link-recompute transaction.
  - `apps/realtime/test/auth.test.ts` for JWT verification, path-vs-claim mismatch, grant lookup, vault-access re-check.
- **Integration (Vitest + real Postgres):**
  - Spawn Hocuspocus in-process. Connect two Yjs clients, edit concurrently, assert convergence and that `NoteDoc.state` and `Note.content` end up correct after snapshot.
  - Connect with invalid, expired, and revoked tokens. Assert rejection.
  - Connect as a non-member of the vault. Assert rejection at the vault re-check step.
- **E2E (Playwright):**
  - Two browser contexts open the same note. Type in context A, assert the text appears in context B within one second. Assert the caret from A is visible in B with the correct name label. Assert the `ActiveUsers` component shows two entries.

## Documentation and guides

- `docs/architecture.md` — add "Realtime" section covering the new service, the snapshot pipeline, and the auth handshake.
- `docs/data-model.md` — document `NoteDoc` and `RealtimeGrant`.
- `docs/deployment.md` — add Coolify realtime-service setup and the Cloudflare "WebSockets enabled" note.
- `guides/collaboration.md` — new end-user guide.

## Open items deferred to implementation

- Exact Hocuspocus Database extension API details may prompt a thin adapter file.
- E2E test may require running Hocuspocus via a second `webServer` entry in `playwright.config.ts`. Decide whether to compose with the existing Next.js `webServer` or launch manually.
- Colour-palette tuning for readability (lightness, saturation) will be finalised during implementation.
