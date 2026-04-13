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
