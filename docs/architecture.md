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

## Realtime

The `apps/realtime` service runs Hocuspocus on port 3001. When a user opens a note, the browser calls the `issueRealtimeToken` server action in `apps/web`, which verifies vault access and returns a short-lived HS256 JWT along with a matching `RealtimeGrant` row.

The browser opens a WebSocket to the realtime service, authenticated by that token. Hocuspocus's `onAuthenticate` hook verifies the signature, re-checks the `RealtimeGrant` is live, and re-asserts vault membership against Postgres (the JWT claim alone is not trusted).

While editing, client and server exchange Yjs updates. The server persists merged state into `NoteDoc.state`. A per-note debounce fires `snapshotNote(noteId)` five seconds after the last change and immediately when the last live connection drops. The snapshot helper compares the current Y.Doc text to `Note.content`; on difference, it opens a transaction that updates `Note.content`, `contentUpdatedAt`, `updatedById`, and calls `recomputeLinks` so `Link` rows stay in sync with wiki-link references.

Presence uses Y.Awareness. Each client writes `{ user: { id, name, color } }` into its local awareness state; `y-codemirror.next` paints remote carets and the `ActiveUsers` component lists everyone currently in the document.

## AI integration

Phase 3 introduced a server-mediated AI assistant. The browser never holds the model API key. All requests go through `/api/ai/chat` and `/api/ai/command`, both Server-Sent Events endpoints in the web app. Each request authenticates via `requireUserId()`, authorises with `assertCanAccessVault()`, and enforces a per-user daily budget with `enforceDailyBudget()` from `@km/ai`.

The provider is wrapped behind an `AiProvider` interface in `packages/ai`. The Anthropic implementation uses prompt caching for the system prompt and the active note context. A stub provider is selected when `AI_PROVIDER=stub`, used for unit tests and CI.

The tool runner in `packages/ai/src/runner.ts` drives a bounded loop of provider stream calls and tool executions. v1 tools are read-only and vault-scoped: `readNote`, `searchNotes`, `listBacklinks`. Each tool re-checks vault membership defensively before reading data.

### AI write tools

The AI runner exposes three write tools in addition to the read-only set. `createNote` and `createFolder` commit directly through Prisma from inside the `/api/ai/chat` SSE route using the same `assertCanAccessVault` path as human actions. `updateNote` does not touch Prisma directly; instead it POSTs a signed payload to `POST /internal/ydoc/apply` on `apps/realtime`, which mutates the live Y.Doc under the per-note mutex and enqueues a snapshot. The HMAC is keyed by `REALTIME_ADMIN_SECRET`, which is distinct from the JWT secret used for client WS auth.

After any write tool returns, the runner emits a `tool_result_undoable` SSE event carrying a summary and an undo token. The chat panel renders a 10-second Undo strip. Click calls `DELETE /api/notes/:id` or `DELETE /api/folders/:id`. For `updateNote`, the undo token is null and the user is pointed at the editor's Y.UndoManager (Ctrl-Z).

## Diagrams

Phase 4 added two kinds of diagram to each vault: drawio flow diagrams and BPMN process diagrams.

The `packages/diagrams` package owns all diagram UI code and lives next to the other shared packages in the monorepo. It exports `DrawioFrame`, `BpmnCanvas`, and helper utilities used by the web app.

**drawio vendoring.** The drawio editor is an offline web application. Rather than loading it from an external CDN, the repository ships a copy under `apps/web/public/drawio/`. That directory is populated by running `scripts/vendor-drawio.sh`, which copies the compiled drawio webapp from a local checkout of the jgraph/drawio repository. The `DrawioFrame` component renders the editor in a sandboxed iframe pointing at `/drawio/index.html` and communicates with it through `postMessage` using the bridge defined in `packages/diagrams/src/drawio/postMessageBridge.ts`. Saves are triggered by the `save` event the drawio app posts when the user saves, and they go through the standard `PATCH /api/diagrams/:id` route with optimistic concurrency checking.

**bpmn-js.** The BPMN editor uses the `bpmn-js` npm package rendered inside a `BpmnCanvas` component. `BpmnCanvas` is a forwardRef component that exposes a `save()` method returning the current diagram XML as a string. Saving is explicit: the user presses Save in the page header, which calls `save()` on the ref and sends the result to the same PATCH route.

**File tree.** The `FileTree` component reads from the updated `GET /api/vaults/:id/tree` response, which now returns an `items` array alongside the legacy `notes` array and `root` tree. Each item has a `kind` of `note`, `drawio`, or `bpmn`, and the tree renders notes and diagrams in the same list with distinct icons. Context menus on folders include entries to create a drawio diagram or a BPMN diagram in addition to the existing note creation entry.

