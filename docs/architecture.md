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

## Diagrams

Phase 4 added two kinds of diagram to each vault: drawio flow diagrams and BPMN process diagrams.

The `packages/diagrams` package owns all diagram UI code and lives next to the other shared packages in the monorepo. It exports `DrawioFrame`, `BpmnCanvas`, and helper utilities used by the web app.

**drawio vendoring.** The drawio editor is an offline web application. Rather than loading it from an external CDN, the repository ships a copy under `apps/web/public/drawio/`. That directory is populated by running `scripts/vendor-drawio.sh`, which copies the compiled drawio webapp from a local checkout of the jgraph/drawio repository. The `DrawioFrame` component renders the editor in a sandboxed iframe pointing at `/drawio/index.html` and communicates with it through `postMessage` using the bridge defined in `packages/diagrams/src/drawio/postMessageBridge.ts`. Saves are triggered by the `save` event the drawio app posts when the user saves, and they go through the standard `PATCH /api/diagrams/:id` route with optimistic concurrency checking.

**bpmn-js.** The BPMN editor uses the `bpmn-js` npm package rendered inside a `BpmnCanvas` component. `BpmnCanvas` is a forwardRef component that exposes a `save()` method returning the current diagram XML as a string. Saving is explicit: the user presses Save in the page header, which calls `save()` on the ref and sends the result to the same PATCH route.

**File tree.** The `FileTree` component reads from the updated `GET /api/vaults/:id/tree` response, which now returns an `items` array alongside the legacy `notes` array and `root` tree. Each item has a `kind` of `note`, `drawio`, or `bpmn`, and the tree renders notes and diagrams in the same list with distinct icons. Context menus on folders include entries to create a drawio diagram or a BPMN diagram in addition to the existing note creation entry.

**Wiki-link resolution.** Ctrl-clicking or Cmd-clicking a wiki-link in the editor calls `GET /api/links/resolve?vaultId=...&title=...`, which resolves the title to either a note or a diagram using note-wins tiebreak. The `recomputeLinks` function that runs on every save now populates `Link.targetDiagramId` when no note matches but a diagram does.

**Export.** The vault export worker includes diagrams in the zip archive alongside notes. Each drawio diagram is written as a `.drawio` file and each BPMN diagram as a `.bpmn` file, preserving the folder structure of the vault.