**Wiki-link resolution.** Ctrl-clicking or Cmd-clicking a wiki-link in the editor calls `GET /api/links/resolve?vaultId=...&title=...`, which resolves the title to either a note or a diagram using note-wins tiebreak. The `recomputeLinks` function that runs on every save now populates `Link.targetDiagramId` when no note matches but a diagram does.

**Export.** The vault export worker includes diagrams in the zip archive alongside notes. Each drawio diagram is written as a `.drawio` file and each BPMN diagram as a `.bpmn` file, preserving the folder structure of the vault.

## Email

Outbound email is abstracted behind `@km/email`. The `sendEmail(payload)` function picks a provider based on `EMAIL_PROVIDER`. In `console` mode it logs the rendered message and returns a stub id. In `graph` mode it acquires a Microsoft Graph client-credentials access token (cached in process until one minute before expiry) and calls `POST /users/{mailbox}/sendMail`.

Web routes never call `sendEmail` directly. They insert any required rows (for example an `Invite` or a pending signup) and enqueue a `send-email` job on the existing pg-boss queue. The worker consumes the job, generates and persists an `EmailToken` (for VERIFY_EMAIL and PASSWORD_RESET), enforces a per `(email, kind)` rate limit of three sends per ten minutes, and invokes the provider. Terminal Graph errors (401, 403) fail the job without retry; 429 and 5xx responses rely on pg-boss backoff.

The `EmailToken` table stores sha256 hashes of raw tokens only. The raw token is included in the email link and is never persisted. Consuming a token computes the hash, looks up the row, checks expiry and `consumedAt`, then sets `consumedAt` and updates the relevant user field in the same transaction.

## Phase 5 polish

Phase 5 added full-text search, a tag system, a knowledge graph, a command palette, a plugin system, and dark mode. The detailed specification lives at `docs/superpowers/plans/2026-04-13-phase5-polish.md`.

### Search

Notes gain a `searchVector` generated column of type `tsvector` that is kept in sync by a Postgres trigger on `INSERT` and `UPDATE`. The trigger calls `to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content, ''))` and stores the result. Querying uses `websearch_to_tsquery('simple', ...)` so users can type natural phrases, quoted strings, and `OR` operators. Results are ranked with `ts_rank_cd` and snippets are generated with `ts_headline`. The search library lives in `apps/web/src/lib/search.ts` and is exposed through `GET /api/search?vaultId=...&q=...`.

### Tags

The `parseTags` pure function in `packages/shared/src/tags.ts` scans markdown for `#tag` patterns, skipping fenced code blocks and inline code. It returns `TagMatch` objects carrying the name, start offset, and end offset of each match. The `Tag` and `NoteTag` database tables are populated inside the same transaction that updates a note's content. `GET /api/vaults/:id/tags` returns all tags used in a vault ordered by note count. Individual tag pages at `/vault/:id/tags/:name` list notes that carry that tag.

### Knowledge graph

`GET /api/vaults/:id/graph` returns `{ nodes, edges }` describing all notes in the vault and the wiki-links between them. The graph page at `/vault/:id/graph` renders this data with Cytoscape.js using a force-directed layout. Nodes are coloured and sized based on their in-degree. Clicking a node navigates to that note.

### Command palette

The command palette opens on `Cmd+K` / `Ctrl+K`. It combines a live search of vault notes with static commands registered by the application (and by plugins). Results are rendered with `cmdk`. The palette uses a debounced fetch to `GET /api/search` so network requests are minimised while typing.

### Plugin system

Plugins are ESM bundles loaded at startup from URLs stored in the `UserPlugin` table. The loader in `apps/web/src/lib/plugins/loader.ts` validates each URL against an allow-list (same-origin is always allowed; additional origins are added through `NEXT_PUBLIC_PLUGIN_ALLOWLIST`). Each bundle must export a named `plugin` export conforming to `PluginDefinition` from `packages/shared`. On activation the loader calls `plugin.activate(ctx)` where `ctx` is a `PluginContext` instance that wires registrations into the `pluginRegistry` singleton. The registry is shared by the `StatusBar` and `CommandPalette` components. Settings at `/settings/plugins` let users add, disable, and remove plugin URLs.

### Dark mode

User theme preference (`light`, `dark`, or `system`) is stored in `User.themePreference`. The preference is written through `PATCH /api/me/theme` and read via a server component so the correct class is applied before the first paint, avoiding a flash of unstyled content. The `ThemeToggle` component in the top navigation bar cycles between the three options.
